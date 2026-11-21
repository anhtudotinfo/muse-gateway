"use client";

import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/endpoint/ui/Modal";
import Button from "@/components/endpoint/ui/Button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { EndpointKey } from "./types";

// Integration guide with the chosen endpoint and key filled in, so a user
// can paste each example into their own tool unchanged.

type Example = "video" | "image" | "speech" | "status" | "manage" | "retry" | "python" | "webhook" | "chat" | "mcp" | "errors";

const EXAMPLES: { id: Example; label: string; hint: string }[] = [
  { id: "video", label: "Create video", hint: "Starts a 10-second video and returns a task right away." },
  { id: "image", label: "Create image", hint: "OpenAI-style image endpoint: model muse-image (or an image combo), size maps to a ratio." },
  { id: "speech", label: "Create voice", hint: "OpenAI-style text-to-speech: model muse-voice, any Muse voice name; the response is the mp3." },
  { id: "status", label: "Check result", hint: "Poll until status is succeeded or failed. url is the final file." },
  { id: "manage", label: "List & cancel", hint: "Your key's recent tasks, newest first, and how to stop one." },
  { id: "retry", label: "Retries & threads", hint: "Resend safely with idempotency_key; continue a result in the same Muse chat." },
  { id: "python", label: "Python", hint: "Create a task and wait for the finished file." },
  { id: "webhook", label: "Webhook", hint: "Verify the signature the gateway sends when a task ends." },
  { id: "chat", label: "Chat", hint: "Plain OpenAI-compatible chat, for tools that only speak that API." },
  { id: "mcp", label: "MCP", hint: "Let Claude, Cursor and other AI agents create images and videos through this gateway." },
  { id: "errors", label: "Errors", hint: "Every error has the same JSON shape; the HTTP status says what to fix." },
];

