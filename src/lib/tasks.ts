import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './dataDir';
import { assertDialableUrl } from './imageRefs';
import { mediaKindOf, type MediaInfo, withOrigin } from './mediaResult';
import { MEDIA_DIR } from './mediaStore';
import type { ChatResult } from './museDriver';
import { baseKind, type ModelKind } from './modelKind';
import { musePool } from './musePool';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import { buildTaskPrompt, signWebhook, type TaskInput } from './taskInput';

// Background jobs behind /v1/tasks: a video takes minutes, longer than most
// HTTP clients and proxies will hold a request open. Tasks survive in
// data/tasks.json so a finished result stays readable after a restart.

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface TaskRecord {
  id: string;
  /** `chat` = a media generation seen on /v1/chat/completions, tracked so
   *  the dashboard shows it too. `mcp` = started through the MCP endpoint.
   *  `bot` = submitted by the built-in Telegram bot.
   *  Absent on records from before it existed. */
  source?: 'api' | 'chat' | 'mcp' | 'bot';
  status: TaskStatus;
  model: string;
  /** Output the model promised. Absent on records from before it existed. */
  kind?: ModelKind;
  prompt: string;
  durationSec: number | null;
  newChat: boolean;
  thread: string | null;
  account: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  text: string | null;
  media: MediaInfo[];
  partial: boolean;
  threadUrl: string | null;
  accountId: string | null;
  error: string | null;
  owner: string;
  origin: string;
  idempotencyKey: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  /** Local callers may notify a service on their own machine or LAN. */
  webhookAllowPrivate: boolean;
  webhookStatus: 'pending' | 'delivered' | 'failed' | null;
  /** What the caller asked for, before the prompt was dressed for Muse —
   *  enough to run it again. Absent on chat-tracked and older records. */
  request?: {
    model: string;
    prompt: string;
    ratio: string | null;
    durationSec: number | null;
    /** Images asked for in the one request (absent = 1). */
    count?: number;
    /** Voice settings for speech tasks (absent = defaults). */
    voice?: string | null;
    language?: string | null;
    speed?: number | null;
    /** Reference files sent. They aren't kept, so such a task can't be
     *  rerun from the dashboard. */
    imageCount: number;
  };
}

export interface TaskContext {
  owner: string;
  origin: string;
  ua: string | null;
  allowPrivate: boolean;
  /** Which surface started it; defaults to the REST API. */
  source?: 'api' | 'mcp' | 'bot';
}

const TASKS_FILE = dataPath('tasks.json');
const MAX_FINISHED_TASKS = 500;
const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_RETRY_DELAYS_MS = [0, 5_000, 30_000];

const isFinished = (task: TaskRecord) =>
  task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled';

const seconds = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1000));

/** Public shape — the webhook secret, owner and origin never leave here. */
export function taskView(task: TaskRecord) {
  const final = task.media[task.media.length - 1] ?? null;
  return {
    id: task.id,
    object: 'task',
    source: task.source ?? 'api',
    status: task.status,
    model: task.model,
    kind: task.kind ?? baseKind(task.model),
    created_at: seconds(task.createdAt),
    started_at: seconds(task.startedAt),
    finished_at: seconds(task.finishedAt),
    requested_duration_sec: task.durationSec,
    url: final?.url ?? null,
    duration_sec: final?.duration_sec ?? null,
    media: task.media,
    partial: task.partial,
    text: task.text,
    thread_url: task.threadUrl,
    account_id: task.accountId,
    error: task.error,
    webhook_status: task.webhookStatus,
  };
}

class TaskService {
  private tasks: Map<string, TaskRecord> | null = null;
  private controllers = new Map<string, AbortController>();

  private store(): Map<string, TaskRecord> {
    if (this.tasks) return this.tasks;
    const saved = readJsonFile<TaskRecord[]>(TASKS_FILE, [], (v): v is TaskRecord[] => Array.isArray(v));
    this.tasks = new Map(saved.map((task) => [task.id, task]));
    // Work in flight died with the previous process and can't be collected.
    for (const task of this.tasks.values()) {
      if (!isFinished(task)) this.finish(task, 'failed', { error: 'Gateway restarted while this task was running.' });
    }
    return this.tasks;
  }

