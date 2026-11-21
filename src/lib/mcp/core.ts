// Model Context Protocol server core — JSON-RPC handling and the Muse tools.
//
// Transport-free on purpose: /v1/mcp (Streamable HTTP) and the stdio bridge
// both feed messages through handleMcpMessage(). Everything that touches
// the Muse pool sits behind McpBackend, so the protocol and the tool rules
// are testable without a browser (see mcp.test.ts). No runtime imports.

/** Newest first. The first entry is offered when a client asks for a
 *  version this server doesn't know. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Longest a single tool call blocks waiting for a result. MCP clients
 *  commonly time a request out after 60s, so stay under that and hand back a
 *  task id the caller can poll with get_task. */
export const MAX_WAIT_SECONDS = 55;
const POLL_INTERVAL_MS = 1500;
/** Inline images above this travel as a link only (JSON-RPC payload size). */
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
/** include_file embeds the result itself (base64) up to this size. */
export const MAX_EMBED_BYTES = 25 * 1024 * 1024;
/** First protocol version with the resource_link content type. */
const RESOURCE_LINK_SINCE = '2025-06-18';

export const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type TaskKind = 'chat' | 'image' | 'video' | 'audio';
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface McpTask {
  id: string;
  status: TaskStatus;
  model: string;
  kind: TaskKind;
  url: string | null;
  duration_sec: number | null;
  requested_duration_sec: number | null;
  media: { url: string; kind?: string; duration_sec?: number | null }[];
  partial: boolean;
  text: string | null;
  thread_url: string | null;
  account_id: string | null;
  error: string | null;
  created_at: number | null;
  finished_at: number | null;
}

export interface CreateTaskArgs {
  model: string;
  prompt: string;
  images: string[];
  durationSec: number | null;
  ratio: string | null;
  /** Images in this one request (1–4); 1 for video. */
  count: number;
  /** Speech only: Muse voice, locale and speed (0.25–4). */
  voice?: string | null;
  language?: string | null;
  speed?: number | null;
  newChat: boolean;
  thread: string | null;
  account: string | null;
  idempotencyKey: string | null;
}

/** What the tools need from the gateway. Implemented in backend.ts. */
export interface McpBackend {
  createTask(args: CreateTaskArgs): Promise<McpTask>;
  getTask(id: string): McpTask | null;
  listTasks(limit: number): McpTask[];
  cancelTask(id: string): McpTask | null;
  listModels(): { id: string; kind: TaskKind }[];
  kindOf(model: string): TaskKind;
  allowsModel(model: string): boolean;
  /** Bytes of a result served by this gateway (null when it isn't one of
   *  ours or is larger than maxBytes). */
  readMedia(url: string, maxBytes: number): Promise<{ data: string; mimeType: string } | null>;
  /** Type and size of such a result, without reading it. */
  mediaInfo(url: string): Promise<{ mimeType: string; size: number; name: string } | null>;
}

export interface McpContext {
  backend: McpBackend;
  serverVersion: string;
  /** Request aborted by the client — stop waiting on tasks. */
  signal?: AbortSignal;
  /** Protocol version the client negotiated (MCP-Protocol-Version header).
   *  Decides which content types it understands. */
  protocolVersion?: string;
  /** Called while a tool waits, so a streaming transport can keep the
   *  connection alive and report progress. */
  onProgress?: (progressToken: string | number, progress: number, message: string) => void;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

type JsonRpcId = string | number;
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId | null;
  method?: string;
  params?: any;
  result?: unknown;
  error?: unknown;
}
export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId | null; error: { code: number; message: string; data?: unknown } };

/** A tool failure the caller should see and can act on (isError result). */
export class McpToolError extends Error {}