function examples(base: string, key: string): Record<Example, string> {
  const auth = key ? ` \\\n  -H "Authorization: Bearer ${key}"` : "";
  const pyKey = key ? `\nHEADERS = {"Authorization": "Bearer ${key}"}` : "\nHEADERS = {}";
  return {
    video: `curl ${base}/tasks \\
  -H "Content-Type: application/json"${auth} \\
  -d '{
    "model": "muse-video",
    "prompt": "A cat playing piano on a rooftop at night",
    "duration": 10,
    "ratio": "9:16",
    "images": ["https://example.com/cat.jpg"],
    "idempotency_key": "order-1234",
    "webhook_url": "https://example.com/hooks/muse",
    "webhook_secret": "choose-a-secret"
  }'

# 202 Accepted — the task, still queued:
# { "id": "task_...", "status": "queued", "url": null, ... }
#
# images: URLs or data: URLs — images (20 MB) or video/audio clips (40 MB), up to 16.
# Muse renders about 10 s per clip reliably; longer durations often come back
# shorter with "partial": true. For long videos, make 10 s clips and chain them.`,
    image: `curl ${base}/images/generations \\
  -H "Content-Type: application/json"${auth} \\
  -d '{
    "model": "muse-image",
    "prompt": "A cat on the grass, golden hour",
    "size": "1024x1792"
  }'

# Response:
# { "created": 1793600000,
#   "data": [{ "url": "${base.replace(/\/v1$/, "")}/api/media/media-....webp", "revised_prompt": "..." }] }`,
    speech: `curl ${base}/audio/speech \\
  -H "Content-Type: application/json"${auth} \\
  -d '{
    "model": "muse-voice",
    "input": "Xin chào các bạn",
    "voice": "Glad Kite",
    "speed": 1
  }' \\
  --output speech.mp3

# The response body is the mp3 (audio/mpeg).
# voice: any of Muse's 1,219 voice names, written exactly.
#   Vietnamese: Glad Kite (F, default), Breathless Rosette (F), Sparkling Whistle (F),
#     Kindhearted Jetty (M), Questioning Satchel (M), Tenacious Mooring (M), Zealous Harbor (M)
#   English: Aria (F), Mellow Saxophone (F), Soothing Ribbon (F, British),
#     Helio (M), Warm Pebble (M), Boomy Mountain (M, British)
#   OpenAI names (alloy, nova, onyx, ...) are mapped to one of these.
# language: "vi", "en", ... (unset: detected from the text). speed: 0.25–4.
# Up to 4,096 characters, about 30 s to make.
#
# Longer text (up to 6,000 characters, ~5 min of speech): POST /v1/tasks with
# {"model": "muse-voice", "prompt": "...", "voice": "..."}; the finished task's
# url is the mp3 and duration_sec its length.`,
    status: `curl ${base}/tasks/TASK_ID${auth.replace(" \\\n", " ")}

# Response when finished:
# {
#   "id": "task_...", "status": "succeeded",
#   "url": "${base.replace(/\/v1$/, "")}/api/media/media-....mp4",
#   "duration_sec": 10.0, "partial": false,
#   "media": [{ "url": "...", "kind": "video", "duration_sec": 10.0 }],
#   "thread_url": "https://muse.ai/thread/...", "account_id": "session_..."
# }
#
# status: queued → running → succeeded | failed | cancelled
# partial: true means the clip came back shorter than "duration".
# Files are served by this gateway (/api/media/...): reachable wherever the
# gateway is — locally, or through the tunnel's public address.`,
    manage: `# Recent tasks for this key (newest first, limit 1–100, default 20)
curl "${base}/tasks?limit=20"${auth.replace(" \\\n", " ")}

# Cancel a queued or running task
curl -X DELETE ${base}/tasks/TASK_ID${auth.replace(" \\\n", " ")}

# Response: the task with "status": "cancelled". Muse may still finish the
# render on its side, but the gateway stops waiting for it.`,
    retry: `# 1) Safe retries — same idempotency_key returns the SAME task instead of a
#    new render (no double cost after a timeout or a dropped connection).
curl ${base}/tasks \\
  -H "Content-Type: application/json"${auth} \\
  -d '{ "model": "muse-image", "prompt": "Red sneaker on white", "idempotency_key": "sneaker-001" }'

# 2) Continue a result in the same Muse chat (edit it, extend it).
#    Take thread_url and account_id from the finished task:
curl ${base}/tasks \\
  -H "Content-Type: application/json"${auth} \\
  -d '{
    "model": "muse-image",
    "prompt": "Same sneaker, now on a wooden floor",
    "new_chat": false,
    "thread": "https://muse.ai/thread/...",
    "account": "session_..."
  }'
# A thread only exists on the account that created it, so pass both.`,
    python: `import time
import requests

BASE = "${base}"${pyKey}

task = requests.post(f"{BASE}/tasks", headers=HEADERS, json={
    "model": "muse-video",
    "prompt": "A cat playing piano on a rooftop at night",
    "duration": 10,
    "ratio": "9:16",
}).json()

while task["status"] in ("queued", "running"):
    time.sleep(10)
    task = requests.get(f"{BASE}/tasks/{task['id']}", headers=HEADERS).json()

if task["status"] == "succeeded":
    print("Video:", task["url"], task["duration_sec"], "s")
    if task["partial"]:
        print("Shorter than requested — check", task["thread_url"])
else:
    print("Failed:", task["error"])`,
    webhook: `// Node.js (Express) — receives task.succeeded / task.failed / task.cancelled
import crypto from "node:crypto";
import express from "express";

const app = express();
const SECRET = "choose-a-secret"; // same as webhook_secret

app.post("/hooks/muse", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.get("X-Muse-Signature") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return res.status(401).end();

  const { event, task } = JSON.parse(req.body.toString("utf8"));
  console.log(event, task.id, task.url);
  res.sendStatus(200);
});

app.listen(3000);`,
    chat: `from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="${key || "any-value"}")

reply = client.chat.completions.create(
    model="muse-chat",
    messages=[{"role": "user", "content": "Hello"}],
)
print(reply.choices[0].message.content)

# Also supported:
# - stream=True: Server-Sent Events, with keep-alive comments while Muse works
# - images in the message: {"type": "image_url", "image_url": {"url": "..."}}
# - model "muse-image" / "muse-video" (or a combo name) returns media links
# - POST /v1/responses for tools that use the Responses API`,
    mcp: `# MCP endpoint (Streamable HTTP): ${base}/mcp
# Tools: generate_image, generate_video, generate_speech, get_task, continue_task,
#        cancel_task, list_tasks, list_models

# Claude Code
claude mcp add --transport http muse ${base}/mcp${key ? ` \\
  --header "Authorization: Bearer ${key}"` : ""}

# Cursor (.cursor/mcp.json) · VS Code (.vscode/mcp.json uses "servers" and "type": "http")
{
  "mcpServers": {
    "muse": {
      "url": "${base}/mcp"${key ? `,
      "headers": { "Authorization": "Bearer ${key}" }` : ""}
    }
  }
}

# Claude Desktop (claude_desktop_config.json) — stdio bridge, starts the gateway if needed
{
  "mcpServers": {
    "muse": {
      "command": "npx",
      "args": ["-y", "muse-gateway", "mcp"${/^http:\/\/(127\.0\.0\.1|localhost):1412\/v1$/.test(base) ? "" : `, "--url", "${base.replace(/\/v1$/, "")}"`}]${key ? `,
      "env": { "MUSE_API_KEY": "${key}" }` : ""}
    }
  }
}

# Videos take minutes: generate_video returns a task_id, get_task collects it.
# Keep clips around 10 s and chain them with continue_task.`,
    errors: `# Every error looks like this:
# { "error": { "message": "What went wrong", "type": "invalid_request_error" } }
#
# 400 invalid_request_error  bad JSON, missing prompt, duration outside 1–60,
#                            more than 16 images, an image that can't be loaded
# 401 authentication_error   missing or wrong API key (remote calls always need one)
# 403 permission_error       this key isn't allowed to use that model
# 404                        no such task for this key
#
# A task that was accepted (202) and then failed reports it on the task:
# { "status": "failed", "error": "Muse returned no media: ..." }`,
  };
}

