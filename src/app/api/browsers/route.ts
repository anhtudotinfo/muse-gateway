import { NextResponse } from 'next/server';
import { getBrowserExecutable } from '@/lib/museService';
import type { BrowserDetection } from '@/types';

export async function GET() {
  const chrome = getBrowserExecutable('chrome');
  const edge = getBrowserExecutable('edge');

  const result: BrowserDetection = {
    chrome: chrome && chrome.type === 'chrome' ? chrome.path : null,
    edge: edge && edge.type === 'edge' ? edge.path : null,
  };

  return NextResponse.json(result);
}
