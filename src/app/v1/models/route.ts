import { NextResponse } from 'next/server';
import { SUPPORTED_MODELS } from '@/lib/museDriver';
import { musePool } from '@/lib/musePool';
import { apiKeyService } from '@/lib/apiKeys';
import { licenseGate } from '@/lib/licenseGate';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: Request) {
  const gate = licenseGate(corsHeaders);
  if (gate) return gate;
  // Expose combos as selectable model names (9router-style)
  const comboModels = musePool.getCombos().map((c) => ({
    id: c.name,
    object: 'model',
    created: 0,
    owned_by: 'muse-pool',
  }));
  let data = [...SUPPORTED_MODELS, ...comboModels];

  // When a restricted key is supplied, expose only its allow-listed models.
  // Unauthenticated calls (dashboard model picker) get the full list.
  const auth = req.headers.get('authorization') || req.headers.get('x-api-key');
  if (auth) {
    const key = apiKeyService.resolveKey(auth);
    if (key && key !== 'open' && key.access?.restricted) {
      data = data.filter((m) => apiKeyService.allowsModel(key, m.id));
    }
  }

  return NextResponse.json(
    {
      object: 'list',
      data,
    },
    { headers: corsHeaders }
  );
}
