import { NextRequest, NextResponse } from 'next/server';
import { taskService, taskView } from '@/lib/tasks';

/** Running task → stop waiting for it. Finished task → delete it and its
 *  file. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const task = taskService.find((await params).id, 'open');
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
    return NextResponse.json(taskService.remove([task.id]));
  }
  if (taskView(task).source === 'chat') {
    return NextResponse.json({ error: 'Chat requests end with their caller.' }, { status: 409 });
  }
  return NextResponse.json({ task: taskView(taskService.cancel(task)) });
}
