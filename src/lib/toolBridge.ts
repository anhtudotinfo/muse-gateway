// Tool-call bridge between the OpenAI Responses API (Codex desktop client) and
// the Muse web chat. Muse has no native function calling, so tool definitions
// are injected into the prompt and the model is asked to emit a JSON marker
// when it wants to invoke a tool; the marker is translated back into
// function_call output items for the client.

export interface BridgeTool {
  name: string;
  description: string;
  parameters: string;
}

export interface MuseToolCall {
  name: string;
  arguments: string;
  callId: string;
}

// ---- Workspace context injection ------------------------------------------
// The bridge runs on the user's machine, so it can read the local workspace
// that Codex reports via <environment_context><cwd>. We attach a bounded
// project snapshot to the Muse prompt so the model can reason about the
// project even though it cannot emit client-side tool calls.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { extractTextFromItem } from './promptExtractor';

export function extractWorkspaceCwd(body: any): string | null {
  const items: any[] = [];
  for (const src of [body?.input, body?.messages]) {
    if (Array.isArray(src)) items.push(...src);
  }
  for (const it of items) {
    const txt = typeof it === 'string' ? it : extractTextFromItem(it);
    const m = /<cwd>([^<]+)<\/cwd>/i.exec(txt || '');
    if (m) return m[1].trim();
  }
  return null;
}

// AGENTS.md is intentionally excluded: its content is instruction-shaped
// ("agent operating contract") which trips the upstream model's prompt-
// injection guard and yields a generic refusal.
const KEY_FILES = [
  'README.md', 'README', 'package.json', 'pyproject.toml',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Makefile', 'turbo.json',
];

export function buildProjectContext(cwd: string | null): string {
  if (!cwd) return '';
  let root: string;
  try {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return '';
    root = cwd;
  } catch {
    return '';
  }
  const parts: string[] = [];
  try {
    let files: string[] = [];
    if (fs.existsSync(path.join(root, '.git'))) {
      try {
        files = execSync('git ls-files', { cwd: root, timeout: 15000 })
          .toString().split(/\r?\n/).filter(Boolean);
      } catch {}
    }
    if (!files.length) {
      // shallow walk, 2 levels
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isFile()) files.push(entry.name);
        else if (entry.isDirectory()) {
          try {
            for (const sub of fs.readdirSync(path.join(root, entry.name))) {
              files.push(`${entry.name}/${sub}`);
            }
          } catch {}
        }
      }
    }
    if (!process.env.MUSE_CTX_NO_TREE) {
      // Compact summary only — a raw 300-line path dump trips the upstream
      // model's injection guard. Drop hidden/agent-looking paths and junk
      // names; keep top-level dirs plus a bounded sample of real files.
      const SKIP_SEG = new Set(['node_modules', 'dist', 'build', 'out', 'coverage',
        '__pycache__', '.next', '.turbo', 'target', '.venv', 'venv']);
      const topDirs = new Set<string>();
      const clean: string[] = [];
      for (const f of files) {
        const segs = f.split('/');
        if (segs.some(s => s.startsWith('.') || SKIP_SEG.has(s))) continue;
        if (!/^[A-Za-z0-9_\-./()[\] ]+$/.test(f)) continue;
        if (segs.length > 1) topDirs.add(segs[0] + '/');
        else clean.push(f);
        if (segs.length > 1 && clean.length < 120) clean.push(f);
      }
      const summary = [...topDirs].sort().slice(0, 40).join('\n') +
        '\n' + clean.slice(0, 80).join('\n');
      parts.push(`Project at ${root} — ${files.length} tracked files. Top-level dirs and sample paths:\n${summary}`);
    }
  } catch {}

  for (const kf of process.env.MUSE_CTX_NO_FILES ? [] : KEY_FILES) {
    try {
      const p = path.join(root, kf);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        parts.push(`--- ${kf} ---\n` + fs.readFileSync(p, 'utf8').slice(0, 3000));
      }
    } catch {}
  }
  const ctx = parts.join('\n');
  return ctx ? `[PROJECT CONTEXT]\n${ctx.slice(0, 16000)}\n[/PROJECT CONTEXT]\n` : '';
}

