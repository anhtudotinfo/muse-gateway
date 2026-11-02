import { NextRequest, NextResponse } from 'next/server';
import { licenseService } from '@/lib/license';
import { musePool } from '@/lib/musePool';
import { pairingService } from '@/lib/pairing';
import { originRejected, pairCors, pairPreflight } from './cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return pairPreflight(req);
}

/** Discovery: lets an app tell "no gateway" from "gateway, but no Muse
 *  account yet" and show the right next step. Nothing secret in here. */
export async function GET(req: NextRequest) {
  const rejected = originRejected(req);
  if (rejected) return rejected;
  const accounts = musePool.getState().accounts;
  const license = licenseService.getView();
  return NextResponse.json(
    {
      service: 'muse-gateway',
      version: license.version,
      licensed: license.licensed,
      accounts: {
        total: accounts.length,
        ready: accounts.filter((a) => a.enabled && a.status !== 'cooldown' && a.status !== 'disabled').length,
      },
    },
    { headers: pairCors(req) },
  );
}

/** Starts a pairing request; the user approves it at approve_url. */
export async function POST(req: NextRequest) {
  const rejected = originRejected(req);
  if (rejected) return rejected;
  const body = await req.json().catch(() => ({}));
  const pair = pairingService.start(body.app, req.headers.get('origin'));
  const host = req.headers.get('host') || 'localhost:1412';
  return NextResponse.json(
    {
      id: pair.id,
      code: pair.code,
      secret: pair.secret,
      approve_url: `http://${host}/pair/${pair.id}`,
      expires_in: 300,
    },
    { status: 201, headers: pairCors(req) },
  );
}