interface ApiDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Endpoints ending in /v1, e.g. local and the tunnel's public address. */
  endpoints: { label: string; url: string }[];
  keys: EndpointKey[];
  /** Returns the full (unmasked) key value. */
  revealKey: (id: string) => Promise<string>;
  onCopy?: (text: string, id: string, label?: string) => void;
  copiedId?: string | null;
}

export default function ApiDocsModal({
  isOpen,
  onClose,
  endpoints,
  keys,
  revealKey,
  onCopy,
  copiedId,
}: ApiDocsModalProps) {
  const { t } = useT();
  const activeKeys = keys.filter((k) => k.isActive);
  const [example, setExample] = useState<Example>("video");
  const [endpoint, setEndpoint] = useState(endpoints[0]?.url ?? "");
  const [keyId, setKeyId] = useState(activeKeys[0]?.id ?? "");
  const [fullKey, setFullKey] = useState("");
  const [keyError, setKeyError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEndpoint((current) => (endpoints.some((e) => e.url === current) ? current : endpoints[0]?.url ?? ""));
    setKeyId((current) => (activeKeys.some((k) => k.id === current) ? current : activeKeys[0]?.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, endpoints.length, activeKeys.length]);

  useEffect(() => {
    if (!isOpen || !keyId) {
      setFullKey("");
      return;
    }
    let alive = true;
    setKeyError(false);
    revealKey(keyId)
      .then((value) => { if (alive) setFullKey(value); })
      .catch(() => { if (alive) { setFullKey(""); setKeyError(true); } });
    return () => { alive = false; };
  }, [isOpen, keyId, revealKey]);

  const waitingForKey = !!keyId && !fullKey && !keyError;
  const code = useMemo(
    () => examples(endpoint.replace(/\/$/, ""), keyId ? fullKey : "")[example],
    [endpoint, keyId, fullKey, example]
  );
  const copyId = `docs_${example}`;
  const current = EXAMPLES.find((e) => e.id === example);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("API Docs")} size="full">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          {t("Point any tool that speaks the OpenAI API at this gateway. The examples below use your endpoint and key.")}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("Endpoint")}
            <select
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="h-9 rounded-[10px] border border-border bg-surface-2 px-3 text-sm text-text-main font-mono"
            >
              {endpoints.map((e) => (
                <option key={e.url} value={e.url}>{`${e.label} — ${e.url}`}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("API key")}
            <select
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              className="h-9 rounded-[10px] border border-border bg-surface-2 px-3 text-sm text-text-main"
            >
              {activeKeys.length === 0 && <option value="">{t("No key — local calls only")}</option>}
              {activeKeys.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </label>
        </div>

        {activeKeys.length === 0 && (
          <p className="text-xs text-yellow-400">
            {t("Calls from this machine work without a key. Create a key before using the tunnel — remote calls always need one.")}
          </p>
        )}

        <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-surface-2 w-fit">
          {EXAMPLES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setExample(e.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                example === e.id ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              {t(e.label)}
            </button>
          ))}
        </div>
        {current && <p className="text-xs text-text-muted -mt-2">{t(current.hint)}</p>}

        <div className="relative">
          <pre className="text-xs font-mono bg-black/30 dark:bg-black/40 border border-border-subtle rounded-lg p-4 overflow-x-auto whitespace-pre text-text-main min-h-[220px] max-h-[48vh]">
            {waitingForKey ? t("Loading API key…") : code}
          </pre>
          <Button
            variant="secondary"
            icon={copiedId === copyId ? "check" : "content_copy"}
            onClick={() => onCopy?.(code, copyId, `API docs ${example}`)}
            disabled={waitingForKey}
            className="absolute top-2 right-2"
          >
            {copiedId === copyId ? t("Copied") : t("Copy")}
          </Button>
        </div>
        {keyError && <p className="text-xs text-red-400">{t("Could not load the key. The examples use no key.")}</p>}

        <div className="grid gap-2 sm:grid-cols-3 text-xs text-text-muted">
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Models")}</div>
            <code className="font-mono">muse-video</code>, <code className="font-mono">muse-image</code>, <code className="font-mono">muse-voice</code>, <code className="font-mono">muse-chat</code>
            <div className="mt-1">{t("Any combo name works too. GET /v1/models lists them.")}</div>
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Limits")}</div>
            {t("16 references per request: images up to 20 MB, video or audio clips up to 40 MB. Duration 1–60 s.")}
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Clip length")}</div>
            {t("About 10 s per clip is reliable. Longer requests often return shorter with partial: true — chain 10 s clips instead.")}
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Webhook")}</div>
            {t("Events task.succeeded, task.failed, task.cancelled. Retried after 5 s and 30 s. Remote calls must use a public URL.")}
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Queue")}</div>
            {t("Tasks run as fast as accounts and lanes allow; the rest wait as queued. Repeat idempotency_key to avoid duplicates.")}
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Track jobs")}</div>
            {t("Every task shows on the Media page.")}
          </div>
        </div>
        <p className="text-xs text-text-muted">
          {t("Building an app for this machine? It can connect without the user copying a key: POST /api/pair, the user clicks Allow, then GET /api/pair/<id> returns the key once.")}
        </p>
      </div>
    </Modal>
  );
}