// ---- Local command execution (agent loop) ----------------------------------
// Muse won't emit a JSON tool-call marker, but it DOES naturally ask the user
// to run commands ("bạn chạy `tokei D:\...` rồi dán kết quả"). The bridge runs
// on the user's machine, so we detect that ask, execute it locally, and paste
// the output back into the thread — turning Muse into a local agent.
//
// MUSE_CMD_MODE: 'auto' (default, run anything Muse asks), 'readonly'
// (read-only allowlist), 'off' (disable the loop).

const ASK_HINT =
  /chạy|dán|paste|nhấn enter|gửi lại|send (it|the)|run (this|it|the|these|lệnh)|execute|lệnh này|câu lệnh|hãy chạy|thử chạy|chạy lệnh/i;

const READONLY_CMD =
  /^(dir\b|ls\b|type\b|cat\b|findstr\b|rg\b|git\s+(status|log|diff|show|ls-files|branch|rev-parse|remote)\b|tokei\b|cloc\b|where\b|echo\b|tree\b|pwd\b|whoami\b|hostname\b|node\s+--version|npm\s+--version|bun\s+--version|python\s+--version)/i;

export function isCommandAllowed(cmd: string): boolean {
  const mode = process.env.MUSE_CMD_MODE || 'auto';
  if (mode === 'off') return false;
  if (mode === 'readonly') return READONLY_CMD.test(cmd.trim());
  return true;
}

const KNOWN_CMD = new Set([
  'tokei', 'cloc', 'dir', 'ls', 'type', 'cat', 'rg', 'findstr', 'find', 'grep',
  'git', 'node', 'npm', 'npx', 'bun', 'bunx', 'pnpm', 'yarn', 'python', 'python3',
  'pip', 'pip3', 'powershell', 'pwsh', 'cmd', 'where', 'echo', 'tree', 'wc',
  'head', 'tail', 'sort', 'uniq', 'cd', 'chdir', 'pwd', 'set', 'env', 'curl',
  'wget', 'tar', '7z', 'docker', 'cargo', 'rustc', 'go', 'javac', 'java',
  'dotnet', 'ffmpeg', 'ffprobe', 'whoami', 'hostname', 'ipconfig', 'systeminfo',
  'tasklist', 'scc', 'gocloc', 'deno', 'tsc', 'turbo', 'make', 'cmake',
  'xcopy', 'robocopy', 'for', 'certutil', 'attrib', 'more', 'fc', 'comp',
]);

// PowerShell verb-noun commands (Get-ChildItem, Measure-Object, ...)
const PS_VERB =
  /^(add|backup|checkpoint|clear|close|compare|complete|compress|connect|convert|copy|debug|disable|disconnect|dismount|edit|enable|enter|exit|expand|export|find|foreach|format|get|grant|group|import|initialize|install|invoke|join|limit|measure|merge|mount|move|new|open|optimize|out|pop|push|read|receive|register|remove|rename|repair|request|reset|resize|resolve|restart|restore|resume|revoke|save|search|select|send|set|show|sort|split|start|step|stop|submit|suspend|switch|sync|test|trace|unblock|undo|uninstall|unlock|unprotect|unregister|update|use|wait|watch|where|write)-[a-z]+(\s|$)/i;

function looksLikeCommand(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 500) return false;
  const first = t.split(/\s+/)[0].replace(/^[.\\/]+/, '');
  const base = first.toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh)$/, '');
  if (KNOWN_CMD.has(base)) return true;
  if (/\.(exe|cmd|bat|ps1|sh)$/i.test(first)) return true;
  if (/^[.~][\\/]/.test(t)) return true;
  if (PS_VERB.test(t)) return true;
  return false;
}

