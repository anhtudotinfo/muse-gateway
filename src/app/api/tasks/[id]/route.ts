import { NextRequest, NextResponse } from 'next/server';
import { taskService, taskView } from '@/lib/tasks';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const task = taskService.find((await params).id, 'open');
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (taskView(task).source === 'chat') {
    return NextResponse.json({ error: 'Chat requests end with their caller.' }, { status: 409 });
  }
  return NextResponse.json({ task: taskView(taskService.cancel(task)) });
}
