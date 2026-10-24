import { NextResponse } from 'next/server';
import { apiKeyService } from '@/lib/apiKeys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reveal = searchParams.get('reveal');
  if (reveal) {
    const k = apiKeyService.list().find((x) => x.id === reveal);
    if (!k) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    return NextResponse.json({ key: k.key });
  }
  const keys = apiKeyService.list().map((k) => ({
    ...k,
    key: `${k.key.slice(0, 14)}…${k.key.slice(-4)}`, // masked in list
  }));
  return NextResponse.json({
    keys,
    authRequired: apiKeyService.authRequired,
    requireAuth: apiKeyService.requireAuthEnabled,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rec = apiKeyService.create(String(body.name || ''));
  // Full key returned ONCE at creation
  return NextResponse.json(rec, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || '';
  if (!apiKeyService.revoke(id)) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.requireAuth !== undefined) {
    apiKeyService.setRequireAuth(!!body.requireAuth);
    return NextResponse.json({ ok: true, requireAuth: apiKeyService.requireAuthEnabled });
  }
  const id = String(body.id || '');
  if (body.access !== undefined) {
    if (!apiKeyService.setAccess(id, body.access)) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }
    const k = apiKeyService.list().find((x) => x.id === id);
    return NextResponse.json({ ok: true, access: k?.access || null });
  }
  if (!apiKeyService.setEnabled(id, !!body.enabled)) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
