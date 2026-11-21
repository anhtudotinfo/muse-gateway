import { NextRequest, NextResponse } from 'next/server';
import { apiKeyService } from '@/lib/apiKeys';
import { authorizeRequest } from '@/lib/apiGuard';
import { assertDialableUrl, ImageRefError, loadImageRefs } from '@/lib/imageRefs';
import { musePool } from '@/lib/musePool';
import { publicOrigin } from '@/lib/requestOrigin';
import { MAX_SPEECH_TASK_CHARS, speechTextError } from '@/lib/speech';
import { parseTaskInput } from '@/lib/taskInput';
import { taskService, taskView } from '@/lib/tasks';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

const invalid = (message: string, status = 400) =>
  NextResponse.json(
    { error: { message, type: 'invalid_request_error' } },
    { status, headers: corsHeaders },
  );

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const caller = authorizeRequest(req, corsHeaders);
  if (caller instanceof NextResponse) return caller;

  const body = await req.json().catch(() => null);
  const parsed = parseTaskInput(body);
  if (parsed.ok === false) return invalid(parsed.message);
  const { input } = parsed;
  if (musePool.kindOf(input.model) === 'audio') {
    const tooLong = speechTextError(input.prompt, 'prompt', MAX_SPEECH_TASK_CHARS);
    if (tooLong) return invalid(tooLong);
  }

  if (!apiKeyService.allowsModel(caller.apiKey, input.model)) {
    return NextResponse.json(
      { error: { message: `This API key is not allowed to use model "${input.model}".`, type: 'permission_error' } },
      { status: 403, headers: corsHeaders },
    );
  }
  if (input.idempotencyKey) {
    const existing = taskService.findByIdempotencyKey(input.idempotencyKey, caller.keyName);
    if (existing) return NextResponse.json(taskView(existing), { headers: corsHeaders });
  }

  let images: string[];
  try {
    if (input.webhookUrl) await assertDialableUrl(input.webhookUrl, !caller.remote);
    images = await loadImageRefs(input.images, !caller.remote);
  } catch (error) {
    if (error instanceof ImageRefError) return invalid(error.message);
    throw error;
  }

  const task = taskService.create(input, images, {
    owner: caller.keyName,
    origin: publicOrigin(req),
    ua: req.headers.get('user-agent'),
    allowPrivate: !caller.remote,
  });
  return NextResponse.json(taskView(task), { status: 202, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const caller = authorizeRequest(req, corsHeaders);
  if (caller instanceof NextResponse) return caller;
  const requested = Number(req.nextUrl.searchParams.get('limit'));
  const limit = requested > 0 ? Math.min(requested, 100) : 20;
  return NextResponse.json(
    { object: 'list', data: taskService.list(caller.keyName, limit).map(taskView) },
    { headers: corsHeaders },
  );
}
