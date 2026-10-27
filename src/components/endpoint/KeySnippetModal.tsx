"use client";

import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/endpoint/ui/Modal";
import Button from "@/components/endpoint/ui/Button";
import { cn } from "@/lib/cn";

// Ready-to-paste client configs for one API key — cURL / Python / Node /
// OpenAI SDK — with the endpoint URL and full key baked in.

type Lang = "curl" | "python" | "node" | "openai";

const LANGS: { id: Lang; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "node", label: "Node.js" },
  { id: "openai", label: "OpenAI SDK" },
];

function snippets(base: string, key: string): Record<Lang, string> {
  const k = key || "<API_KEY>";
  return {
    curl: `curl ${base}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${k}" \\
  -d '{
    "model": "muse-chat",
    "messages": [{"role": "user", "content": "Xin chào"}],
    "stream": false
  }'`,
    python: `import requests

resp = requests.post(
    "${base}/chat/completions",
    headers={"Authorization": "Bearer ${k}"},
    json={
        "model": "muse-chat",
        "messages": [{"role": "user", "content": "Xin chào"}],
    },
    timeout=300,
)
print(resp.json()["choices"][0]["message"]["content"])`,
    node: `const resp = await fetch("${base}/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${k}",
  },
  body: JSON.stringify({
    model: "muse-chat",
    messages: [{ role: "user", content: "Xin chào" }],
  }),
});
const data = await resp.json();
console.log(data.choices[0].message.content);`,
    openai: `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="${k}",
)

resp = client.chat.completions.create(
    model="muse-chat",
    messages=[{"role": "user", "content": "Xin chào"}],
)
print(resp.choices[0].message.content)

# Streaming:
# for chunk in client.chat.completions.create(..., stream=True):
#     print(chunk.choices[0].delta.content or "", end="")`,
  };
}

interface KeySnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Base URL ending in /v1 — e.g. http://localhost:3000/v1 */
  baseUrl: string;
  keyId: string;
  keyName: string;
  /** Returns the full (unmasked) key value — fetches /api/keys?reveal=<id>. */
  revealKey: (id: string) => Promise<string>;
  onCopy?: (text: string, id: string, label?: string) => void;
  copiedId?: string | null;
}

export default function KeySnippetModal({
  isOpen,
  onClose,
  baseUrl,
  keyId,
  keyName,
  revealKey,
  onCopy,
  copiedId,
}: KeySnippetModalProps) {
  const [lang, setLang] = useState<Lang>("curl");
  const [fullKey, setFullKey] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;
    setFullKey("");
    let alive = true;
    revealKey(keyId)
      .then((v) => { if (alive) setFullKey(v); })
      .catch(() => { if (alive) setFullKey(""); });
    return () => { alive = false; };
  }, [isOpen, keyId, revealKey]);

  const code = useMemo(
    () => snippets(baseUrl.replace(/\/$/, ""), fullKey)[lang],
    [baseUrl, fullKey, lang]
  );
  const copyId = `snippet_${keyId}_${lang}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Client config — ${keyName}`} size="xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Dán thẳng vào project — endpoint và API key đã điền sẵn.
        </p>
        <div className="flex gap-1 p-1 rounded-lg bg-surface-2 w-fit">
          {LANGS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                lang === l.id
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="text-xs font-mono bg-black/30 dark:bg-black/40 border border-border-subtle rounded-lg p-4 overflow-x-auto whitespace-pre text-text-main min-h-[180px]">
            {fullKey ? code : "Đang nạp API key…"}
          </pre>
          <Button
            variant="secondary"
            icon={copiedId === copyId ? "check" : "content_copy"}
            onClick={() => onCopy?.(code, copyId, `snippet ${lang}`)}
            disabled={!fullKey}
            className="absolute top-2 right-2"
          >
            {copiedId === copyId ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          Endpoint: <code className="font-mono">{baseUrl}</code> · Đổi <code className="font-mono">model</code> thành tên combo để ép pool dùng nhóm account riêng.
        </p>
      </div>
    </Modal>
  );
}
