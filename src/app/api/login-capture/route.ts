import { NextRequest, NextResponse } from 'next/server';
import {
  cancelLoginCapture,
  getLoginCaptureJob,
  startLoginCapture,
} from '@/lib/museService';

/** POST { browserType, targetSessionId? } — launches a real browser on
 * muse.ai and starts polling its cookie jar for a fresh login. Returns the
 * job id; the client polls GET until the status leaves 'waiting'.
 * targetSessionId re-logins an existing card instead of adding a new one. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const job = await startLoginCapture(body.browserType || 'chrome', body.targetSessionId || null);
    return NextResponse.json({ success: true, jobId: job.id });
  } catch (err: any) {
    console.error('Login capture start error:', err);
    return NextResponse.json(
      { error: 'Không khởi động được phiên đăng nhập: ' + (err?.message || String(err)) },
      { status: 500 },
    );
  }
}

/** GET ?jobId= — poll capture progress. */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'Thiếu jobId' }, { status: 400 });
  }
  const job = getLoginCaptureJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Phiên đăng nhập không tồn tại hoặc đã hết hạn' }, { status: 404 });
  }
  return NextResponse.json({
    status: job.status,
    sessionId: job.sessionId,
    deduped: job.deduped ?? false,
    error: job.error,
  });
}

/** DELETE ?jobId= — user cancelled; kills the browser on the next poll tick. */
export async function DELETE(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'Thiếu jobId' }, { status: 400 });
  }
  const cancelled = cancelLoginCapture(jobId);
  return NextResponse.json({ success: cancelled });
}
