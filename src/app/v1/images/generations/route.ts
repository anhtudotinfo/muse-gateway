import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { musePool } from '@/lib/musePool';
import { apiKeyService } from '@/lib/apiKeys';
import { isRemoteHeaders } from '@/lib/remoteDetect';
import { licenseGate } from '@/lib/licenseGate';
import { publicOrigin } from '@/lib/requestOrigin';
import { mediaKindOf, withOrigin } from '@/lib/mediaResult';
import { MEDIA_DIR } from '@/lib/mediaStore';
import { ratioFromSize } from '@/lib/modelKind';
import { buildTaskPrompt } from '@/lib/taskInput';
import { taskService } from '@/lib/tasks';

// OpenAI-compatible image generation (POST /v1/images/generations), so tools
// with a built-in "generate image" feature work without going through chat.
// Muse makes one set of images per request; `n` caps how many come back.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

const fail = (status: number, message: string, type = 'invalid_request_error') =>
  NextResponse.json({ error: { message, type } }, { status, headers: corsHeaders });

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/** Inline a gateway-stored file as base64 (response_format=b64_json). */
function readLocalMedia(url: string): string | null {
  const m = /\/api\/media\/([^/?#]+)/.exec(url);
  if (!m) return null;
  try {
    return fs.readFileSync(path.join(MEDIA_DIR, path.basename(decodeURIComponent(m[1])))).toString('base64');
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const gate = licenseGate(corsHeaders);
  if (gate) return gate;

  const apiKey = apiKeyService.resolveKey(
    req.headers.get('authorization') || req.headers.get('x-api-key'),
    isRemoteHeaders(req.headers),
    req.headers.get('origin'),
  );
  if (apiKey === null) return fail(401, 'Invalid or missing API key.', 'authentication_error');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(400, 'Request body must be JSON.');
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return fail(400, 'prompt is required.');
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'muse-image';
  if (musePool.kindOf(model) !== 'image') {
    return fail(400, `Model "${model}" does not make images. Use muse-image or an image combo.`);
  }
  if (!apiKeyService.allowsModel(apiKey, model)) {
    return fail(403, `This API key is not allowed to use model "${model}".`, 'permission_error');
  }
  const n = Math.min(4, Math.max(1, Number.parseInt(String(body.n ?? 1), 10) || 1));
  const format = body.response_format === 'b64_json' ? 'b64_json' : 'url';

  const sent = buildTaskPrompt({ prompt, durationSec: null, ratio: ratioFromSize(body.size), count: n }, 'image');
  const origin = publicOrigin(req);
  const keyName = apiKey === 'open' ? 'open' : apiKey.name;
  const tracked = taskService.trackChat({ model, kind: 'image', prompt: sent, durationSec: null, owner: keyName, origin });

  try {
    const result = await musePool.chat({
      prompt: sent,
      images: [],
      signal: req.signal,
      model,
      kind: 'image',
      ua: req.headers.get('user-agent'),
      keyName,
      endpoint: '/v1/images/generations',
      newChat: true,
      imageCount: n,
    });
    taskService.completeChat(tracked, result);
    const images = (result.mediaInfo ?? result.media.map((url) => ({ url, kind: mediaKindOf(url) })))
      .filter((item) => item.kind === 'image')
      .slice(0, n);
    if (!images.length) {
      return fail(502, `Muse returned no image: ${result.text.slice(0, 300)}`, 'upstream_error');
    }
    const data = images.map((item) => {
      const url = withOrigin(item.url, origin);
      const b64 = format === 'b64_json' ? readLocalMedia(item.url) : null;
      return b64 ? { b64_json: b64, revised_prompt: sent } : { url, revised_prompt: sent };
    });
    return NextResponse.json({ created: Math.floor(Date.now() / 1000), data }, { headers: corsHeaders });
  } catch (err: any) {
    taskService.failChat(tracked, err?.message || 'Upstream error');
    console.error('[API Images Error]:', err);
    return fail(500, err?.message || 'Internal server error', 'server_error');
  }
}