const SERVER_INSTRUCTIONS = [
  'Muse Gateway generates images, videos and speech with Muse.',
  'generate_speech reads text aloud with one of the Muse voices and returns an mp3 (usually within a minute).',
  'generate_image waits for the pictures (up to ~50s) and returns them; set count (up to 4) to get several different images from one request instead of calling it repeatedly. If not ready yet, poll get_task with the returned task_id.',
  'generate_video returns a task_id right away — videos take minutes. Poll get_task (use wait_seconds to block up to 55s per call).',
  'Muse renders about 10 seconds per clip reliably. For longer videos, make 10-second clips and chain them with continue_task, which keeps the same Muse conversation.',
  'reference_images accepts http(s) URLs or data: URLs (images up to 20 MB, video/audio clips up to 40 MB).',
].join(' ');

// ─── Tool definitions ────────────────────────────────────────────────────

const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];

const taskOutputSchema = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] },
    kind: { type: 'string', enum: ['chat', 'image', 'video'] },
    model: { type: 'string' },
    url: { type: ['string', 'null'], description: 'Final file when status is succeeded.' },
    media: {
      type: 'array',
      items: {
        type: 'object',
        properties: { url: { type: 'string' }, kind: { type: 'string' }, duration_sec: { type: ['number', 'null'] } },
        required: ['url'],
      },
    },
    duration_sec: { type: ['number', 'null'] },
    requested_duration_sec: { type: ['number', 'null'] },
    partial: { type: 'boolean', description: 'True when the video came back shorter than requested.' },
    text: { type: ['string', 'null'], description: "Muse's reply text, if any." },
    thread_url: { type: ['string', 'null'] },
    error: { type: ['string', 'null'] },
    created_at: { type: ['number', 'null'] },
    finished_at: { type: ['number', 'null'] },
  },
  required: ['task_id', 'status', 'kind', 'model'],
};

const referenceImages = {
  type: 'array',
  maxItems: 16,
  items: { type: 'string' },
  description:
    'Reference media: http(s) URLs or data: URLs. Images up to 20 MB, video or audio clips up to 40 MB. Describe each one\'s role in the prompt (e.g. "the face in image 1").',
};
const waitSeconds = (fallback: number) => ({
  type: 'integer',
  minimum: 0,
  maximum: MAX_WAIT_SECONDS,
  default: fallback,
  description: `Block up to this many seconds for the result before returning (0–${MAX_WAIT_SECONDS}). If it isn't ready, poll get_task.`,
});
const idempotencyKey = {
  type: 'string',
  maxLength: 200,
  description: 'Optional. Repeating a call with the same key returns the same task instead of starting a new render.',
};

const includeFile = {
  type: 'boolean',
  default: false,
  description: `Video results: also embed the file itself (base64, up to ${MAX_EMBED_BYTES / 1024 / 1024} MB) instead of only linking it. Only if you need the bytes.`,
};

