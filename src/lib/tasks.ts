import crypto from 'node:crypto';
import { dataPath } from './dataDir';
import { assertDialableUrl } from './imageRefs';
import { mediaKindOf, type MediaInfo, withOrigin } from './mediaResult';
import { musePool } from './musePool';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import { buildTaskPrompt, signWebhook, type TaskInput } from './taskInput';

// Background jobs behind /v1/tasks: a video takes minutes, longer than most
// HTTP clients and proxies will hold a request open. Tasks survive in
// data/tasks.json so a finished result stays readable after a restart.

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface TaskRecord {
  id: string;
  status: TaskStatus;
  model: string;
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
}

export interface TaskContext {
  owner: string;
  origin: string;
  ua: string | null;
  allowPrivate: boolean;
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
    status: task.status,
    model: task.model,
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
        durationSec: task.durationSec,
        ua,
        keyName: task.owner,
        endpoint: '/v1/tasks',
        newChat: task.newChat,
        thread: task.thread,
        pinAccount: task.account,
        idem: task.id,
      });
      if (task.status !== 'running') return; // cancelled while waiting
      const media: MediaInfo[] = (
        result.mediaInfo ??
        result.media.map((url) => ({ url, kind: mediaKindOf(url), duration_sec: null }))
      ).map((item) => ({ ...item, url: withOrigin(item.url, task.origin) }));
      const shared = {
        text: result.text,
        threadUrl: result.threadUrl ?? null,
        accountId: result.accountId ?? null,
      };
      if (/^muse-(video|image)/i.test(task.model) && media.length === 0) {
        this.finish(task, 'failed', { ...shared, error: `Muse returned no media: ${result.text.slice(0, 300)}` });
        return;
      }
      this.finish(task, 'succeeded', { ...shared, media, partial: !!result.partial });
    } catch (error: any) {
      if (task.status !== 'running') return;
      this.finish(task, 'failed', { error: error?.message || 'Generation failed.' });
    }
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
      status: 'queued',
      model: input.model,
      prompt: buildTaskPrompt(input),
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
    };
    this.store().set(task.id, task);
    this.save();
    void this.run(task, input, images, context.ua);
    return task;
  }

  /** Stops collecting the result. A render already inside Muse keeps going
   *  there — only the gateway's wait can be cancelled. */
  cancel(task: TaskRecord): TaskRecord {
    if (isFinished(task)) return task;
    const controller = this.controllers.get(task.id);
    this.finish(task, 'cancelled', {});
    controller?.abort();
    return task;
  }
}

const globalForTasks = globalThis as unknown as { museTasks?: TaskService };
export const taskService = globalForTasks.museTasks ?? new TaskService();
globalForTasks.museTasks = taskService;
