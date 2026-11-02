import { NextRequest, NextResponse } from 'next/server';
import { taskService, taskView } from '@/lib/tasks';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const task = taskService.find((await params).id, 'open');
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  return NextResponse.json({ task: taskView(taskService.cancel(task)) });
}