export const TOOLS = [
  {
    name: 'generate_image',
    title: 'Generate image',
    description:
      'Create images with Muse from a text prompt, optionally guided by reference images. One call makes up to 4 different images (count) — much faster than separate calls. Waits for the result (default 50s) and returns the pictures; if Muse is slower, returns a task_id to poll with get_task.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 20000, description: 'What to create.' },
        ratio: { type: 'string', enum: RATIOS, description: 'Aspect ratio. Default: Muse decides.' },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 4,
          default: 1,
          description: 'How many different images to make in this one request (1–4). Muse makes them together, so 4 images take about as long as 1 — use it instead of calling 4 times.',
        },
        reference_images: referenceImages,
        model: { type: 'string', description: 'muse-image (default) or an image combo name from list_models.' },
        wait_seconds: waitSeconds(50),
        idempotency_key: idempotencyKey,
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    outputSchema: taskOutputSchema,
    annotations: { title: 'Generate image', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'generate_video',
    title: 'Generate video',
    description:
      'Start a Muse video from a text prompt, optionally with reference images (first frame, character, style). Returns a task_id immediately — videos take minutes; poll get_task. About 10 seconds per clip is reliable: for longer videos make 10-second clips and chain them with continue_task.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 20000, description: 'Scene, action, camera, dialogue.' },
        duration_seconds: { type: 'integer', minimum: 1, maximum: 60, default: 10, description: 'Length in seconds. Up to 10 is reliable; longer often returns shorter (partial: true).' },
        ratio: { type: 'string', enum: RATIOS, description: 'Aspect ratio, e.g. 9:16 for vertical.' },
        reference_images: referenceImages,
        model: { type: 'string', description: 'muse-video (default) or a video combo name from list_models.' },
        wait_seconds: waitSeconds(0),
        include_file: includeFile,
        idempotency_key: idempotencyKey,
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    outputSchema: taskOutputSchema,
    annotations: { title: 'Generate video', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'generate_speech',
    title: 'Generate speech',
    description:
      'Read text aloud with the Muse voice tool and return an mp3. Muse has 1,219 voices — pass a voice name such as "Glad Kite" (the Vietnamese one), "Helio" or "Aria"; unset picks Glad Kite for Vietnamese text and Helio otherwise. Waits for the file (default 50s); if Muse is slower, returns a task_id to poll with get_task.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 6000, description: 'Exactly what to read aloud, up to 6,000 characters (about 5 minutes of speech).' },
        voice: { type: 'string', maxLength: 80, description: 'Muse voice name, e.g. "Glad Kite", "Helio", "Aria".' },
        language: { type: 'string', description: 'Locale such as "vi" or "en". Default: detected from the text.' },
        speed: { type: 'number', minimum: 0.25, maximum: 4, default: 1, description: 'Reading speed, 1 = normal.' },
        model: { type: 'string', description: 'muse-voice (default) or a voice combo name from list_models.' },
        wait_seconds: waitSeconds(50),
        include_file: includeFile,
        idempotency_key: idempotencyKey,
      },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: taskOutputSchema,
    annotations: { title: 'Generate speech', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'get_task',
    title: 'Get task',
    description: 'Status and result of a task. Use wait_seconds to block until it finishes (up to 55s per call). Images come back inline; videos as a link (resource_link) — set include_file to embed the video itself.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1 },
        wait_seconds: waitSeconds(0),
        include_file: includeFile,
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    outputSchema: taskOutputSchema,
    annotations: { title: 'Get task', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'continue_task',
    title: 'Continue task',
    description:
      'Follow up on a finished task in the same Muse conversation: edit an image ("make the background blue"), or extend a video with the next clip. Uses the same model and account as the original.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1, description: 'A finished task to continue from.' },
        prompt: { type: 'string', minLength: 1, maxLength: 20000, description: 'What to change or what happens next.' },
        duration_seconds: { type: 'integer', minimum: 1, maximum: 60, description: 'Video only. Default: same as the original.' },
        ratio: { type: 'string', enum: RATIOS },
        reference_images: referenceImages,
        wait_seconds: waitSeconds(0),
        include_file: includeFile,
        idempotency_key: idempotencyKey,
      },
      required: ['task_id', 'prompt'],
      additionalProperties: false,
    },
    outputSchema: taskOutputSchema,
    annotations: { title: 'Continue task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'cancel_task',
    title: 'Cancel task',
    description: 'Stop waiting for a queued or running task. Muse may still finish the render on its side, but the gateway drops it.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', minLength: 1 } },
      required: ['task_id'],
      additionalProperties: false,
    },
    outputSchema: taskOutputSchema,
    annotations: { title: 'Cancel task', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: "Recent tasks for this API key, newest first.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { tasks: { type: 'array', items: taskOutputSchema } },
      required: ['tasks'],
    },
    annotations: { title: 'List tasks', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_models',
    title: 'List models',
    description: 'Image, video and voice models (including combos) this API key may use, for the model argument of generate_image / generate_video / generate_speech.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        models: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string' } }, required: ['id', 'kind'] },
        },
      },
      required: ['models'],
    },
    annotations: { title: 'List models', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// ─── Argument helpers ────────────────────────────────────────────────────

function str(args: any, key: string, { required = false, max = 20000 } = {}): string | null {
  const value = args?.[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new McpToolError(`\`${key}\` is required.`);
    return null;
  }
  if (typeof value !== 'string') throw new McpToolError(`\`${key}\` must be a string.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new McpToolError(`\`${key}\` is required.`);
  if (trimmed.length > max) throw new McpToolError(`\`${key}\` is limited to ${max} characters.`);
  return trimmed || null;
}

function int(args: any, key: string, min: number, max: number, fallback: number | null): number | null {
  const value = args?.[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new McpToolError(`\`${key}\` must be a number.`);
  const n = Math.round(value);
  if (n < min || n > max) throw new McpToolError(`\`${key}\` must be between ${min} and ${max}.`);
  return n;
}

function bool(args: any, key: string): boolean {
  const value = args?.[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new McpToolError(`\`${key}\` must be true or false.`);
  return value;
}

function ratio(args: any): string | null {
  const value = str(args, 'ratio', { max: 10 });
  if (value && !RATIOS.includes(value)) throw new McpToolError(`\`ratio\` must be one of ${RATIOS.join(', ')}.`);
  return value;
}

function images(args: any): string[] {
  const value = args?.reference_images;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    throw new McpToolError('`reference_images` must be an array of URLs or data: URLs.');
  }
  if (value.length > 16) throw new McpToolError('`reference_images` is limited to 16 items.');
  return value.map((v: string) => v.trim());
}

function rejectUnknown(args: any, allowed: string[]) {
  if (args === undefined || args === null) return;
  if (typeof args !== 'object' || Array.isArray(args)) throw new McpToolError('Arguments must be an object.');
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) throw new McpToolError(`Unknown argument${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`);
}

function checkModel(backend: McpBackend, model: string, kind: TaskKind) {
  if (!backend.allowsModel(model)) throw new McpToolError(`This API key is not allowed to use model "${model}".`);
  const actual = backend.kindOf(model);
  if (actual !== kind) {
    throw new McpToolError(`Model "${model}" returns ${actual}, not ${kind}. Pick a ${kind} model from list_models.`);
  }
}

// ─── Results ─────────────────────────────────────────────────────────────

const isFinished = (t: McpTask) => t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled';

function summary(task: McpTask) {
  return {
    task_id: task.id,
    status: task.status,
    kind: task.kind,
    model: task.model,
    url: task.url,
    media: task.media.map((m) => ({ url: m.url, kind: m.kind, duration_sec: m.duration_sec ?? null })),
    duration_sec: task.duration_sec,
    requested_duration_sec: task.requested_duration_sec,
    partial: task.partial,
    text: task.text,
    thread_url: task.thread_url,
    error: task.error,
    created_at: task.created_at,
    finished_at: task.finished_at,
  };
}

function describe(task: McpTask): string {
  const what = task.kind === 'video' ? 'Video' : task.kind === 'image' ? 'Image' : task.kind === 'audio' ? 'Speech' : 'Task';
  switch (task.status) {
    case 'succeeded': {
      const lines = [`${what} ready (task ${task.id}).`];
      for (const m of task.media.length ? task.media : task.url ? [{ url: task.url }] : []) lines.push(m.url);
      if (task.partial) {
        lines.push(
          `Note: shorter than requested (${task.duration_sec ?? '?'}s of ${task.requested_duration_sec ?? '?'}s). Muse renders ~10s per clip — continue_task can add the next clip.`,
        );
      }
      return lines.join('\n');
    }
    case 'failed':
      return `${what} failed (task ${task.id}): ${task.error || 'unknown error'}`;
    case 'cancelled':
      return `${what} cancelled (task ${task.id}).`;
    default:
      return `${what} ${task.status} (task ${task.id}). Call get_task with task_id "${task.id}" and wait_seconds up to ${MAX_WAIT_SECONDS} to collect it.`;
  }
}

async function toolResult(ctx: McpContext, task: McpTask, includeFile = false) {
  const content: any[] = [{ type: 'text', text: describe(task) }];
  // Clients on 2025-06-18+ understand resource_link; older ones would trip
  // over it, so they get the URL in the text only. No header at all means
  // 2025-03-26 per the spec.
  const links = (ctx.protocolVersion ?? '2025-03-26') >= RESOURCE_LINK_SINCE;
  const files = task.media.length ? task.media : task.url ? [{ url: task.url }] : [];
  if (task.status === 'succeeded') {
    for (const m of files) {
      if (task.kind === 'image') {
        const inline = await ctx.backend.readMedia(m.url, MAX_INLINE_IMAGE_BYTES).catch(() => null);
        if (inline && inline.mimeType.startsWith('image/')) {
          content.push({ type: 'image', data: inline.data, mimeType: inline.mimeType });
          continue;
        }
      }
      const info = await ctx.backend.mediaInfo(m.url).catch(() => null);
      if (includeFile && info && info.size <= MAX_EMBED_BYTES) {
        const file = await ctx.backend.readMedia(m.url, MAX_EMBED_BYTES).catch(() => null);
        if (file) {
          // Embedded resources exist since the first spec version.
          content.push({ type: 'resource', resource: { uri: m.url, mimeType: file.mimeType, blob: file.data } });
          continue;
        }
      }
      if (links) {
        content.push({
          type: 'resource_link',
          uri: m.url,
          name: info?.name ?? m.url.split('/').pop() ?? 'result',
          ...(info ? { mimeType: info.mimeType, size: info.size } : {}),
          description:
            task.kind === 'video'
              ? `Generated video (task ${task.id})`
              : task.kind === 'audio'
                ? `Generated speech (task ${task.id})`
                : `Generated file (task ${task.id})`,
        });
      }
    }
    if (includeFile && task.kind === 'video' && !content.some((c) => c.type === 'resource')) {
      content.push({
        type: 'text',
        text: `The video wasn't embedded: it is larger than ${MAX_EMBED_BYTES / 1024 / 1024} MB or not stored on this gateway. Download it from the link.`,
      });
    }
  }
  return {
    content,
    structuredContent: summary(task),
    isError: task.status === 'failed',
  };
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

/** Poll until the task finishes, the wait runs out or the client leaves. */
async function waitFor(ctx: McpContext, id: string, seconds: number, progressToken?: string | number): Promise<McpTask | null> {
  const now = ctx.now ?? Date.now;
  const sleep = ctx.sleep ?? defaultSleep;
  const deadline = now() + seconds * 1000;
  let task = ctx.backend.getTask(id);
  let tick = 0;
  while (task && !isFinished(task) && now() < deadline && !ctx.signal?.aborted) {
    if (progressToken !== undefined) {
      ctx.onProgress?.(progressToken, ++tick, `Muse is working on ${id} (${task.status})`);
    }
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - now())), ctx.signal);
    task = ctx.backend.getTask(id);
  }
  return task;
}

