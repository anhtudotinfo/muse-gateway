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

export async function GET(req, { params }) {
  const { model } = await params;
  const found = SUPPORTED_MODELS.find((m) => m.id === model) || {
    id: model,
    object: 'model',
    created: 1700000000,
    owned_by: 'meta-muse',
  };

  return NextResponse.json(found, { headers: corsHeaders });
}
