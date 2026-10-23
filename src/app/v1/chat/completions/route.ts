import { NextRequest, NextResponse } from 'next/server';
import { museDriver } from '@/lib/museDriver';
import type { ChatCompletionRequest, ChatMessage } from '@/types';

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
    const body: ChatCompletionRequest = await req.json();
    const { model = 'muse-chat', messages = [], stream = false } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: { message: 'Messages array is required and cannot be empty.', type: 'invalid_request_error' } },
        { status: 400, headers: corsHeaders }
      );
    }

    // Format messages for prompt
    let formattedPrompt = '';
    if (messages.length === 1) {
      const c = messages[0].content;
      formattedPrompt = typeof c === 'string' ? c : JSON.stringify(c);
    } else {
      const parts = messages.map((m: ChatMessage) => {
        const role = m.role === 'user' ? 'User' : m.role === 'system' ? 'System Instruction' : 'Assistant';
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${role}: ${text}`;
      });
      formattedPrompt = parts.join('\n\n') + '\n\nAssistant:';
    }

    const completionId = 'chatcmpl-' + Date.now();
    const created = Math.floor(Date.now() / 1000);

    // Handle Streaming (SSE)
    if (stream) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          try {
            await museDriver.chat({
              prompt: formattedPrompt,
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
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
              },
            });

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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopPayload)}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (err: any) {
            console.error('[API Stream Error]:', err);
            const errPayload = {
              error: { message: err?.message || 'Upstream error', type: 'upstream_error' },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errPayload)}\n\n`));
            controller.close();
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
    const reply = await museDriver.chat({ prompt: formattedPrompt });
    const promptTokens = Math.max(1, Math.round(formattedPrompt.length / 4));
    const completionTokens = Math.max(1, Math.round(reply.length / 4));

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
            content: reply,
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