// ─── Tool handlers ───────────────────────────────────────────────────────

async function callTool(ctx: McpContext, name: string, args: any, progressToken?: string | number) {
  const { backend } = ctx;
  switch (name) {
    case 'generate_image':
    case 'generate_video': {
      const video = name === 'generate_video';
      rejectUnknown(args, video
        ? ['prompt', 'duration_seconds', 'ratio', 'reference_images', 'model', 'wait_seconds', 'include_file', 'idempotency_key']
        : ['prompt', 'ratio', 'count', 'reference_images', 'model', 'wait_seconds', 'idempotency_key']);
      const model = str(args, 'model', { max: 100 }) ?? (video ? 'muse-video' : 'muse-image');
      checkModel(backend, model, video ? 'video' : 'image');
      const task = await backend.createTask({
        model,
        prompt: str(args, 'prompt', { required: true })!,
        images: images(args),
        durationSec: video ? int(args, 'duration_seconds', 1, 60, 10) : null,
        ratio: ratio(args),
        count: video ? 1 : int(args, 'count', 1, 4, 1)!,
        newChat: true,
        thread: null,
        account: null,
        idempotencyKey: str(args, 'idempotency_key', { max: 200 }),
      });
      const wait = int(args, 'wait_seconds', 0, MAX_WAIT_SECONDS, video ? 0 : 50)!;
      return toolResult(ctx, (wait ? await waitFor(ctx, task.id, wait, progressToken) : null) ?? task, bool(args, 'include_file'));
    }
    case 'generate_speech': {
      rejectUnknown(args, ['text', 'voice', 'language', 'speed', 'model', 'wait_seconds', 'include_file', 'idempotency_key']);
      const model = str(args, 'model', { max: 100 }) ?? 'muse-voice';
      checkModel(backend, model, 'audio');
      const speed = args?.speed;
      if (speed !== undefined && speed !== null && (typeof speed !== 'number' || !Number.isFinite(speed))) {
        throw new McpToolError('`speed` must be a number from 0.25 to 4.');
      }
      const task = await backend.createTask({
        model,
        prompt: str(args, 'text', { required: true, max: 6000 })!,
        images: [],
        durationSec: null,
        ratio: null,
        count: 1,
        voice: str(args, 'voice', { max: 80 }),
        language: str(args, 'language', { max: 10 }),
        speed: speed ?? null,
        newChat: true,
        thread: null,
        account: null,
        idempotencyKey: str(args, 'idempotency_key', { max: 200 }),
      });
      const wait = int(args, 'wait_seconds', 0, MAX_WAIT_SECONDS, 50)!;
      return toolResult(ctx, (wait ? await waitFor(ctx, task.id, wait, progressToken) : null) ?? task, bool(args, 'include_file'));
    }
    case 'get_task': {
      rejectUnknown(args, ['task_id', 'wait_seconds', 'include_file']);
      const id = str(args, 'task_id', { required: true, max: 200 })!;
      const wait = int(args, 'wait_seconds', 0, MAX_WAIT_SECONDS, 0)!;
      const task = wait ? await waitFor(ctx, id, wait, progressToken) : backend.getTask(id);
      if (!task) throw new McpToolError(`No task "${id}" for this API key.`);
      return toolResult(ctx, task, bool(args, 'include_file'));
    }
    case 'continue_task': {
      rejectUnknown(args, ['task_id', 'prompt', 'duration_seconds', 'ratio', 'reference_images', 'wait_seconds', 'include_file', 'idempotency_key']);
      const id = str(args, 'task_id', { required: true, max: 200 })!;
      const original = backend.getTask(id);
      if (!original) throw new McpToolError(`No task "${id}" for this API key.`);
      if (!isFinished(original)) throw new McpToolError(`Task "${id}" is still ${original.status}; wait for it with get_task first.`);
      if (!original.thread_url || !original.account_id) {
        throw new McpToolError(`Task "${id}" has no Muse conversation to continue (it never reached Muse). Start a new one instead.`);
      }
      if (!backend.allowsModel(original.model)) {
        throw new McpToolError(`This API key is not allowed to use model "${original.model}".`);
      }
      const video = original.kind === 'video';
      const task = await backend.createTask({
        model: original.model,
        prompt: str(args, 'prompt', { required: true })!,
        images: images(args),
        durationSec: video ? int(args, 'duration_seconds', 1, 60, original.requested_duration_sec ?? 10) : null,
        ratio: ratio(args),
        count: 1,
        newChat: false,
        thread: original.thread_url,
        account: original.account_id,
        idempotencyKey: str(args, 'idempotency_key', { max: 200 }),
      });
      const wait = int(args, 'wait_seconds', 0, MAX_WAIT_SECONDS, 0)!;
      return toolResult(ctx, (wait ? await waitFor(ctx, task.id, wait, progressToken) : null) ?? task, bool(args, 'include_file'));
    }
    case 'cancel_task': {
      rejectUnknown(args, ['task_id']);
      const id = str(args, 'task_id', { required: true, max: 200 })!;
      const task = backend.cancelTask(id);
      if (!task) throw new McpToolError(`No task "${id}" for this API key.`);
      return toolResult(ctx, task);
    }
    case 'list_tasks': {
      rejectUnknown(args, ['limit', 'status']);
      const limit = int(args, 'limit', 1, 50, 10)!;
      const status = str(args, 'status', { max: 20 });
      const tasks = backend.listTasks(status ? 100 : limit).filter((t) => !status || t.status === status).slice(0, limit);
      const text = tasks.length
        ? tasks.map((t) => `${t.id}  ${t.kind}  ${t.status}${t.url ? `  ${t.url}` : ''}`).join('\n')
        : 'No tasks yet.';
      return { content: [{ type: 'text', text }], structuredContent: { tasks: tasks.map(summary) } };
    }
    case 'list_models': {
      rejectUnknown(args, []);
      const models = backend.listModels();
      return {
        content: [{ type: 'text', text: models.map((m) => `${m.id} (${m.kind})`).join('\n') || 'No models available.' }],
        structuredContent: { models },
      };
    }
    default:
      return null;
  }
}

