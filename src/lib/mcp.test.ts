// Run with `npm test` — the MCP protocol and tool rules against a fake
// backend (no browser, no Muse). Node strips the types, so imports keep
// their .ts extension.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  handleMcpMessage,
  JSONRPC,
  MAX_WAIT_SECONDS,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOLS,
  type CreateTaskArgs,
  type McpBackend,
  type McpContext,
  type McpTask,
} from './mcp/core.ts';

function task(patch: Partial<McpTask> = {}): McpTask {
  return {
    id: 'task_1',
    status: 'queued',
    model: 'muse-image',
    kind: 'image',
    url: null,
    duration_sec: null,
    requested_duration_sec: null,
    media: [],
    partial: false,
    text: null,
    thread_url: null,
    account_id: null,
    error: null,
    created_at: 1,
    finished_at: null,
    ...patch,
  };
}

/** Fake gateway: tasks finish after `finishAfter` getTask calls. */
function fakeBackend(opts: { finishAfter?: number; allowed?: string[]; tasks?: McpTask[] } = {}) {
  const created: CreateTaskArgs[] = [];
  const store = new Map<string, McpTask>((opts.tasks ?? []).map((t) => [t.id, t]));
  const polls = new Map<string, number>();
  const kinds: Record<string, 'image' | 'video' | 'chat' | 'audio'> = {
    'muse-image': 'image',
    'muse-voice': 'audio',
    'muse-video': 'video',
    'muse-chat': 'chat',
    'fast-video': 'video',
  };
  const backend: McpBackend = {
    async createTask(args) {
      created.push(args);
      const id = `task_${created.length + 100}`;
      const t = task({ id, model: args.model, kind: kinds[args.model] ?? 'chat', requested_duration_sec: args.durationSec });
      store.set(id, t);
      return t;
    },
    getTask(id) {
      const t = store.get(id);
      if (!t) return null;
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      if (opts.finishAfter !== undefined && n > opts.finishAfter && t.status !== 'succeeded') {
        const done = {
          ...t,
          status: 'succeeded' as const,
          url: `http://127.0.0.1:1412/api/media/${id}.png`,
          media: [{ url: `http://127.0.0.1:1412/api/media/${id}.png`, kind: t.kind }],
          thread_url: 'https://muse.ai/thread/abc',
          account_id: 'session_1',
          finished_at: 2,
        };
        store.set(id, done);
        return done;
      }
      return t;
    },
    listTasks: (limit) => [...store.values()].slice(0, limit),
    cancelTask(id) {
      const t = store.get(id);
      if (!t) return null;
      const c = { ...t, status: 'cancelled' as const };
      store.set(id, c);
      return c;
    },
    listModels: () => Object.entries(kinds).map(([id, kind]) => ({ id, kind })),
    kindOf: (model) => kinds[model] ?? 'chat',
    allowsModel: (model) => !opts.allowed || opts.allowed.includes(model),
    readMedia: async (url, maxBytes) =>
      url.endsWith('.png')
        ? { data: 'iVBORw0KGgo=', mimeType: 'image/png' }
        : url.endsWith('.mp4') && maxBytes >= 1000
          ? { data: 'AAAAGGZ0eXA=', mimeType: 'video/mp4' }
          : null,
    mediaInfo: async (url) =>
      url.endsWith('.mp4') ? { mimeType: 'video/mp4', size: url.includes('huge') ? 99e6 : 1000, name: url.split('/').pop()! } : null,
  };
  return { backend, created, store };
}

/** Virtual clock: sleeping advances time instantly. */
function ctxFor(backend: McpBackend, extra: Partial<McpContext> = {}): McpContext {
  let clock = 0;
  return {
    backend,
    serverVersion: '9.9.9',
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    ...extra,
  };
}

const call = (ctx: McpContext, name: string, args?: unknown, meta?: unknown) =>
  handleMcpMessage(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } },
    ctx,
  ) as Promise<any>;

test('initialize echoes a supported version and offers the newest otherwise', async () => {
  const ctx = ctxFor(fakeBackend().backend);
  const known = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx)) as any;
  assert.equal(known.result.protocolVersion, '2025-03-26');
  assert.deepEqual(known.result.capabilities, { tools: { listChanged: false } });
  assert.equal(known.result.serverInfo.name, 'muse-gateway');
  assert.equal(known.result.serverInfo.version, '9.9.9');
  assert.match(known.result.instructions, /10 seconds/);
  const unknown = (await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ctx)) as any;
  assert.equal(unknown.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
});

