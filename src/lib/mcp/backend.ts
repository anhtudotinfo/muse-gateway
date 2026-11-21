import fs from 'node:fs/promises';
import path from 'node:path';
import { apiKeyService } from '@/lib/apiKeys';
import type { ApiCaller } from '@/lib/apiGuard';
import { ImageRefError, loadImageRefs } from '@/lib/imageRefs';
import { MEDIA_DIR } from '@/lib/mediaStore';
import { baseKind } from '@/lib/modelKind';
import { SUPPORTED_MODELS } from '@/lib/museDriver';
import { musePool } from '@/lib/musePool';
import { MAX_SPEECH_TASK_CHARS, speechTextError } from '@/lib/speech';
import { parseTaskInput } from '@/lib/taskInput';
import { taskService, taskView } from '@/lib/tasks';
import { McpToolError, type McpBackend, type McpTask, type TaskKind } from './core';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/** File under MEDIA_DIR for a /api/media/<name> URL this gateway issued. */
function localMediaFile(url: string): { file: string; name: string; mimeType: string } | null {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://local').pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/api\/media\/([^/]+)$/);
  if (!match) return null;
  const name = decodeURIComponent(match[1]);
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  const mimeType = MIME[path.extname(name).toLowerCase()];
  if (!mimeType) return null;
  return { file: path.join(MEDIA_DIR, name), name, mimeType };
}

const toMcpTask = (view: ReturnType<typeof taskView>): McpTask => ({
  id: view.id,
  status: view.status,
  model: view.model,
  kind: view.kind,
  url: view.url,
  duration_sec: view.duration_sec,
  requested_duration_sec: view.requested_duration_sec,
  media: view.media,
  partial: view.partial,
  text: view.text,
  thread_url: view.thread_url,
  account_id: view.account_id,
  error: view.error,
  created_at: view.created_at,
  finished_at: view.finished_at,
});

/**
 * The MCP tools, bound to one authenticated caller. Same rules as
 * POST /v1/tasks: the key's model allow-list, the same input validation,
 * private-network refs only for local callers, tasks owned by the key.
 */
export function createMcpBackend(caller: ApiCaller, request: { origin: string; ua: string | null }): McpBackend {
  const owner = caller.keyName;
  return {
    async createTask(args) {
      const parsed = parseTaskInput({
        model: args.model,
        prompt: args.prompt,
        images: args.images,
        duration: args.durationSec,
        ratio: args.ratio,
        count: args.count,
        new_chat: args.newChat,
        thread: args.thread,
        account: args.account,
        idempotency_key: args.idempotencyKey,
        voice: args.voice ?? undefined,
        language: args.language ?? undefined,
        speed: args.speed ?? undefined,
      });
      if (parsed.ok === false) throw new McpToolError(parsed.message);
      const { input } = parsed;
      if (musePool.kindOf(input.model) === 'audio') {
        const tooLong = speechTextError(input.prompt, 'text', MAX_SPEECH_TASK_CHARS);
        if (tooLong) throw new McpToolError(tooLong);
      }
      if (input.idempotencyKey) {
        const existing = taskService.findByIdempotencyKey(input.idempotencyKey, owner);
        if (existing) return toMcpTask(taskView(existing));
      }
      let refs: string[];
      try {
        refs = await loadImageRefs(input.images, !caller.remote);
      } catch (error) {
        if (error instanceof ImageRefError) throw new McpToolError(error.message);
        throw error;
      }
      const task = taskService.create(input, refs, {
        owner,
        origin: request.origin,
        ua: request.ua,
        allowPrivate: !caller.remote,
        source: 'mcp',
      });
      return toMcpTask(taskView(task));
    },

    getTask(id) {
      const task = taskService.find(id, owner);
      return task ? toMcpTask(taskView(task)) : null;
    },

    listTasks(limit) {
      return taskService.list(owner, limit).map((t) => toMcpTask(taskView(t)));
    },

    cancelTask(id) {
      const task = taskService.find(id, owner);
      return task ? toMcpTask(taskView(taskService.cancel(task))) : null;
    },

    listModels() {
      const all: { id: string; kind: TaskKind }[] = [
        ...SUPPORTED_MODELS.map((m) => ({ id: m.id, kind: baseKind(m.id) })),
        ...musePool.getCombos().map((c) => ({ id: c.name, kind: c.kind })),
      ];
      // No chat tool here — only what the image, video and speech tools can use.
      return all.filter((m) => m.kind !== 'chat' && this.allowsModel(m.id));
    },

    kindOf(model) {
      return musePool.kindOf(model);
    },

    allowsModel(model) {
      return caller.apiKey === 'open' || apiKeyService.allowsModel(caller.apiKey, model);
    },

    /** Only files this gateway stored itself — never fetches a URL. */
    async readMedia(url, maxBytes) {
      const local = localMediaFile(url);
      if (!local) return null;
      const stat = await fs.stat(local.file).catch(() => null);
      if (!stat?.isFile() || stat.size > maxBytes) return null;
      return { data: (await fs.readFile(local.file)).toString('base64'), mimeType: local.mimeType };
    },

    async mediaInfo(url) {
      const local = localMediaFile(url);
      if (!local) return null;
      const stat = await fs.stat(local.file).catch(() => null);
      return stat?.isFile() ? { mimeType: local.mimeType, size: stat.size, name: local.name } : null;
    },
  };
}