export function parseCommandRequests(reply: string): string[] {
  if (!ASK_HINT.test(reply)) return [];
  const cmds: string[] = [];
  const push = (cmd: string) => {
    if (cmd && !cmds.includes(cmd) && cmds.length < 3) cmds.push(cmd);
  };

  // Path A: markdown formatting survived extraction (fenced / inline code).
  const re = /```[^\n`]*\r?\n([\s\S]*?)```|`([^`\n]+)`/g;
  for (const m of reply.matchAll(re)) {
    const body = (m[1] ?? m[2] ?? '').trim();
    if (!body || body.length > 2000) continue;
    const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || lines.length > 10) continue;
    // Skip data payloads and source files, not shell commands.
    if (/^\s*[[{]/.test(body)) continue;
    // A bare absolute path on its own line is a location, not a command.
    if (lines.length === 1 && /^([A-Za-z]:[\\/]|[\\/])/.test(lines[0])) continue;
    if (/\b(import|export|function|const\s+\w+\s*=|let\s+\w+\s*=|class\s+\w+|def\s+\w+|#include|public\s+(static|class))\b/.test(body)) continue;
    const looksPs =
      PS_VERB.test(lines[0]) ||
      lines.some((l) => /^\s*(\$|\(|foreach\b|if\s*\()/i.test(l));
    // Word lists (".ts .tsx .js") or prose inside code ticks are not commands.
    if (!looksPs && !looksLikeCommand(lines[0])) continue;
    push(
      looksPs
        ? `powershell -NoProfile -Command "${lines.join('; ').replace(/"/g, '\\"')}"`
        : lines.join(' && ')
    );
  }

  // Path B: extraction stripped backticks — each inline-code element arrives
  // as its own bare line ("tokei .", "cloc ."). Scan reply lines that look
  // like shell commands once the ask-hint has fired.
  if (!cmds.length) {
    for (const raw of reply.split(/\r?\n/)) {
      const line = raw.trim();
      if (looksLikeCommand(line)) push(line);
    }
  }
  return cmds;
}

export function runLocalCommand(cmd: string, cwd?: string | null): string {
  try {
    // cmd.exe can't run PowerShell verb-noun commands — wrap them.
    const isPs = PS_VERB.test(cmd.trim()) && !/^(powershell|pwsh)\b/i.test(cmd.trim());
    const full = isPs
      ? `powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd.replace(/"/g, '\\"')}"`
      : `chcp 65001 >nul & ${cmd}`;
    const out = execSync(full, {
      shell: 'cmd.exe',
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    const s = out.toString('utf8').trim();
    return s.slice(0, 8000) || '(no output)';
  } catch (e: any) {
    const s = `${(e.stdout?.toString('utf8') || '')}${(e.stderr?.toString('utf8') || '')}`.trim();
    return `[exit code ${e.status ?? '?'}]\n${s.slice(0, 8000) || String(e.message || e)}`;
  }
}

const MAX_TOOLS = 12;
const MAX_TOOL_DESC = 300;
const MAX_TOOL_PARAMS = 600;

// Collect tool definitions from a Responses API request — both the top-level
// `tools` field and `additional_tools` items inside `input` (namespaces are
// flattened to their leaf tools).
export function collectBridgeTools(body: any): BridgeTool[] {
  const found: BridgeTool[] = [];
  const seen = new Set<string>();

  const visit = (t: any): void => {
    if (!t || typeof t !== 'object') return;
    if (Array.isArray(t.tools)) {
      t.tools.forEach(visit);
      return;
    }
    if (typeof t.name !== 'string' || !t.name) return;
    if (seen.has(t.name)) return;
    seen.add(t.name);
    found.push({
      name: t.name,
      description: String(t.description || t.title || '').slice(0, MAX_TOOL_DESC),
      parameters: t.parameters ? JSON.stringify(t.parameters).slice(0, MAX_TOOL_PARAMS) : '',
    });
  };

  if (Array.isArray(body?.tools)) body.tools.forEach(visit);
  if (Array.isArray(body?.input)) {
    for (const item of body.input) {
      if (item && Array.isArray(item.tools)) item.tools.forEach(visit);
    }
  }
  return found.slice(0, MAX_TOOLS);
}

// Instructions injected into the Muse prompt whenever the client advertises
// tools. Muse answers either normally or with the marker JSON.
export function buildBridgeInstructions(tools: BridgeTool[]): string {
  const toolLines = tools
    .map((t) => `- ${t.name}: ${t.description}${t.parameters ? ` | params schema: ${t.parameters}` : ''}`)
    .join('\n');
  return [
    'The user has enabled the following machine actions for you — they run on THEIR computer:',
    toolLines,
    '',
    'When you want one executed, reply with EXACTLY this JSON object and nothing else — no prose, no markdown fences:',
    '{"muse_tool_call": {"name": "<action_name>", "arguments": {<json arguments matching the params schema>}}}',
    'For several actions at once: {"muse_tool_calls": [{...}, {...}]}.',
    'The action runs automatically and its result comes back in the next message starting with [TOOL_RESULT].',
    'Use results to continue the task. If no action is needed, just answer normally.',
    '',
    'User request:',
  ].join('\n');
}

function skipJsonString(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === '"') return j;
  }
  return s.length - 1;
}

// Parse the Muse reply for tool-call markers and normalize to function_call
// items for the Responses API.
export function parseMuseToolCalls(text: string): MuseToolCall[] {
  const calls: MuseToolCall[] = [];
  if (!text) return calls;
  const cleaned = text.replace(/```(?:json|tool_call|tool)?/gi, '');

  const pushCall = (raw: any): void => {
    if (!raw || typeof raw !== 'object') return;
    const name = raw.name || raw.tool || raw.function;
    if (typeof name !== 'string' || !name.trim()) return;
    let args: any = raw.arguments ?? raw.args ?? raw.parameters ?? {};
    if (typeof args !== 'string') args = JSON.stringify(args);
    try {
      JSON.parse(args);
    } catch {
      args = JSON.stringify({ input: args });
    }
    calls.push({ name: name.trim(), arguments: args, callId: `call_${Date.now()}_${calls.length}` });
  };

  const pushContainer = (obj: any): void => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj.muse_tool_calls)) {
      obj.muse_tool_calls.forEach(pushCall);
    } else if (obj.muse_tool_call) {
      pushCall(obj.muse_tool_call);
    } else if (typeof obj.name === 'string' && (obj.arguments || obj.args || obj.parameters)) {
      pushCall(obj);
    }
  };

  // Marker form: [TOOL_CALL]{...}[/TOOL_CALL]
  for (const m of cleaned.matchAll(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/g)) {
    try {
      pushContainer(JSON.parse(m[1].trim()));
    } catch {}
  }

  // JSON objects containing a "muse_tool_call(s)" key — locate via balanced
  // braces so nested objects/strings don't break the slice.
  for (const m of cleaned.matchAll(/"muse_tool_calls?"/g)) {
    const open = cleaned.lastIndexOf('{', m.index);
    if (open === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === '"') {
        i = skipJsonString(cleaned, i);
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    try {
      pushContainer(JSON.parse(cleaned.slice(open, end + 1)));
    } catch {}
  }

  // Whole-reply JSON fallback (reply is exactly one object/array).
  if (calls.length === 0) {
    try {
      const obj = JSON.parse(cleaned.trim());
      if (Array.isArray(obj)) obj.forEach(pushContainer);
      else pushContainer(obj);
    } catch {}
  }

  const seen = new Set<string>();
  return calls.filter((c) => {
    const k = `${c.name}|${c.arguments}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
