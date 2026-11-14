import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/apiGuard';
import { appVersion } from '@/lib/license';
import { createMcpBackend } from '@/lib/mcp/backend';
import {
  handleMcpMessage,
  JSONRPC,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcResponse,
  type McpContext,
} from '@/lib/mcp/core';
import { isLoopbackOrigin } from '@/lib/remoteDetect';
import { publicOrigin } from '@/lib/requestOrigin';

// MCP over Streamable HTTP (spec 2025-06-18), stateless: every POST carries
// complete JSON-RPC messages, no session id, no server-initiated stream.
// Lives under /v1 so tunnel clients reach it; the API-key + license gate is
// the same one /v1/tasks uses.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-api-key, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
};

/** Keep-alive comment cadence on streamed responses — under the ~100s idle
 *  cutoff of tunnel edges and the 60s timeouts some clients use. */
const KEEPALIVE_MS = 10_000;

const rpcError = (status: number, code: number, message: string) =>
  NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers: corsHeaders });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// No standalone SSE stream (stateless server) and no sessions to end.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { ...corsHeaders, Allow: 'POST' } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...corsHeaders, Allow: 'POST' } });
}

export async function POST(req: NextRequest) {
  const caller = authorizeRequest(req, corsHeaders);
  if (caller instanceof NextResponse) {
    if (caller.status === 401) caller.headers.set('WWW-Authenticate', 'Bearer realm="muse-gateway"');
    return caller;
  }

  // DNS-rebinding guard the spec asks for: a web page on another origin
  // must not drive this server through the user's browser. Remote callers
  // already had to present an API key.
  const origin = req.headers.get('origin');
  if (origin && !caller.remote && !isLoopbackOrigin(origin)) {
    return rpcError(403, JSONRPC.INVALID_REQUEST, 'Origin not allowed.');
  }

  const version = req.headers.get('mcp-protocol-version');
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return rpcError(400, JSONRPC.INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${version}.`);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(400, JSONRPC.PARSE_ERROR, 'Parse error: body is not valid JSON.');
  }
  const batch = Array.isArray(body);
  const messages = batch ? (body as unknown[]) : [body];
  if (batch && messages.length === 0) return rpcError(400, JSONRPC.INVALID_REQUEST, 'Invalid Request: empty batch.');

  for (const m of messages as any[]) {
    if (m && typeof m === 'object' && typeof m.method === 'string') {
      const tool = m.method === 'tools/call' ? ` ${m.params?.name ?? '?'}` : '';
      console.log(`[MCP] ${caller.keyName}${caller.remote ? ' (remote)' : ''} ${m.method}${tool}`);
    }
  }

  const ctxBase = {
    backend: createMcpBackend(caller, { origin: publicOrigin(req), ua: req.headers.get('user-agent') }),
    serverVersion: appVersion(),
    signal: req.signal,
    protocolVersion: version ?? undefined,
  };
  const run = async (ctx: McpContext) => {
    const out: JsonRpcResponse[] = [];
    for (const m of messages) {
      const res = await handleMcpMessage(m, ctx);
      if (res) out.push(res);
    }
    return out;
  };

  const wantsStream =
    (req.headers.get('accept') || '').includes('text/event-stream') &&
    (messages as any[]).some((m) => m?.method === 'tools/call' && m.id !== undefined && m.id !== null);

  if (!wantsStream) {
    const out = await run(ctxBase);
    if (!out.length) return new NextResponse(null, { status: 202, headers: corsHeaders });
    return NextResponse.json(batch ? out : out[0], { headers: corsHeaders });
  }

  // Tool calls can wait up to a minute on Muse: stream the answer as SSE so
  // progress notifications and keep-alives flow while the client waits.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const event = (payload: unknown) => send(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      const keepAlive = setInterval(() => send(': keep-alive\n\n'), KEEPALIVE_MS);
      try {
        const out = await run({
          ...ctxBase,
          onProgress: (progressToken, progress, message) =>
            event({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress, message } }),
        });
        if (batch) event(out);
        else for (const res of out) event(res);
      } catch (error) {
        event({
          jsonrpc: '2.0',
          id: null,
          error: { code: JSONRPC.INTERNAL_ERROR, message: error instanceof Error ? error.message : 'Internal error' },
        });
      } finally {
        clearInterval(keepAlive);
        open = false;
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new NextResponse(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
