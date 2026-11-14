import { NextRequest, NextResponse } from 'next/server';
import { taskService } from '@/lib/tasks';
import { MAX_ZIP_BYTES, zipStream } from '@/lib/zipStream';

/** "Download selected" on the media page: GET ?ids=a,b,c streams a ZIP of
 *  those tasks' result files (in that order). Local only, like all /api/*. */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 500);
  if (!ids.length) return NextResponse.json({ error: 'ids is required.' }, { status: 400 });

  const files = taskService.mediaFiles(ids);
  if (!files.length) return NextResponse.json({ error: 'None of these tasks has a file on this machine.' }, { status: 404 });
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ZIP_BYTES) {
    return NextResponse.json(
      { error: `Selection is ${(total / 1024 ** 3).toFixed(1)} GB; download at most ${MAX_ZIP_BYTES / 1024 ** 3} GB at a time.` },
      { status: 413 },
    );
  }

  // Local time — the name the user sees in their Downloads folder.
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  return new NextResponse(zipStream(files), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="muse-media-${stamp}.zip"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
