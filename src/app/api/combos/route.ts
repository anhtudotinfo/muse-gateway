import { NextResponse } from 'next/server';
import { musePool, type PoolStrategy } from '@/lib/musePool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID: PoolStrategy[] = ['fallback', 'round-robin', 'fusion'];

export async function GET() {
  return NextResponse.json({ combos: musePool.getCombos() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  // Names select the combo in /v1 requests (model = combo name) — duplicates
  // would silently resolve to the first match, so reject them.
  if (musePool.findComboByName(name)) {
    return NextResponse.json({ error: `Combo "${name}" already exists` }, { status: 409 });
  }
  const strategy = VALID.includes(body.strategy) ? body.strategy : 'round-robin';
  const accountIds = Array.isArray(body.accountIds) ? body.accountIds.map(String) : [];
  return NextResponse.json(musePool.createCombo(name, accountIds, strategy), { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  const patch: any = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (Array.isArray(body.accountIds)) patch.accountIds = body.accountIds.map(String);
  if (VALID.includes(body.strategy)) patch.strategy = body.strategy;
  if (patch.name) {
    const dup = musePool.findComboByName(patch.name);
    if (dup && dup.id !== id) {
      return NextResponse.json({ error: `Combo "${patch.name}" already exists` }, { status: 409 });
    }
  }
  if (!musePool.updateCombo(id, patch)) {
    return NextResponse.json({ error: 'Combo not found' }, { status: 404 });
  }
  return NextResponse.json({ combos: musePool.getCombos() });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!musePool.deleteCombo(searchParams.get('id') || '')) {
    return NextResponse.json({ error: 'Combo not found' }, { status: 404 });
  }
  return NextResponse.json({ combos: musePool.getCombos() });
}
