import { NextRequest, NextResponse } from 'next/server';
import { musePool } from '@/lib/musePool';
import { apiKeyService } from '@/lib/apiKeys';
import { extractPromptFromChatMessages } from '@/lib/promptExtractor';
import { extractWorkspaceCwd } from '@/lib/toolBridge';
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
  try {
    const apiKey = apiKeyService.resolveKey(
      req.headers.get('authorization') || req.headers.get('x-api-key')
    );
    if (apiKey === null) {
      return NextResponse.json(
        { error: { message: 'Invalid or missing API key.', type: 'authentication_error' } },
        { status: 401, headers: corsHeaders }
      );
    }

    const body: ChatCompletionRequest = await req.json();
    const { model = 'muse-chat', messages = [], stream = false, new_chat = false } = body;

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

    // Multimodal parts on the last user message — image_url entries arrive as
    // data: URLs and are attached to the Muse composer (frame bridging).
    const images: string[] = [];
    const lastUser = [...messages].reverse().find((m: any) => m?.role === 'user');
    if (Array.isArray(lastUser?.content)) {
      for (const part of lastUser.content) {
        const u =
          (typeof part?.image_url === 'object' ? part.image_url?.url : part?.image_url) ||
          (part?.type === 'input_image' ? part?.image_url : null);
        if (typeof u === 'string' && u.startsWith('data:')) images.push(u);
      }
    }

    if (!formattedPrompt) {
      return NextResponse.json(
        { error: { message: 'Could not extract a user prompt from messages.', type: 'invalid_request_error' } },
        { status: 400, headers: corsHeaders }
      );
    }

    const cwd = extractWorkspaceCwd(body);
    const keyName = apiKey === 'open' ? 'open' : apiKey.name;
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
          try {
            const { media } = await musePool.chat({
              prompt: formattedPrompt,
              images,
              signal: req.signal,
              cwd,
              model,
              ua,
              keyName,
              endpoint: '/v1/chat/completions',
              newChat: new_chat,
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

            // Media attachments arrive after the reply completes — emit as a
            // final content delta so streaming clients see the links too.
            // Local /api/media/* paths resolve against the request origin.
            if (media.length) {
              const mediaPayload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content:
                        '\n\nAttachments:\n' +
                        media.map((u) => `- ${u.startsWith('http') ? u : new URL(req.url).origin + u}`).join('\n'),
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
    const { text, media } = await musePool.chat({
      prompt: formattedPrompt,
      images,
      signal: req.signal,
      cwd,
      model,
      ua,
      keyName,
      endpoint: '/v1/chat/completions',
      newChat: new_chat,
    });
    const origin = new URL(req.url).origin;
    const content = media.length
      ? `${text}\n\nAttachments:\n${media.map((u) => `- ${u.startsWith('http') ? u : origin + u}`).join('\n')}`
      : text;
    const promptTokens = Math.max(1, Math.round(formattedPrompt.length / 4));
    const completionTokens = Math.max(1, Math.round(content.length / 4));

    const responsePayload = {
      id: completionId,
      object: 'chat.completion',
      created,
      model,
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