test('notifications and client responses get no reply; bad messages get errors', async () => {
  const ctx = ctxFor(fakeBackend().backend);
  assert.equal(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx), null);
  assert.equal(await handleMcpMessage({ jsonrpc: '2.0', id: 3, result: {} }, ctx), null);
  const noVersion = (await handleMcpMessage({ id: 4, method: 'ping' }, ctx)) as any;
  assert.equal(noVersion.error.code, JSONRPC.INVALID_REQUEST);
  const notObject = (await handleMcpMessage('ping', ctx)) as any;
  assert.equal(notObject.error.code, JSONRPC.INVALID_REQUEST);
  const unknown = (await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'sampling/createMessage' }, ctx)) as any;
  assert.equal(unknown.error.code, JSONRPC.METHOD_NOT_FOUND);
  const ping = (await handleMcpMessage({ jsonrpc: '2.0', id: 'p', method: 'ping' }, ctx)) as any;
  assert.deepEqual(ping, { jsonrpc: '2.0', id: 'p', result: {} });
});

test('tools/list describes every tool with schemas and annotations', async () => {
  const res = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctxFor(fakeBackend().backend))) as any;
  const names = res.result.tools.map((t: any) => t.name);
  assert.deepEqual(names, ['generate_image', 'generate_video', 'generate_speech', 'get_task', 'continue_task', 'cancel_task', 'list_tasks', 'list_models']);
  for (const tool of res.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.outputSchema.type, 'object');
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.ok(tool.description.length > 20);
  }
  assert.equal(TOOLS.find((t) => t.name === 'cancel_task')!.annotations.destructiveHint, true);
});

test('unknown tool is a protocol error; bad arguments are tool errors the model can read', async () => {
  const ctx = ctxFor(fakeBackend().backend);
  const unknown = await call(ctx, 'delete_everything', {});
  assert.equal(unknown.error.code, JSONRPC.INVALID_PARAMS);

  const missing = await call(ctx, 'generate_image', {});
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /prompt/);

  const extra = await call(ctx, 'generate_image', { prompt: 'cat', size: '1024' });
  assert.match(extra.result.content[0].text, /Unknown argument: size/);

  const ratio = await call(ctx, 'generate_video', { prompt: 'cat', ratio: '2:1' });
  assert.match(ratio.result.content[0].text, /ratio/);

  const long = await call(ctx, 'generate_video', { prompt: 'cat', duration_seconds: 90 });
  assert.match(long.result.content[0].text, /between 1 and 60/);

  const wait = await call(ctx, 'get_task', { task_id: 'x', wait_seconds: MAX_WAIT_SECONDS + 1 });
  assert.match(wait.result.content[0].text, /wait_seconds/);
});

test('model must be allowed for the key and must make the right kind of output', async () => {
  const limited = ctxFor(fakeBackend({ allowed: ['muse-video'] }).backend);
  const denied = await call(limited, 'generate_image', { prompt: 'cat' });
  assert.match(denied.result.content[0].text, /not allowed to use model "muse-image"/);

  const ctx = ctxFor(fakeBackend().backend);
  const wrongKind = await call(ctx, 'generate_image', { prompt: 'cat', model: 'muse-video' });
  assert.match(wrongKind.result.content[0].text, /returns video, not image/);
});

