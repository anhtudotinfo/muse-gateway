import { NextRequest, NextResponse } from 'next/server';
import { apiKeyService, type ApiKeyRecord } from './apiKeys';
import { licenseGate } from './licenseGate';
import { isRemoteHeaders } from './remoteDetect';

export interface ApiCaller {
  apiKey: ApiKeyRecord | 'open';
  keyName: string;
  remote: boolean;
}

/** License + API-key check shared by the /v1 task routes. */
export function authorizeRequest(
  req: NextRequest,
  corsHeaders: Record<string, string>,
): ApiCaller | NextResponse {
  const gate = licenseGate(corsHeaders);
  if (gate) return gate;
  const remote = isRemoteHeaders(req.headers);
  const apiKey = apiKeyService.resolveKey(
    req.headers.get('authorization') || req.headers.get('x-api-key'),
    remote,
    req.headers.get('origin'),
  );
  if (apiKey === null) {
    return NextResponse.json(
      { error: { message: 'Invalid or missing API key.', type: 'authentication_error' } },
      { status: 401, headers: corsHeaders },
    );
  }
  return { apiKey, keyName: apiKey === 'open' ? 'open' : apiKey.name, remote };
}