  private save() {
    const all = [...this.store().values()].sort((a, b) => b.createdAt - a.createdAt);
    const finished = all.filter(isFinished);
    for (const task of finished.slice(MAX_FINISHED_TASKS)) this.store().delete(task.id);
    writeJsonAtomic(TASKS_FILE, [...this.store().values()]);
  }

  private finish(task: TaskRecord, status: TaskStatus, patch: Partial<TaskRecord>) {
    Object.assign(task, patch, { status, finishedAt: Date.now() });
    if (task.webhookUrl) task.webhookStatus = 'pending';
    this.controllers.delete(task.id);
    this.save();
    void this.deliverWebhook(task);
  }

  private async deliverWebhook(task: TaskRecord) {
    if (!task.webhookUrl) return;
    const body = JSON.stringify({ event: `task.${task.status}`, task: taskView({ ...task, webhookStatus: null }) });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'muse-gateway',
      'X-Muse-Event': `task.${task.status}`,
      'X-Muse-Task-Id': task.id,
    };
    if (task.webhookSecret) headers['X-Muse-Signature'] = signWebhook(body, task.webhookSecret);
    for (const delay of WEBHOOK_RETRY_DELAYS_MS) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await assertDialableUrl(task.webhookUrl, task.webhookAllowPrivate);
        const res = await fetch(task.webhookUrl, {
          method: 'POST',
          headers,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        if (res.ok) {
          task.webhookStatus = 'delivered';
          this.save();
          return;
        }
        console.warn(`[Tasks] webhook ${task.id} answered HTTP ${res.status}`);
      } catch (error: any) {
        console.warn(`[Tasks] webhook ${task.id} failed:`, error?.message);
      }
    }
    task.webhookStatus = 'failed';
    this.save();
  }

  private async run(task: TaskRecord, input: TaskInput, images: string[], ua: string | null) {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    task.status = 'running';
    task.startedAt = Date.now();
    this.save();
    try {
      const result = await musePool.chat({
        prompt: task.prompt,
        images,
        signal: controller.signal,
        model: task.model,
        kind: task.kind,
        durationSec: task.durationSec,
        imageCount: input.count,
        ua,
        keyName: task.owner,
        endpoint: '/v1/tasks',
        newChat: task.newChat,
        thread: task.thread,
        pinAccount: task.account,
        idem: task.id,
      });
      if (task.status !== 'running') return; // cancelled while waiting
      this.complete(task, result);
    } catch (error: any) {
      if (task.status !== 'running') return;
      this.finish(task, 'failed', { error: error?.message || 'Generation failed.' });
    }
  }

  private complete(task: TaskRecord, result: ChatResult) {
    const media: MediaInfo[] = (
      result.mediaInfo ??
      result.media.map((url) => ({ url, kind: mediaKindOf(url), duration_sec: null }))
    ).map((item) => ({ ...item, url: withOrigin(item.url, task.origin) }));
    const shared = {
      text: result.text,
      threadUrl: result.threadUrl ?? null,
      accountId: result.accountId ?? null,
    };
    if ((task.kind ?? baseKind(task.model)) !== 'chat' && media.length === 0) {
      this.finish(task, 'failed', { ...shared, error: `Muse returned no media: ${result.text.slice(0, 300)}` });
      return;
    }
    this.finish(task, 'succeeded', { ...shared, media, partial: !!result.partial });
  }

  /** Starts a record for a media generation made through chat completions —
   *  the caller holds the request, so it can't be cancelled or webhooked. */
  trackChat(input: {
    model: string;
    kind: ModelKind;
    prompt: string;
    durationSec: number | null;
    owner: string;
    origin: string;
  }): string {
    const task: TaskRecord = {
      id: `task_${crypto.randomBytes(12).toString('hex')}`,
      source: 'chat',
      status: 'running',
      model: input.model,
      kind: input.kind,
      prompt: input.prompt,
      durationSec: input.durationSec,
      newChat: false,
      thread: null,
      account: null,
      createdAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: null,
      text: null,
      media: [],
      partial: false,
      threadUrl: null,
      accountId: null,
      error: null,
      owner: input.owner,
      origin: input.origin,
      idempotencyKey: null,
      webhookUrl: null,
      webhookSecret: null,
      webhookAllowPrivate: false,
      webhookStatus: null,
    };
    this.store().set(task.id, task);
    this.save();
    return task.id;
  }

  completeChat(id: string, result: ChatResult) {
    const task = this.store().get(id);
    if (task && !isFinished(task)) this.complete(task, result);
  }

  failChat(id: string, error: string) {
    const task = this.store().get(id);
    if (task && !isFinished(task)) this.finish(task, 'failed', { error });
  }

  find(id: string, owner: string): TaskRecord | null {
    const task = this.store().get(id);
    return task && (owner === 'open' || task.owner === owner) ? task : null;
  }

  findByIdempotencyKey(key: string, owner: string): TaskRecord | null {
    for (const task of this.store().values()) {
      if (task.idempotencyKey === key && task.owner === owner) return task;
    }
    return null;
  }

  /** Dashboard view: every key's tasks, with the prompt and key name the
   *  public API leaves out. Local-only — /api/* is closed to tunnel traffic. */
  dashboardList(limit: number) {
    return this.list('open', limit).map((task) => ({
      ...taskView(task),
      prompt: task.prompt,
      key_name: task.owner,
      /** Why "Retry" is unavailable for this task; null when it works. */
      retry_blocker: isFinished(task) ? this.retryBlocker(task) : null,
    }));
  }

  list(owner: string, limit: number): TaskRecord[] {
    return [...this.store().values()]
      .filter((task) => owner === 'open' || task.owner === owner)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  create(input: TaskInput, images: string[], context: TaskContext): TaskRecord {
    const task: TaskRecord = {
      id: `task_${crypto.randomBytes(12).toString('hex')}`,
      source: context.source ?? 'api',
      status: 'queued',
      model: input.model,
      kind: musePool.kindOf(input.model),
      prompt: buildTaskPrompt(input, musePool.kindOf(input.model)),
      durationSec: input.durationSec,
      newChat: input.newChat,
      thread: input.thread,
      account: input.account,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      text: null,
      media: [],
      partial: false,
      threadUrl: null,
      accountId: null,
      error: null,
      owner: context.owner,
      origin: context.origin,
      idempotencyKey: input.idempotencyKey,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret,
      webhookAllowPrivate: context.allowPrivate,
      webhookStatus: null,
      request: {
        model: input.model,
        prompt: input.prompt,
        ratio: input.ratio,
        durationSec: input.durationSec,
        count: input.count,
        voice: input.voice,
        language: input.language,
        speed: input.speed,
        imageCount: images.length,
      },
    };
    this.store().set(task.id, task);
    this.save();
    void this.run(task, input, images, context.ua);
    return task;
  }

  /** Why a task can't be rerun from the dashboard, or null when it can. */
  retryBlocker(task: TaskRecord): string | null {
    if (!isFinished(task)) return 'Task is still running.';
    if (task.source === 'chat' || !task.request) return 'Retry this from the app that sent it.';
    if (task.request.imageCount > 0) return 'It used reference images, which the gateway does not keep — resend it from the app that sent it.';
    if (task.thread || task.account || !task.newChat) {
      return 'It continued an earlier Muse conversation; rerun in a new chat it would lose that context — resend it from the app that sent it.';
    }
    return null;
  }

  /** Same request again as a new task, owned by the same key. No webhook:
   *  a manual rerun shouldn't notify the original caller's endpoint. */
  retry(task: TaskRecord, context: { origin: string; ua: string | null }): TaskRecord {
    const blocker = this.retryBlocker(task);
    if (blocker || !task.request) throw new Error(blocker ?? 'Cannot retry this task.');
    const { model, prompt, ratio, durationSec, count = 1, voice = null, language = null, speed = null } = task.request;
    return this.create(
      {
        model,
        prompt,
        images: [],
        durationSec,
        ratio,
        count,
        voice,
        language,
        speed,
        newChat: true,
        thread: null,
        account: null,
        idempotencyKey: null,
        webhookUrl: null,
        webhookSecret: null,
      },
      [],
      {
        owner: task.owner,
        origin: context.origin,
        ua: context.ua,
        allowPrivate: task.webhookAllowPrivate,
        source: task.source === 'mcp' || task.source === 'bot' ? task.source : 'api',
      },
    );
  }

  /** Delete finished tasks and the files they produced. Running ones stay —
   *  they'd come back the moment Muse answers. Returns what went away. */
  remove(ids: string[]): { removed: number; bytes: number } {
    let removed = 0;
    let bytes = 0;
    for (const id of ids) {
      const task = this.store().get(id);
      if (!task || !isFinished(task)) continue;
      for (const media of task.media) bytes += deleteLocalMedia(media.url);
      this.store().delete(id);
      removed++;
    }
    if (removed) this.save();
    return { removed, bytes };
  }

  /** Result files of these tasks that are still on disk, named for a zip:
   *  "03-video-task_ab12.mp4". Order follows `ids`. */
  mediaFiles(ids: string[]): { name: string; path: string; size: number }[] {
    const out: { name: string; path: string; size: number }[] = [];
    ids.forEach((id, index) => {
      const task = this.store().get(id);
      if (!task) return;
      const files = task.media.length ? task.media : [];
      files.forEach((media, part) => {
        const local = localMediaPath(media.url);
        if (!local) return;
        let size = 0;
        try {
          size = fs.statSync(local.file).size;
        } catch {
          return;
        }
        const kind = media.kind ?? task.kind ?? 'file';
        const ext = path.extname(local.name) || '';
        const n = String(index + 1).padStart(String(ids.length).length, '0');
        out.push({ name: `${n}-${kind}-${task.id}${files.length > 1 ? `-${part + 1}` : ''}${ext}`, path: local.file, size });
      });
    });
    return out;
  }

  /** Ids for a bulk clean-up: 'failed' = failed or cancelled, 'finished' =
   *  everything that is no longer running. */
  idsWhere(scope: 'failed' | 'finished'): string[] {
    return [...this.store().values()]
      .filter((t) => (scope === 'failed' ? t.status === 'failed' || t.status === 'cancelled' : isFinished(t)))
      .map((t) => t.id);
  }

  /** Stops collecting the result. A render already inside Muse keeps going
   *  there — only the gateway's wait can be cancelled. */
  cancel(task: TaskRecord): TaskRecord {
    if (isFinished(task) || task.source === 'chat') return task;
    const controller = this.controllers.get(task.id);
    this.finish(task, 'cancelled', {});
    controller?.abort();
    return task;
  }
}

const globalForTasks = globalThis as unknown as { museTasks?: TaskService };
export const taskService = globalForTasks.museTasks ?? new TaskService();
globalForTasks.museTasks = taskService;

/** File on disk behind a /api/media/<name> URL this gateway issued, or
 *  null for anything else (remote URLs, odd names). */
function localMediaPath(url: string): { file: string; name: string } | null {
  try {
    const match = new URL(url, 'http://local').pathname.match(/^\/api\/media\/([^/]+)$/);
    if (!match) return null;
    const name = decodeURIComponent(match[1]);
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
    return { file: path.join(MEDIA_DIR, name), name };
  } catch {
    return null;
  }
}

/** Remove a result this gateway stored. Returns the bytes freed. */
function deleteLocalMedia(url: string): number {
  const local = localMediaPath(url);
  if (!local) return 0;
  try {
    const size = fs.statSync(local.file).size;
    fs.unlinkSync(local.file);
    return size;
  } catch {
    return 0;
  }
}
