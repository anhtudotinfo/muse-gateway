import { tunnelManager } from '@/lib/tunnelManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// SSE stream: `event: progress` log lines, then `event: done` or `event: error`.
export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      try {
        for await (const line of tunnelManager.tailscaleInstall()) {
          send('progress', { message: line });
        }
        send('done', {});
      } catch (err: any) {
        send('error', { error: err?.message || 'Install failed' });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
