import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { readJsonFile, writeJsonAtomic } from '@/lib/safeJson';
import { dataDir } from '@/lib/dataDir';

// Full-state backup: bundles every JSON file under data/ into one document.
// Export = GET (download), restore = POST {files: {...}} — each listed file
// is written back atomically. Local tool: same secrecy as the data dir itself.

const DATA_DIR = dataDir();
const BACKUP_FILES = ['sessions.json', 'pool.json', 'settings.json', 'keys.json', 'usage.jsonl'] as const;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const files: Record<string, unknown> = {};
  for (const name of BACKUP_FILES) {
    const p = path.join(DATA_DIR, name);
    if (!fs.existsSync(p)) continue;
    try {
      // JSONL stays raw text; JSON files go through the reader so a corrupt
      // file exports as null instead of breaking the whole bundle.
      if (name.endsWith('.jsonl')) {
        files[name] = fs.readFileSync(p, 'utf8');
      } else {
        files[name] = readJsonFile<unknown>(p, null);
      }
    } catch {}
  }
  return NextResponse.json({
    version: 2,
    app: 'muse-router',
    exportedAt: new Date().toISOString(),
    files,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const files = body?.files;
    if (!files || typeof files !== 'object') {
      return NextResponse.json({ error: 'Payload phải là { files: { "sessions.json": … } } — dùng file xuất từ "Sao lưu toàn bộ"' }, { status: 400 });
    }
    const restored: string[] = [];
    for (const name of BACKUP_FILES) {
      if (!(name in files)) continue;
      const content = files[name];
      const p = path.join(DATA_DIR, name);
      if (name.endsWith('.jsonl')) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(p, typeof content === 'string' ? content : '', 'utf8');
      } else {
        writeJsonAtomic(p, content);
      }
      restored.push(name);
    }
    if (!restored.length) {
      return NextResponse.json({ error: 'Backup không chứa file dữ liệu nào hợp lệ' }, { status: 400 });
    }
    return NextResponse.json({ success: true, restored });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi khôi phục: ' + (err?.message || String(err)) }, { status: 500 });
  }
}
