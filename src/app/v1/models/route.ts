import { NextResponse } from 'next/server';
import { SUPPORTED_MODELS } from '@/lib/museDriver';
import { musePool } from '@/lib/musePool';
import { baseKind } from '@/lib/modelKind';
import { apiKeyService } from '@/lib/apiKeys';
import { isRemoteHeaders } from '@/lib/remoteDetect';
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
  // `kind` (chat / image / video) is an extra field: what each model returns.
  const comboModels = musePool.getCombos().map((c) => ({
    id: c.name,
    object: 'model',
    created: 0,
    owned_by: 'muse-pool',
    kind: c.kind,
  }));
  let data = [...SUPPORTED_MODELS.map((m) => ({ ...m, kind: baseKind(m.id) })), ...comboModels];

  // When a restricted key is supplied, expose only its allow-listed models.
  // Unauthenticated LOCAL calls (dashboard model picker) get the full list;
  // remote callers always need a valid key — including when zero keys exist.
  const auth = req.headers.get('authorization') || req.headers.get('x-api-key');
  const remote = isRemoteHeaders(req.headers);
  const key = apiKeyService.resolveKey(auth, remote);
  if (remote && key === null) {
    return NextResponse.json(
      { error: { message: 'Invalid or missing API key.', type: 'authentication_error' } },
      { status: 401, headers: corsHeaders }
    );
  }
  if (key && key !== 'open' && key.access?.restricted) {
    data = data.filter((m) => apiKeyService.allowsModel(key, m.id));
  }

  return NextResponse.json(
    {
      object: 'list',
      data,
    },
    { headers: corsHeaders }
  );
}
