import { NextRequest, NextResponse } from 'next/server';
import { musePool } from '@/lib/musePool';
import { apiKeyService } from '@/lib/apiKeys';
import { isRemoteHeaders } from '@/lib/remoteDetect';
import { extractPromptFromChatMessages } from '@/lib/promptExtractor';
import { extractWorkspaceCwd } from '@/lib/toolBridge';
import { licenseGate } from '@/lib/licenseGate';
import { publicOrigin } from '@/lib/requestOrigin';
import { collectImageRefs, ImageRefError, loadImageRefs } from '@/lib/imageRefs';
import { withOrigin } from '@/lib/mediaResult';
import type { ChatResult } from '@/lib/museDriver';
import { taskService } from '@/lib/tasks';
import type { ChatCompletionRequest } from '@/types';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const gate = licenseGate(corsHeaders);
  if (gate) return gate;
  try {
    const apiKey = apiKeyService.resolveKey(
      req.headers.get('authorization') || req.headers.get('x-api-key'),
      isRemoteHeaders(req.headers)
    );
    if (apiKey === null) {
      return NextResponse.json(
        { error: { message: 'Invalid or missing API key.', type: 'authentication_error' } },
        { status: 401, headers: corsHeaders }
      );
    }

    const body: ChatCompletionRequest = await req.json();
    const { model = 'muse-chat', messages = [], stream = false, new_chat = false } = body;
    // Thread continuation + account pinning — follow-up tasks must return to
    // the same Muse conversation, and that thread only exists on the account
    // that created it.
    const thread: string | null = (body as any).thread ?? (body as any).thread_id ?? null;
    const pinAccount: string | null = (body as any).account ?? (body as any).account_id ?? null;
    // Idempotency: a retried task must not re-post its prompt — the pool
    // coalesces on this key and the driver resumes the in-flight reply.
    const idem: string | null =
      (body as any).idempotency_key ?? (body as any).task_id ?? (body as any).task ?? null;

    // Per-key access restriction: key may only call allow-listed models/combos
    if (!apiKeyService.allowsModel(apiKey, model)) {
      return NextResponse.json(
        { error: { message: `This API key is not allowed to use model "${model}".`, type: 'permission_error' } },
        { status: 403, headers: corsHeaders }
      );
    }
    const ua = req.headers.get('user-agent');

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: { message: 'Messages array is required and cannot be empty.', type: 'invalid_request_error' } },
        { status: 400, headers: corsHeaders }
      );
    }

    // Lấy tin nhắn user cuối, bỏ qua context envelopes do client inject
    const formattedPrompt = extractPromptFromChatMessages(messages);

    if (!formattedPrompt) {
      return NextResponse.json(
        { error: { message: 'Could not extract a user prompt from messages.', type: 'invalid_request_error' } },
        { status: 400, headers: corsHeaders }
      );
    }

    // Multimodal parts on the last user message — image_url entries (data:
    // or http URLs) are attached to the Muse composer (frame bridging).
    const lastUser = [...messages].reverse().find((m: any) => m?.role === 'user');
    let images: string[];
    try {
      images = await loadImageRefs(
        collectImageRefs(lastUser?.content),
        !isRemoteHeaders(req.headers)
      );
    } catch (err) {
      if (!(err instanceof ImageRefError)) throw err;
      return NextResponse.json(
        { error: { message: err.message, type: 'invalid_request_error' } },
        { status: 400, headers: corsHeaders }
      );
    }
    const durationSec = Number((body as any).duration ?? (body as any).duration_sec) || null;
    const origin = publicOrigin(req);
    const keyName = apiKey === 'open' ? 'open' : apiKey.name;
    // Image/video requests land on the dashboard's media page; a chat reply
    // that still came back with a file is recorded once it arrives.
    const kind = musePool.kindOf(model);
    const track = () => taskService.trackChat({ model, kind, prompt: formattedPrompt, durationSec, owner: keyName, origin });
    const tracked = kind !== 'chat' ? track() : null;
    const settle = (result: ChatResult | null, error?: string) => {
      if (!tracked) {
        if (result?.media.length && !req.signal.aborted) taskService.completeChat(track(), result);
        return;
      }
      if (result && !req.signal.aborted) taskService.completeChat(tracked, result);
      else taskService.failChat(tracked, error || 'The client disconnected before the result arrived.');
    };
    const museMeta = (result: ChatResult) => ({
      account_id: result.accountId ?? null,
      thread_url: result.threadUrl ?? null,
      media: (result.mediaInfo ?? []).map((item) => ({ ...item, url: withOrigin(item.url, origin) })),
      partial: !!result.partial,
    });

    const cwd = extractWorkspaceCwd(body);
    const completionId = 'chatcmpl-' + Date.now();
    const created = Math.floor(Date.now() / 1000);

    // Handle Streaming (SSE)
    if (stream) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          // Client may disconnect/retry at any time — never let an enqueue
          // on a dead stream crash the handler.
          const safeEnqueue = (data: Uint8Array) => {
            try {
              controller.enqueue(data);
            } catch {}
          };
          const safeClose = () => {
            try {
              controller.close();
            } catch {}
          };
          // Flush the response immediately — proxies measure their upstream
          // timeout to first byte. Then keep emitting SSE comments so the
          // stream never idles while generation runs (a silent stream past
          // ~100s is cut by Cloudflare's edge even though the work is fine).
          safeEnqueue(encoder.encode(': open\n\n'));
          const keepAlive = setInterval(
            () => safeEnqueue(encoder.encode(': ka\n\n')),
            15_000,
          );
          try {
            const result = await musePool.chat({
              prompt: formattedPrompt,
              images,
              signal: req.signal,
              cwd,
              model,
              durationSec,
              ua,
              keyName,
              endpoint: '/v1/chat/completions',
              newChat: new_chat,
              thread,
              pinAccount,
              idem,
              onChunk: (chunk: string) => {
                const ssePayload = {
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: chunk },
                      finish_reason: null,
                    },
                  ],
                };
                safeEnqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
              },
            });
            clearInterval(keepAlive);
            settle(result);
            const { media, threadUrl } = result;

            // Media attachments arrive after the reply completes — emit as a
            // final content delta so streaming clients see the links too.
            // Local /api/media/* paths resolve against the request origin.
            if (media.length || threadUrl) {
              const mediaPayload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model,
                muse: museMeta(result),
                choices: [
                  {
                    index: 0,
                    delta: {
                      content:
                        (media.length
                          ? '\n\nAttachments:\n' +
                            media.map((u) => `- ${withOrigin(u, origin)}`).join('\n')
                          : '') +
                        (threadUrl ? `\n\nThread: ${threadUrl}` : ''),
                    },
                    finish_reason: null,
                  },
                ],
              };
              safeEnqueue(encoder.encode(`data: ${JSON.stringify(mediaPayload)}\n\n`));
            }

            // Send stop chunk
            const stopPayload = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model,
              muse: museMeta(result),
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
                },
              ],
            };
            safeEnqueue(encoder.encode(`data: ${JSON.stringify(stopPayload)}\n\n`));
            safeEnqueue(encoder.encode('data: [DONE]\n\n'));
            safeClose();
          } catch (err: any) {
            clearInterval(keepAlive);
            settle(null, err?.message || 'Upstream error');
            console.error('[API Stream Error]:', err);
            const errPayload = {
              error: { message: err?.message || 'Upstream error', type: 'upstream_error' },
            };
            safeEnqueue(encoder.encode(`data: ${JSON.stringify(errPayload)}\n\n`));
            safeClose();
          }
        },
      });

      return new Response(customReadable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          ...corsHeaders,
        },
      });
    }

    // Handle Synchronous / Non-streaming JSON response
    let result: ChatResult;
    try {
      result = await musePool.chat({
        prompt: formattedPrompt,
        images,
        signal: req.signal,
        cwd,
        model,
        durationSec,
        ua,
        keyName,
        endpoint: '/v1/chat/completions',
        newChat: new_chat,
        thread,
        pinAccount,
        idem,
      });
    } catch (err: any) {
      settle(null, err?.message || 'Upstream error');
      throw err;
    }
    settle(result);
    const { text, media, threadUrl } = result;
    const content =
      (media.length
        ? `${text}\n\nAttachments:\n${media.map((u) => `- ${withOrigin(u, origin)}`).join('\n')}`
        : text) + (threadUrl ? `\n\nThread: ${threadUrl}` : '');
    const promptTokens = Math.max(1, Math.round(formattedPrompt.length / 4));
    const completionTokens = Math.max(1, Math.round(content.length / 4));

    const responsePayload = {
      id: completionId,
      object: 'chat.completion',
      created,
      model,
      muse: museMeta(result),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };

    return NextResponse.json(responsePayload, { headers: corsHeaders });
  } catch (err: any) {
    console.error('[API Completion Error]:', err);
    return NextResponse.json(
      { error: { message: err?.message || 'Internal server error', type: 'server_error' } },
      { status: 500, headers: corsHeaders }
    );
  }
}
