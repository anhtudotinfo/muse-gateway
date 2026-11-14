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
import { baseKind, ratioFromSize, withMediaIntent } from './modelKind.ts';
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
  await assert.rejects(loadImageRefs(['data:text/html;base64,AA'], true), /image, video or audio data/);
  // Clone pipelines attach a source clip or voice track; the driver uploads them.
  assert.deepEqual(await loadImageRefs(['data:video/mp4;base64,AA', 'data:audio/mpeg;base64,AA'], false), ['data:video/mp4;base64,AA', 'data:audio/mpeg;base64,AA']);
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
  const prompt = buildTaskPrompt(parsed.input, 'video');
  assert.match(prompt, /^Tạo video 30 giây tỷ lệ khung hình 9:16: con mèo/);
  assert.match(prompt, /MỘT video duy nhất dài đủ 30 giây/);
  const short = parseTaskInput({ prompt: 'con mèo', duration: 8 });
  assert.ok(short.ok);
  assert.equal(buildTaskPrompt(short.input, 'video'), 'Tạo video 8 giây: con mèo');
  const image = parseTaskInput({ prompt: 'con mèo', model: 'muse-image', ratio: '1:1' });
  assert.ok(image.ok);
  assert.equal(buildTaskPrompt(image.input, 'image'), 'Tạo ảnh tỷ lệ khung hình 1:1: con mèo');
  // A combo named anything still shapes the prompt by its kind.
  const combo = parseTaskInput({ prompt: 'con mèo', model: 'video-fast', duration: 8 });
  assert.ok(combo.ok);
  assert.equal(buildTaskPrompt(combo.input, 'video'), 'Tạo video 8 giây: con mèo');
  assert.equal(buildTaskPrompt(combo.input, 'chat'), 'con mèo');
});

test('webhook signature is hex hmac-sha256', () => {
  const expected = crypto.createHmac('sha256', 'secret').update('{"a":1}').digest('hex');
  assert.equal(signWebhook('{"a":1}', 'secret'), `sha256=${expected}`);
  assert.notEqual(signWebhook('{}', 'a'), signWebhook('{}', 'b'));
});

test('model names map to the output they promise', () => {
  assert.equal(baseKind('muse-video'), 'video');
  assert.equal(baseKind('MUSE-IMAGE'), 'image');
  assert.equal(baseKind('muse-chat'), 'chat');
  assert.equal(baseKind('gpt-4o'), 'chat');
  assert.equal(baseKind(null), 'chat');
});

test('image and video requests always ask Muse for that output', () => {
  assert.equal(withMediaIntent('con mèo trên bãi cỏ', 'image'), 'Tạo ảnh: con mèo trên bãi cỏ');
  assert.equal(withMediaIntent('a cat on the grass', 'video'), 'Tạo video: a cat on the grass');
  // Prompts that already name the output are untouched.
  assert.equal(withMediaIntent('Tạo ảnh tỷ lệ 3:4: áo sơ mi', 'image'), 'Tạo ảnh tỷ lệ 3:4: áo sơ mi');
  assert.equal(withMediaIntent('product photo of a shirt', 'image'), 'product photo of a shirt');
  assert.equal(withMediaIntent('Tạo video 30 giây: biển', 'video'), 'Tạo video 30 giây: biển');
  // "hình" inside another word doesn't count, and chat is never rewritten.
  assert.equal(withMediaIntent('cấu hìnhx server', 'image'), 'Tạo ảnh: cấu hìnhx server');
  assert.equal(withMediaIntent('tạo dàn ý bài viết', 'chat'), 'tạo dàn ý bài viết');
});

test('OpenAI image sizes map to the nearest ratio', () => {
  assert.equal(ratioFromSize('1024x1024'), '1:1');
  assert.equal(ratioFromSize('1024x1792'), '9:16');
  assert.equal(ratioFromSize('1792x1024'), '16:9');
  assert.equal(ratioFromSize('1536x1024'), '3:2');
  assert.equal(ratioFromSize('auto'), null);
  assert.equal(ratioFromSize(undefined), null);
});

test('only real loopback origins count as local for keyless access', async () => {
  const { isLoopbackOrigin } = await import('./remoteDetect.ts');
  for (const ok of ['http://localhost:3000', 'http://127.0.0.1:1412', 'http://[::1]:5173', 'tauri://localhost', 'http://tauri.localhost']) {
    assert.equal(isLoopbackOrigin(ok), true, ok);
  }
  for (const bad of ['null', 'https://evil.example', 'http://[::ffff:203.0.113.5]', 'http://localhost.evil.example', 'not a url', '']) {
    assert.equal(isLoopbackOrigin(bad), false, bad);
  }
});

test('zipStream writes a valid stored ZIP that standard tools can read', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { crc32, zipStream } = await import('./zipStream.ts');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.bin');
  fs.writeFileSync(a, 'hello zip');
  fs.writeFileSync(b, crypto.randomBytes(200_000));
  const chunks: Buffer[] = [];
  const reader = zipStream([
    { name: '01-image-a.txt', path: a },
    { name: 'missing.png', path: path.join(dir, 'nope.png') },
    { name: '02-video-b.bin', path: b },
  ]).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  const zip = path.join(dir, 'out.zip');
  fs.writeFileSync(zip, Buffer.concat(chunks));

  // Windows ships bsdtar (reads ZIP) as System32\tar.exe — the `tar` on PATH
  // may be GNU tar from Git Bash, which can't. Elsewhere, Info-ZIP.
  const out = path.join(dir, 'x');
  fs.mkdirSync(out);
  let listing: string[];
  if (process.platform === 'win32') {
    const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    listing = execFileSync(bsdtar, ['-tf', zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    execFileSync(bsdtar, ['-xf', zip, '-C', out]);
  } else {
    listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    execFileSync('unzip', ['-q', zip, '-d', out]);
  }
  assert.deepEqual(listing, ['01-image-a.txt', '02-video-b.bin']);
  assert.equal(fs.readFileSync(path.join(out, '01-image-a.txt'), 'utf8'), 'hello zip');
  assert.ok(fs.readFileSync(path.join(out, '02-video-b.bin')).equals(fs.readFileSync(b)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('count asks Muse for several images in one message', () => {
  const ok = parseTaskInput({ prompt: 'mèo', count: 4, model: 'muse-image' });
  assert.equal(ok.ok && ok.input.count, 4);
  assert.equal(parseTaskInput({ prompt: 'x', n: 2 }).ok && (parseTaskInput({ prompt: 'x', n: 2 }) as any).input.count, 2);
  assert.equal((parseTaskInput({ prompt: 'x' }) as any).input.count, 1);
  for (const bad of [0, 5, 2.5, '3']) {
    const r = parseTaskInput({ prompt: 'x', count: bad });
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(buildTaskPrompt({ prompt: 'mèo', durationSec: null, ratio: '1:1', count: 4 }, 'image'), 'Tạo 4 ảnh khác nhau tỷ lệ khung hình 1:1: mèo');
  assert.equal(buildTaskPrompt({ prompt: 'mèo', durationSec: null, ratio: null, count: 3 }, 'image'), 'Tạo 3 ảnh khác nhau: mèo');
  assert.equal(buildTaskPrompt({ prompt: 'mèo', durationSec: null, ratio: null }, 'image'), 'mèo');
});
