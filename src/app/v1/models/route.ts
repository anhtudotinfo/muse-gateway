import { NextResponse } from 'next/server';
import { SUPPORTED_MODELS } from '@/lib/museDriver';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET() {
  return NextResponse.json(
    {
      object: 'list',
      data: SUPPORTED_MODELS,
    },
    { headers: corsHeaders }
  );
}
