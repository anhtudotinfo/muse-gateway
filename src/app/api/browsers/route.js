import { NextResponse } from 'next/server';
import { getBrowserExecutable } from '@/lib/museService';

export async function GET() {
  const chrome = getBrowserExecutable('chrome');
  const edge = getBrowserExecutable('edge');

  return NextResponse.json({
    chrome: chrome && chrome.type === 'chrome' ? chrome.path : null,
    edge: edge && edge.type === 'edge' ? edge.path : null,
  });
}
