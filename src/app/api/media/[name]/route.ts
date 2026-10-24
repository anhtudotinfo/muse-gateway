import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Serves media files persisted by museDriver's blob-resolver (data/media/).
const MEDIA_DIR = path.join(process.cwd(), 'data', 'media');

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const CORS = { 'Access-Control-Allow-Origin': '*' };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ name: string }> }
) {
  const { name } = await props.params;
  const safe = path.basename(name);
  if (safe !== name || !/^[\w.-]+$/.test(safe)) {
    return new NextResponse('bad name', { status: 400, headers: CORS });
  }
  const file = path.join(MEDIA_DIR, safe);
  if (!fs.existsSync(file)) {
    return new NextResponse('not found', { status: 404, headers: CORS });
  }

  const stat = fs.statSync(file);
  const type = MIME[path.extname(safe).toLowerCase()] || 'application/octet-stream';
  const base = {
    ...CORS,
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  // Range support so <video> preview can seek.
  const range = req.headers.get('range');
  const m = range?.match(/bytes=(\d+)-(\d*)/);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
    const chunk = fs.readFileSync(file).subarray(start, end + 1);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        ...base,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }

  return new NextResponse(fs.readFileSync(file), {
    headers: { ...base, 'Content-Length': String(stat.size) },
  });
}
