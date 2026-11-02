// Run with `npm test` — covers the request and result rules that don't need a
// browser. Node strips the types, so imports keep their .ts extension.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { assertDialableUrl, collectImageRefs, isBlockedAddress, loadImageRefs } from './imageRefs.ts';
import {
  isShortVideo,
  longestVideoSeconds,
  mediaKindOf,
  requestedVideoSeconds,
  selectFinalMedia,
  withOrigin,
} from './mediaResult.ts';
import { buildTaskPrompt, parseTaskInput, signWebhook } from './taskInput.ts';

test('requested length reads the number after "video"', () => {
  assert.equal(requestedVideoSeconds('Tạo video 30 giây tỷ lệ 9:16: giữ 3 giây cuối'), 30);
  assert.equal(requestedVideoSeconds('Make a video of 45 seconds'), 45);
  assert.equal(requestedVideoSeconds('video 1 phút'), 60);
  assert.equal(requestedVideoSeconds('video 30s'), 30);
});

test('requested length ignores short or absent durations', () => {
  assert.equal(requestedVideoSeconds('Tạo video 8 giây'), null);
  assert.equal(requestedVideoSeconds('Tạo video con mèo'), null);
  assert.equal(requestedVideoSeconds('anything', 25), 25);
  assert.equal(requestedVideoSeconds('video 30 giây', 5), null);
});

test('a clip under 80% of the request is a segment', () => {
  assert.equal(isShortVideo(10, 30), true);
  assert.equal(isShortVideo(24, 30), false);
  assert.equal(isShortVideo(0, 30), false);
  assert.equal(isShortVideo(10, null), false);
});

test('a long job returns only the longest clip', () => {
  const segment = { src: 'a.mp4', kind: 'video' as const, durationSec: 10 };
  const merged = { src: 'b.mp4', kind: 'video' as const, durationSec: 30 };
  assert.deepEqual(selectFinalMedia([segment, merged, segment], 30), [merged]);
  assert.equal(longestVideoSeconds([segment, merged]), 30);
});

test('other media is returned untouched', () => {
  const takes = [
    { src: 'a.mp4', kind: 'video' as const, durationSec: 8 },
    { src: 'b.mp4', kind: 'video' as const, durationSec: 9 },
  ];
  assert.deepEqual(selectFinalMedia(takes, null), takes);
  const unmeasured = [{ src: 'a.mp4', kind: 'video' as const }];
  assert.deepEqual(selectFinalMedia(unmeasured, 30), unmeasured);
});

test('media kind and absolute urls', () => {
  assert.equal(mediaKindOf('/api/media/x.webp?v=1'), 'image');
  assert.equal(mediaKindOf('/api/media/x.bin', 'video'), 'video');
  assert.equal(mediaKindOf('/api/media/x.bin'), 'file');
  assert.equal(withOrigin('/api/media/x.mp4', 'http://h'), 'http://h/api/media/x.mp4');
  assert.equal(withOrigin('https://cdn/x.mp4', 'http://h'), 'https://cdn/x.mp4');
});

test('image refs come from both content shapes', () => {
  assert.deepEqual(
    collectImageRefs([
      { type: 'text', text: 'x' },
      { type: 'image_url', image_url: { url: 'a' } },
      { type: 'input_image', image_url: 'b' },
    ]),
    ['a', 'b'],
  );
  assert.deepEqual(collectImageRefs('plain text'), []);
});

test('private addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('remote callers cannot reach the local network', async () => {
  await assert.rejects(assertDialableUrl('http://127.0.0.1:1412/x', false), /Private network/);
  await assert.rejects(assertDialableUrl('file:///etc/passwd', true), /Only http/);
  await assert.rejects(loadImageRefs(['http://169.254.169.254/x.png'], false), /Private network/);
  await assertDialableUrl('http://127.0.0.1:1412/x', true);
});

test('non-image data urls are rejected, image ones pass', async () => {
  await assert.rejects(loadImageRefs(['data:text/html;base64,AA'], true), /image data/);
  assert.deepEqual(await loadImageRefs(['data:image/png;base64,AA'], false), ['data:image/png;base64,AA']);
});

test('task input validation', () => {
  assert.equal(parseTaskInput({}).ok, false);
  assert.equal(parseTaskInput({ prompt: 'x', duration: 61 }).ok, false);
  assert.equal(parseTaskInput({ prompt: 'x', ratio: '2:1' }).ok, false);
  assert.equal(parseTaskInput({ prompt: 'x', images: [1] }).ok, false);
  const parsed = parseTaskInput({ prompt: ' x ', duration: 30 });
  assert.ok(parsed.ok);
  assert.equal(parsed.input.model, 'muse-video');
  assert.equal(parsed.input.prompt, 'x');
  assert.equal(parsed.input.newChat, true);
});

test('task prompts carry length, shape and the stitch request', () => {
  const parsed = parseTaskInput({ prompt: 'con mèo', duration: 30, ratio: '9:16' });
  assert.ok(parsed.ok);
  const prompt = buildTaskPrompt(parsed.input);
  assert.match(prompt, /^Tạo video 30 giây tỷ lệ khung hình 9:16: con mèo/);
  assert.match(prompt, /MỘT video duy nhất dài đủ 30 giây/);
  const short = parseTaskInput({ prompt: 'con mèo', duration: 8 });
  assert.ok(short.ok);
  assert.equal(buildTaskPrompt(short.input), 'Tạo video 8 giây: con mèo');
  const image = parseTaskInput({ prompt: 'con mèo', model: 'muse-image', ratio: '1:1' });
  assert.ok(image.ok);
  assert.equal(buildTaskPrompt(image.input), 'Tạo ảnh tỷ lệ khung hình 1:1: con mèo');
});

test('webhook signature is hex hmac-sha256', () => {
  const expected = crypto.createHmac('sha256', 'secret').update('{"a":1}').digest('hex');
  assert.equal(signWebhook('{"a":1}', 'secret'), `sha256=${expected}`);
  assert.notEqual(signWebhook('{}', 'a'), signWebhook('{}', 'b'));
});
