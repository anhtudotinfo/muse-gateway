import { NextRequest, NextResponse } from 'next/server';
import { taskService } from '@/lib/tasks';

// Dashboard feed for the Tasks page. The remote-access proxy keeps /api/*
// local, so this can show every key's tasks.
export async function GET(req: NextRequest) {
  const requested = Number(req.nextUrl.searchParams.get('limit'));
  const limit = requested > 0 ? Math.min(requested, 500) : 200;
  return NextResponse.json({ tasks: taskService.dashboardList(limit) });
}
