import { NextRequest, NextResponse } from 'next/server';
import { SUPPORTED_MODELS } from '@/lib/museDriver';
import { apiKeyService } from '@/lib/apiKeys';
import { isRemoteHeaders } from '@/lib/remoteDetect';
import { licenseGate } from '@/lib/licenseGate';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ model: string }> }
) {
  const gate = licenseGate(corsHeaders);
  if (gate) return gate;
  // Remote callers always need a valid API key (same gate as /v1/models).
  if (isRemoteHeaders(req.headers)) {
    const key = apiKeyService.resolveKey(
      req.headers.get('authorization') || req.headers.get('x-api-key'),
      true
    );
    if (key === null) {
      return NextResponse.json(
        { error: { message: 'Invalid or missing API key.', type: 'authentication_error' } },
        { status: 401, headers: corsHeaders }
      );
    }
  }
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
