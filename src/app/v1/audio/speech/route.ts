import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { musePool } from '@/lib/musePool';
import { apiKeyService } from '@/lib/apiKeys';
import { isRemoteHeaders } from '@/lib/remoteDetect';
import { licenseGate } from '@/lib/licenseGate';
import { publicOrigin } from '@/lib/requestOrigin';
import { mediaKindOf } from '@/lib/mediaResult';
import { MEDIA_DIR } from '@/lib/mediaStore';
import { buildSpeechPrompt, parseSpeechOptions, speechTextError } from '@/lib/speech';
import { taskService } from '@/lib/tasks';

// OpenAI-compatible text-to-speech (POST /v1/audio/speech): Muse's voice tool
// reads `input` aloud and the response body is the mp3 itself. Muse only
// makes mp3, so response_format is accepted but always answered with mp3.

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

/** Bytes of a gateway-stored file, from its /api/media URL. */
function readLocalFile(url: string): Buffer | null {
  const m = /\/api\/media\/([^/?#]+)/.exec(url);
  if (!m) return null;
  try {
    return fs.readFileSync(path.join(MEDIA_DIR, path.basename(decodeURIComponent(m[1]))));
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Request body must be JSON.');
  const input = typeof body.input === 'string' ? body.input.trim() : '';
  const textError = speechTextError(input, 'input');
  if (textError) return fail(400, textError);
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'muse-voice';
  if (musePool.kindOf(model) !== 'audio') {
    return fail(400, `Model "${model}" does not make speech. Use muse-voice or a voice combo.`);
  }
  if (!apiKeyService.allowsModel(apiKey, model)) {
    return fail(403, `This API key is not allowed to use model "${model}".`, 'permission_error');
  }
  const options = parseSpeechOptions(body);
  if (options.ok === false) return fail(400, options.message);

  const sent = buildSpeechPrompt(input, options);
  const origin = publicOrigin(req);
  const keyName = apiKey === 'open' ? 'open' : apiKey.name;
  const tracked = taskService.trackChat({ model, kind: 'audio', prompt: sent, durationSec: null, owner: keyName, origin });

  try {
    const result = await musePool.chat({
      prompt: sent,
      images: [],
      signal: req.signal,
      model,
      kind: 'audio',
      ua: req.headers.get('user-agent'),
      keyName,
      endpoint: '/v1/audio/speech',
      newChat: true,
    });
    taskService.completeChat(tracked, result);
    const audio = (result.mediaInfo ?? result.media.map((url) => ({ url, kind: mediaKindOf(url) }))).find(
      (item) => item.kind === 'audio',
    );
    const bytes = audio ? readLocalFile(audio.url) : null;
    if (!bytes) {
      return fail(502, `Muse returned no audio: ${result.text.slice(0, 300)}`, 'upstream_error');
    }
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(bytes.length),
        'Content-Disposition': 'inline; filename="speech.mp3"',
      },
    });
  } catch (err: any) {
    taskService.failChat(tracked, err?.message || 'Upstream error');
    console.error('[API Speech Error]:', err);
    return fail(500, err?.message || 'Internal server error', 'server_error');
  }
}
