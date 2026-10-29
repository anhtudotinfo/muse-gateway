import { NextRequest, NextResponse } from 'next/server';
import { musePool } from '@/lib/musePool';
import { apiKeyService } from '@/lib/apiKeys';
import { isRemoteHeaders } from '@/lib/remoteDetect';
import { extractPromptFromResponseInput } from '@/lib/promptExtractor';
import {
  buildBridgeInstructions,
  collectBridgeTools,
  parseMuseToolCalls,
  extractWorkspaceCwd,
  buildProjectContext,
} from '@/lib/toolBridge';
import { licenseGate } from '@/lib/licenseGate';
import { publicOrigin } from '@/lib/requestOrigin';

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

    const body = await req.json();
    console.log('[Responses API Request received]:', JSON.stringify(body).slice(0, 300));

    const model = body.model || 'muse-chat';

    // Per-key access restriction: key may only call allow-listed models/combos
    if (!apiKeyService.allowsModel(apiKey, model)) {
      return NextResponse.json(
        { error: { message: `This API key is not allowed to use model "${model}".`, type: 'permission_error' } },
        { status: 403, headers: corsHeaders }
      );
    }
    const ua = req.headers.get('user-agent');
    const keyName = apiKey === 'open' ? 'open' : apiKey.name;
    const stream = body.stream ?? true;
    const prompt = extractPromptFromResponseInput(body.input || body.messages || body.prompt);

    console.log('[Responses API Extracted User Prompt]:', prompt.slice(0, 200));

    if (!prompt) {
      return NextResponse.json(
        { error: { message: 'Could not extract a user prompt from the input.', type: 'invalid_request_error' } },
        { status: 400, headers: corsHeaders }
      );
    }

    // Tool definitions advertised by the client (Codex). When present, the
    // Muse prompt carries bridge instructions and replies may contain
    // tool-call markers instead of plain text.
    const tools = collectBridgeTools(body);

    // The bridge runs on the user's machine: when Codex reports a workspace
    // via <environment_context><cwd>, attach a bounded project snapshot so
    // Muse can reason about the project even though it cannot emit client-side
    // tool calls.
    const cwd = extractWorkspaceCwd(body);
    const projectCtx = buildProjectContext(cwd);

    const musePrompt =
      (tools.length ? `${buildBridgeInstructions(tools)}\n` : '') +
      projectCtx +
      prompt;

    const responseId = 'resp_' + Date.now();
    const itemId = 'item_' + Date.now();
    const created = Math.floor(Date.now() / 1000);

    const buildOutputItems = (reply: string) => {
      const calls = tools.length ? parseMuseToolCalls(reply) : [];
      if (calls.length > 0) {
        return calls.map((call, i) => ({
          id: `fc_${Date.now()}_${i}`,
          type: 'function_call',
          call_id: call.callId,
          name: call.name,
          arguments: call.arguments,
          status: 'completed',
        }));
      }
      return [
        {
          id: itemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: reply }],
        },
      ];
    };

    const usageFor = (reply: string) => ({
      total_tokens: Math.max(1, Math.round(reply.length / 4)),
      input_tokens: Math.max(1, Math.round(prompt.length / 4)),
      output_tokens: Math.max(1, Math.round(reply.length / 4)),
    });

    if (stream) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          // Client (Codex) may disconnect/retry at any time; never let an
          // enqueue on a dead stream crash the handler.
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
          const sendEvent = (type: string, payload: Record<string, any>) =>
            safeEnqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`));

          const emitMessageItemAdded = () => {
            sendEvent('response.output_item.added', {
              response_id: responseId,
              output_index: 0,
              item: {
                id: itemId,
                type: 'message',
                status: 'in_progress',
                role: 'assistant',
                content: [],
              },
            });
            sendEvent('response.content_part.added', {
              response_id: responseId,
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              part: { type: 'output_text', text: '' },
            });
          };

          // The chat call below can run for minutes while the stream sits
          // silent — edge proxies cut idle streams (~100s on Cloudflare).
          // SSE comments keep bytes flowing until real events resume.
          const keepAlive = setInterval(
            () => safeEnqueue(encoder.encode(': ka\n\n')),
            15_000,
          );
          try {
            sendEvent('response.created', {
              response: {
                id: responseId,
                object: 'response',
                created_at: created,
                model,
                status: 'in_progress',
                output: [],
              },
            });

            let replyText = '';
            let replyMedia: string[] = [];
            if (tools.length) {
              // Buffered mode: a tool-call marker must never leak as message
              // text mid-stream — output items are only emitted once known.
              const r = await musePool.chat({
                prompt: musePrompt,
                signal: req.signal,
                cwd,
                model,
                ua,
                keyName,
                endpoint: '/v1/responses',
              });
              replyText = r.text;
              replyMedia = r.media;
            } else {
              emitMessageItemAdded();
              const r = await musePool.chat({
                prompt: musePrompt,
                signal: req.signal,
                cwd,
                model,
                ua,
                keyName,
                endpoint: '/v1/responses',
                onChunk: (chunk: string) => {
                  replyText += chunk;
                  sendEvent('response.output_text.delta', {
                    response_id: responseId,
                    item_id: itemId,
                    output_index: 0,
                    content_index: 0,
                    delta: chunk,
                  });
                },
              });
              replyMedia = r.media;
            }
            clearInterval(keepAlive);

            // Generated media links arrive with the completed reply — append
            // them (and stream a final delta) so clients can resolve files.
            if (replyMedia.length) {
              const origin = publicOrigin(req);
              const block =
                '\n\nAttachments:\n' +
                replyMedia.map((u) => `- ${u.startsWith('http') ? u : origin + u}`).join('\n');
              replyText += block;
              if (!tools.length) {
                sendEvent('response.output_text.delta', {
                  response_id: responseId,
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  delta: block,
                });
              }
            }

            const calls = tools.length ? parseMuseToolCalls(replyText) : [];

            if (calls.length > 0) {
              calls.forEach((call, i) => {
                const fcId = `fc_${Date.now()}_${i}`;
                sendEvent('response.output_item.added', {
                  response_id: responseId,
                  output_index: i,
                  item: {
                    id: fcId,
                    type: 'function_call',
                    call_id: call.callId,
                    name: call.name,
                    arguments: '',
                    status: 'in_progress',
                  },
                });
                sendEvent('response.function_call_arguments.delta', {
                  response_id: responseId,
                  item_id: fcId,
                  output_index: i,
                  delta: call.arguments,
                });
                sendEvent('response.function_call_arguments.done', {
                  response_id: responseId,
                  item_id: fcId,
                  output_index: i,
                  arguments: call.arguments,
                });
                sendEvent('response.output_item.done', {
                  response_id: responseId,
                  output_index: i,
                  item: {
                    id: fcId,
                    type: 'function_call',
                    call_id: call.callId,
                    name: call.name,
                    arguments: call.arguments,
                    status: 'completed',
                  },
                });
              });
            } else {
              if (tools.length) emitMessageItemAdded();
              sendEvent('response.output_text.done', {
                response_id: responseId,
                item_id: itemId,
                output_index: 0,
                content_index: 0,
                text: replyText,
              });
              sendEvent('response.content_part.done', {
                response_id: responseId,
                item_id: itemId,
                output_index: 0,
                content_index: 0,
                part: { type: 'output_text', text: replyText },
              });
              sendEvent('response.output_item.done', {
                response_id: responseId,
                output_index: 0,
                item: {
                  id: itemId,
                  type: 'message',
                  status: 'completed',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: replyText }],
                },
              });
            }

            sendEvent('response.completed', {
              response: {
                id: responseId,
                object: 'response',
                created_at: created,
                model,
                status: 'completed',
                output: buildOutputItems(replyText),
                usage: usageFor(replyText),
              },
            });
            safeEnqueue(encoder.encode('data: [DONE]\n\n'));
            safeClose();
          } catch (err: any) {
            clearInterval(keepAlive);
            console.error('[Responses API Stream Error]:', err);
            sendEvent('response.failed', {
              response: {
                id: responseId,
                object: 'response',
                status: 'failed',
                error: { message: err?.message || 'Upstream error' },
              },
            });
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

    // Synchronous (Non-streaming) response
    const { text, media } = await musePool.chat({
      prompt: musePrompt,
      signal: req.signal,
      cwd,
      model,
      ua,
      keyName,
      endpoint: '/v1/responses',
    });
    const origin = publicOrigin(req);
    const content = media.length
      ? `${text}\n\nAttachments:\n${media.map((u) => `- ${u.startsWith('http') ? u : origin + u}`).join('\n')}`
      : text;
    const responsePayload = {
      id: responseId,
      object: 'response',
      created_at: created,
      model,
      status: 'completed',
      output: buildOutputItems(content),
      usage: usageFor(content),
    };

    return NextResponse.json(responsePayload, { headers: corsHeaders });
  } catch (err: any) {
    console.error('[Responses API Error]:', err);
    return NextResponse.json(
      { error: { message: err?.message || 'Internal server error', type: 'server_error' } },
      { status: 500, headers: corsHeaders }
    );
  }
}
