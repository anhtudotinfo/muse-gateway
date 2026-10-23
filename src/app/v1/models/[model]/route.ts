import { NextResponse } from 'next/server';
import { SUPPORTED_MODELS } from '@/lib/museDriver';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(
  _request: Request,
  props: { params: Promise<{ model: string }> }
) {
  const params = await props.params;
  const targetId = params.model;
  const model = SUPPORTED_MODELS.find((m) => m.id === targetId);

  if (!model) {
    return NextResponse.json(
      {
        error: {
          message: `Model '${targetId}' does not exist`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      },
      { status: 404, headers: corsHeaders }
    );
  }

  return NextResponse.json(model, { headers: corsHeaders });
}
