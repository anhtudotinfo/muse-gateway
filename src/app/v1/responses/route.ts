import { NextRequest, NextResponse } from 'next/server';
import { museDriver } from '@/lib/museDriver';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

function extractPromptFromInput(input: any): string {
  if (typeof input === 'string') return input;
  if (!input) return '';

  if (Array.isArray(input)) {
    const parts: string[] = [];
    for (const item of input) {
      if (typeof item === 'string') {
        parts.push(item);
      } else if (item && typeof item === 'object') {
        const role = item.role || item.type || 'user';
        if (typeof item.content === 'string') {
          parts.push(`${role}: ${item.content}`);
        } else if (Array.isArray(item.content)) {
          const textPieces = item.content
            .map((c: any) => c.text || (typeof c === 'string' ? c : ''))
            .filter(Boolean);
          if (textPieces.length > 0) {
            parts.push(`${role}: ${textPieces.join(' ')}`);
          }
        }
      }
    }
    return parts.length > 0 ? parts.join('\n\n') : JSON.stringify(input);
  }

  if (typeof input === 'object') {
    if (input.text) return input.text;
    if (input.content) return extractPromptFromInput(input.content);
    return JSON.stringify(input);
  }

  return String(input);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[Responses API Request received]:', JSON.stringify(body).slice(0, 300));

    const model = body.model || 'muse-chat';
    const stream = body.stream ?? true;
    const prompt = extractPromptFromInput(body.input || body.messages || body.prompt);

    const responseId = 'resp_' + Date.now();
    const itemId = 'item_' + Date.now();
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          try {
            // 1. response.created
            const createdEvent = {
              type: 'response.created',
              response: {
                id: responseId,
                object: 'response',
                created_at: created,
                model,
                status: 'in_progress',
                output: [],
              },
            };
            controller.enqueue(encoder.encode(`event: response.created\ndata: ${JSON.stringify(createdEvent)}\n\n`));

            // 2. response.output_item.added
            const itemAddedEvent = {
              type: 'response.output_item.added',
              response_id: responseId,
              output_index: 0,
              item: {
                id: itemId,
                type: 'message',
                status: 'in_progress',
                role: 'assistant',
                content: [],
              },
            };
            controller.enqueue(encoder.encode(`event: response.output_item.added\ndata: ${JSON.stringify(itemAddedEvent)}\n\n`));

            // 3. response.content_part.added
            const partAddedEvent = {
              type: 'response.content_part.added',
              response_id: responseId,
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              part: {
                type: 'text',
                text: '',
              },
            };
            controller.enqueue(encoder.encode(`event: response.content_part.added\ndata: ${JSON.stringify(partAddedEvent)}\n\n`));

            let accumulatedText = '';

            // Stream chunks from Muse
            await museDriver.chat({
              prompt,
              onChunk: (chunk: string) => {
                accumulatedText += chunk;
                const deltaEvent = {
                  type: 'response.output_text.delta',
                  response_id: responseId,
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  delta: chunk,
                };
                controller.enqueue(encoder.encode(`event: response.output_text.delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`));
              },
            });

            // 4. response.output_text.done
            const textDoneEvent = {
              type: 'response.output_text.done',
              response_id: responseId,
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              text: accumulatedText,
            };
            controller.enqueue(encoder.encode(`event: response.output_text.done\ndata: ${JSON.stringify(textDoneEvent)}\n\n`));

            // 5. response.content_part.done
            const partDoneEvent = {
              type: 'response.content_part.done',
              response_id: responseId,
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              part: {
                type: 'text',
                text: accumulatedText,
              },
            };
            controller.enqueue(encoder.encode(`event: response.content_part.done\ndata: ${JSON.stringify(partDoneEvent)}\n\n`));

            // 6. response.output_item.done
            const itemDoneEvent = {
              type: 'response.output_item.done',
              response_id: responseId,
              output_index: 0,
              item: {
                id: itemId,
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [
                  {
                    type: 'text',
                    text: accumulatedText,
                  },
                ],
              },
            };
            controller.enqueue(encoder.encode(`event: response.output_item.done\ndata: ${JSON.stringify(itemDoneEvent)}\n\n`));

            // 7. response.completed
            const completedEvent = {
              type: 'response.completed',
              response: {
                id: responseId,
                object: 'response',
                created_at: created,
                model,
                status: 'completed',
                output: [
                  {
                    id: itemId,
                    type: 'message',
                    status: 'completed',
                    role: 'assistant',
                    content: [
                      {
                        type: 'text',
                        text: accumulatedText,
                      },
                    ],
                  },
                ],
                usage: {
                  total_tokens: Math.max(1, Math.round(accumulatedText.length / 4)),
                  input_tokens: Math.max(1, Math.round(prompt.length / 4)),
                  output_tokens: Math.max(1, Math.round(accumulatedText.length / 4)),
                },
              },
            };
            controller.enqueue(encoder.encode(`event: response.completed\ndata: ${JSON.stringify(completedEvent)}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (err: any) {
            console.error('[Responses API Stream Error]:', err);
            const errEvent = {
              type: 'response.failed',
              response: {
                id: responseId,
                object: 'response',
                status: 'failed',
                error: { message: err?.message || 'Upstream error' },
              },
            };
            controller.enqueue(encoder.encode(`event: response.failed\ndata: ${JSON.stringify(errEvent)}\n\n`));
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

    // Synchronous (Non-streaming) response
    const reply = await museDriver.chat({ prompt });
    const responsePayload = {
      id: responseId,
      object: 'response',
      created_at: created,
      model,
      status: 'completed',
      output: [
        {
          id: itemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: reply,
            },
          ],
        },
      ],
      usage: {
        total_tokens: Math.max(1, Math.round(reply.length / 4)),
        input_tokens: Math.max(1, Math.round(prompt.length / 4)),
        output_tokens: Math.max(1, Math.round(reply.length / 4)),
      },
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