test('generate_image waits for the picture and returns it inline with structured data', async () => {
  const { backend, created } = fakeBackend({ finishAfter: 3 });
  const res = await call(ctxFor(backend), 'generate_image', { prompt: 'cat', ratio: '1:1', reference_images: ['https://x/a.jpg'] });
  assert.equal(res.result.isError, false);
  assert.equal(res.result.structuredContent.status, 'succeeded');
  assert.equal(res.result.content[0].type, 'text');
  assert.match(res.result.content[0].text, /Image ready/);
  assert.deepEqual(res.result.content[1], { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
  assert.deepEqual(created[0], {
    model: 'muse-image',
    prompt: 'cat',
    images: ['https://x/a.jpg'],
    durationSec: null,
    ratio: '1:1',
    count: 1,
    newChat: true,
    thread: null,
    account: null,
    idempotencyKey: null,
  });
});

test('generate_video returns the task right away with how to collect it', async () => {
  const { backend, created } = fakeBackend({ finishAfter: 0 });
  const res = await call(ctxFor(backend), 'generate_video', { prompt: 'cat dance', idempotency_key: 'k1' });
  assert.equal(res.result.structuredContent.status, 'queued');
  assert.match(res.result.content[0].text, /get_task/);
  assert.equal(created[0].durationSec, 10);
  assert.equal(created[0].idempotencyKey, 'k1');
});

test('get_task gives up at wait_seconds and reports progress while waiting', async () => {
  const { backend } = fakeBackend({ tasks: [task({ id: 'task_slow', status: 'running', kind: 'video', model: 'muse-video' })] });
  const progress: number[] = [];
  const res = await call(
    ctxFor(backend, { onProgress: (_token, n) => progress.push(n) }),
    'get_task',
    { task_id: 'task_slow', wait_seconds: 6 },
    { progressToken: 'tok' },
  );
  assert.equal(res.result.structuredContent.status, 'running');
  assert.ok(progress.length >= 3, `expected progress notifications, got ${progress.length}`);
  const missing = await call(ctxFor(backend), 'get_task', { task_id: 'nope' });
  assert.match(missing.result.content[0].text, /No task "nope"/);
});

test('a failed task is reported as a tool error with its reason', async () => {
  const { backend } = fakeBackend({ tasks: [task({ id: 'task_bad', status: 'failed', error: 'Muse returned no media' })] });
  const res = await call(ctxFor(backend), 'get_task', { task_id: 'task_bad' });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /Muse returned no media/);
});

test('continue_task reuses the thread, account and model of a finished task', async () => {
  const finished = task({
    id: 'task_done',
    status: 'succeeded',
    kind: 'video',
    model: 'fast-video',
    requested_duration_sec: 8,
    thread_url: 'https://muse.ai/thread/t1',
    account_id: 'session_9',
  });
  const { backend, created } = fakeBackend({ tasks: [finished, task({ id: 'task_busy', status: 'running' }), task({ id: 'task_nothread', status: 'failed' })] });
  const ctx = ctxFor(backend);
  await call(ctx, 'continue_task', { task_id: 'task_done', prompt: 'next clip' });
  assert.equal(created[0].model, 'fast-video');
  assert.equal(created[0].thread, 'https://muse.ai/thread/t1');
  assert.equal(created[0].account, 'session_9');
  assert.equal(created[0].newChat, false);
  assert.equal(created[0].durationSec, 8);

  const busy = await call(ctx, 'continue_task', { task_id: 'task_busy', prompt: 'x' });
  assert.match(busy.result.content[0].text, /still running/);
  const noThread = await call(ctx, 'continue_task', { task_id: 'task_nothread', prompt: 'x' });
  assert.match(noThread.result.content[0].text, /no Muse conversation/);
});

test('list_tasks filters by status; list_models lists what the key may use', async () => {
  const { backend } = fakeBackend({
    tasks: [task({ id: 'a', status: 'succeeded' }), task({ id: 'b', status: 'failed' }), task({ id: 'c', status: 'succeeded' })],
  });
  const ctx = ctxFor(backend);
  const done = await call(ctx, 'list_tasks', { status: 'succeeded' });
  assert.deepEqual(done.result.structuredContent.tasks.map((t: any) => t.task_id), ['a', 'c']);
  const models = await call(ctx, 'list_models', {});
  assert.ok(models.result.structuredContent.models.some((m: any) => m.id === 'muse-video' && m.kind === 'video'));
});

test('cancel_task cancels and an unexpected backend failure is an internal error', async () => {
  const { backend } = fakeBackend({ tasks: [task({ id: 'task_x', status: 'running' })] });
  const cancelled = await call(ctxFor(backend), 'cancel_task', { task_id: 'task_x' });
  assert.equal(cancelled.result.structuredContent.status, 'cancelled');

  const broken = { ...backend, createTask: async () => { throw new Error('disk full'); } };
  const res = await call(ctxFor(broken), 'generate_video', { prompt: 'x' });
  assert.equal(res.error.code, JSONRPC.INTERNAL_ERROR);
  assert.equal(res.error.data.detail, 'disk full');
});

test('finished videos come back as resource_link for 2025-06-18 clients, text only for older ones', async () => {
  const video = task({
    id: 'task_v',
    status: 'succeeded',
    kind: 'video',
    model: 'muse-video',
    url: 'http://127.0.0.1:1412/api/media/clip.mp4',
    media: [{ url: 'http://127.0.0.1:1412/api/media/clip.mp4', kind: 'video', duration_sec: 10 }],
  });
  const { backend } = fakeBackend({ tasks: [video] });
  const modern = await call(ctxFor(backend, { protocolVersion: '2025-06-18' }), 'get_task', { task_id: 'task_v' });
  const link = modern.result.content.find((c: any) => c.type === 'resource_link');
  assert.deepEqual(
    { uri: link.uri, mimeType: link.mimeType, size: link.size, name: link.name },
    { uri: 'http://127.0.0.1:1412/api/media/clip.mp4', mimeType: 'video/mp4', size: 1000, name: 'clip.mp4' },
  );
  const older = await call(ctxFor(backend, { protocolVersion: '2025-03-26' }), 'get_task', { task_id: 'task_v' });
  assert.ok(!older.result.content.some((c: any) => c.type === 'resource_link'));
  assert.match(older.result.content[0].text, /clip\.mp4/);
});

test('include_file embeds the video; too large falls back to the link with a note', async () => {
  const small = task({ id: 'task_s', status: 'succeeded', kind: 'video', url: 'http://h/api/media/s.mp4', media: [{ url: 'http://h/api/media/s.mp4' }] });
  const huge = task({ id: 'task_h', status: 'succeeded', kind: 'video', url: 'http://h/api/media/huge.mp4', media: [{ url: 'http://h/api/media/huge.mp4' }] });
  const { backend } = fakeBackend({ tasks: [small, huge] });
  const ctx = ctxFor(backend, { protocolVersion: '2025-06-18' });
  const embedded = await call(ctx, 'get_task', { task_id: 'task_s', include_file: true });
  const res = embedded.result.content.find((c: any) => c.type === 'resource');
  assert.deepEqual(res.resource, { uri: 'http://h/api/media/s.mp4', mimeType: 'video/mp4', blob: 'AAAAGGZ0eXA=' });
  const tooBig = await call(ctx, 'get_task', { task_id: 'task_h', include_file: true });
  assert.ok(tooBig.result.content.some((c: any) => c.type === 'resource_link'));
  assert.ok(tooBig.result.content.some((c: any) => /wasn't embedded/.test(c.text ?? '')));
  const bad = await call(ctx, 'get_task', { task_id: 'task_s', include_file: 'yes' });
  assert.match(bad.result.content[0].text, /true or false/);
});

test('generate_image passes count (1–4) through; video always asks for one', async () => {
  const { backend, created } = fakeBackend({ finishAfter: 0 });
  const ctx = ctxFor(backend);
  await call(ctx, 'generate_image', { prompt: 'cats', count: 4, wait_seconds: 0 });
  assert.equal(created[0].count, 4);
  const tooMany = await call(ctx, 'generate_image', { prompt: 'cats', count: 5 });
  assert.match(tooMany.result.content[0].text, /between 1 and 4/);
  const onVideo = await call(ctx, 'generate_video', { prompt: 'x', count: 2 });
  assert.match(onVideo.result.content[0].text, /Unknown argument: count/);
});

test('generate_speech sends the text and voice settings to muse-voice', async () => {
  const { backend, created } = fakeBackend({ finishAfter: 0 });
  const ctx = ctxFor(backend);
  const res = await call(ctx, 'generate_speech', { text: 'Xin chào', voice: 'Glad Kite', language: 'vi', speed: 1.2, wait_seconds: 0 });
  assert.notEqual(res.result.isError, true);
  assert.equal(created[0].model, 'muse-voice');
  assert.equal(created[0].prompt, 'Xin chào');
  assert.equal(created[0].voice, 'Glad Kite');
  assert.equal(created[0].language, 'vi');
  assert.equal(created[0].speed, 1.2);
  assert.equal(created[0].newChat, true);
  const wrongKind = await call(ctx, 'generate_speech', { text: 'x', model: 'muse-image' });
  assert.equal(wrongKind.result.isError, true);
  const noText = await call(ctx, 'generate_speech', {});
  assert.equal(noText.result.isError, true);
  const badSpeed = await call(ctx, 'generate_speech', { text: 'x', speed: 'fast' });
  assert.match(badSpeed.result.content[0].text, /speed/);
});
