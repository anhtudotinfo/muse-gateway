import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/apiGuard';
import { taskService, taskView } from '@/lib/tasks';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

type Props = { params: Promise<{ id: string }> };

const notFound = () =>
  NextResponse.json(
    { error: { message: 'Task not found.', type: 'not_found_error' } },
    { status: 404, headers: corsHeaders },
  );

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest, { params }: Props) {
  const caller = authorizeRequest(req, corsHeaders);
  if (caller instanceof NextResponse) return caller;
  const task = taskService.find((await params).id, caller.keyName);
  return task ? NextResponse.json(taskView(task), { headers: corsHeaders }) : notFound();
}

export async function DELETE(req: NextRequest, { params }: Props) {
  const caller = authorizeRequest(req, corsHeaders);
  if (caller instanceof NextResponse) return caller;
  const task = taskService.find((await params).id, caller.keyName);
  if (!task) return notFound();
  return NextResponse.json(taskView(taskService.cancel(task)), { headers: corsHeaders });
}
