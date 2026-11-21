import { NextRequest, NextResponse } from 'next/server';
import { taskService } from '@/lib/tasks';

// Dashboard feed for the Media page. The remote-access proxy keeps
// /api/* local, so this can show (and clean up) every key's tasks.
export async function GET(req: NextRequest) {
  const requested = Number(req.nextUrl.searchParams.get('limit'));
  const limit = requested > 0 ? Math.min(requested, 500) : 200;
  return NextResponse.json({ tasks: taskService.dashboardList(limit) });
}

/** Bulk clean-up. Body {ids: [...]} deletes exactly those (what the
 *  dashboard showed and confirmed); otherwise ?scope=failed (failed +
 *  cancelled) or ?scope=finished (everything not running). Files go too. */
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body && Array.isArray(body.ids)) {
    const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, 1000);
    return NextResponse.json(taskService.remove(ids));
  }
  const scope = req.nextUrl.searchParams.get('scope');
  if (scope !== 'failed' && scope !== 'finished') {
    return NextResponse.json({ error: 'scope must be "failed" or "finished".' }, { status: 400 });
  }
  return NextResponse.json(taskService.remove(taskService.idsWhere(scope)));
}
