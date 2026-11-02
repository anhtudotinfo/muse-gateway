"use client";

import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/endpoint/ui/Modal";
import Button from "@/components/endpoint/ui/Button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { EndpointKey } from "./types";

// Integration guide with the chosen endpoint and key filled in, so a user
// can paste each example into their own tool unchanged.

type Example = "video" | "status" | "python" | "webhook" | "chat";

const EXAMPLES: { id: Example; label: string; hint: string }[] = [
  { id: "video", label: "Create video", hint: "Starts a 30-second video and returns a task right away." },
  { id: "status", label: "Check result", hint: "Poll until status is succeeded or failed. url is the final file." },
  { id: "python", label: "Python", hint: "Create a task and wait for the finished file." },
  { id: "webhook", label: "Webhook", hint: "Verify the signature the gateway sends when a task ends." },
  { id: "chat", label: "Chat", hint: "Plain OpenAI-compatible chat, for tools that only speak that API." },
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
    "duration": 30,
    "ratio": "9:16",
    "images": ["https://example.com/cat.jpg"],
    "webhook_url": "https://example.com/hooks/muse",
    "webhook_secret": "choose-a-secret"
  }'`,
    status: `curl ${base}/tasks/TASK_ID${auth.replace(" \\\n", " ")}

# Response when finished:
# {
#   "id": "task_...", "status": "succeeded",
#   "url": "${base.replace(/\/v1$/, "")}/api/media/media-....mp4",
#   "duration_sec": 30.1, "partial": false,
#   "media": [{ "url": "...", "kind": "video", "duration_sec": 30.1 }]
# }`,
    python: `import time
import requests

BASE = "${base}"${pyKey}

task = requests.post(f"{BASE}/tasks", headers=HEADERS, json={
    "model": "muse-video",
    "prompt": "A cat playing piano on a rooftop at night",
    "duration": 30,
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
print(reply.choices[0].message.content)`,
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
            <code className="font-mono">muse-video</code>, <code className="font-mono">muse-image</code>, <code className="font-mono">muse-chat</code>
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Limits")}</div>
            {t("Up to 60 s per video, 16 reference images of 20 MB each.")}
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <div className="font-semibold text-text-main mb-1">{t("Track jobs")}</div>
            {t("Every task shows on the Tasks page.")}
          </div>
        </div>
      </div>
    </Modal>
  );
}
