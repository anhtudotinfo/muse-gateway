import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/requestOrigin';
import { taskService, taskView } from '@/lib/tasks';

/** Run a finished task's request again as a new task (same key, model,
 *  prompt, ratio and length). Refused for tasks sent with reference images
 *  or tracked from chat — those go back to the app that sent them. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const task = taskService.find((await params).id, 'open');
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  const blocker = taskService.retryBlocker(task);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
  const next = taskService.retry(task, { origin: publicOrigin(req), ua: req.headers.get('user-agent') });
  return NextResponse.json({ task: taskView(next) }, { status: 201 });
}