// ─── JSON-RPC dispatch ───────────────────────────────────────────────────

const ok = (id: JsonRpcId | null, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
const fail = (id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];
}

/** One JSON-RPC message in, its response out — null for notifications and
 *  for responses the client sends back (nothing to answer). */
export async function handleMcpMessage(message: unknown, ctx: McpContext): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return fail(null, JSONRPC.INVALID_REQUEST, 'Invalid Request');
  }
  const msg = message as JsonRpcRequest;
  const hasId = msg.id !== undefined && msg.id !== null;
  const id = hasId ? (msg.id as JsonRpcId) : null;
  if (msg.jsonrpc !== '2.0') return hasId ? fail(id, JSONRPC.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"') : null;
  if (typeof msg.method !== 'string') {
    // A response to something we never asked — or garbage. Nothing to send.
    if ('result' in msg || 'error' in msg) return null;
    return fail(id, JSONRPC.INVALID_REQUEST, 'Invalid Request: missing method');
  }
  if (hasId && typeof msg.id !== 'string' && typeof msg.id !== 'number') {
    return fail(null, JSONRPC.INVALID_REQUEST, 'Invalid Request: id must be a string or number');
  }
  // Notifications (initialized, cancelled, …) need no answer.
  if (!hasId) return null;

  const params = msg.params ?? {};
  try {
    switch (msg.method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'muse-gateway', title: 'Muse Gateway', version: ctx.serverVersion },
          instructions: SERVER_INSTRUCTIONS,
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        if (typeof name !== 'string' || !TOOLS.some((t) => t.name === name)) {
          return fail(id, JSONRPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
        }
        const progressToken = params?._meta?.progressToken;
        try {
          const result = await callTool(ctx, name, params?.arguments, progressToken);
          return ok(id, result);
        } catch (error) {
          // Tool problems go back as a result the model can read and fix.
          if (error instanceof McpToolError) {
            return ok(id, { content: [{ type: 'text', text: error.message }], isError: true });
          }
          throw error;
        }
      }
      // Declared empty so clients that probe them don't log errors.
      case 'resources/list':
        return ok(id, { resources: [] });
      case 'resources/templates/list':
        return ok(id, { resourceTemplates: [] });
      case 'prompts/list':
        return ok(id, { prompts: [] });
      default:
        return fail(id, JSONRPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(id, JSONRPC.INTERNAL_ERROR, 'Internal error', { detail: detail.slice(0, 500) });
  }
}
