import type { ChatMessage } from '@/types';

// Codex/ChatGPT inject context envelopes as user-role items. These are not the
// real question, so they are skipped when picking the prompt.
const CONTEXT_PREFIXES = [
  '<environment_context',
  '<user_instructions',
  '<permissions',
  '<collaboration_mode',
  '<turn_aborted',
  '# agents.md',
  '# personality',
  // Codex internal sub-requests (e.g. task title generation) — never forward
  'you are a helpful assistant. you will be presented with a user prompt',
  'provide a short title for a task',
];

function isContextEnvelope(text: string): boolean {
  const head = text.trimStart().slice(0, 160).toLowerCase();
  return CONTEXT_PREFIXES.some((p) => head.startsWith(p));
}

export function extractTextFromItem(item: any): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (Array.isArray(item.content)) {
    return item.content
      .map((c: any) => (typeof c === 'string' ? c : c?.text || c?.input_text || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function extractPromptFromResponseInput(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input;

  if (Array.isArray(input)) {
    const items = input.filter(Boolean);

    // 0. Trailing tool results = this turn's real input. Codex executes tools
    // locally and feeds outputs back for the model to read.
    const toolResults: any[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const t = it && typeof it === 'object' ? it.type : '';
      if (t === 'function_call_output' || t === 'custom_tool_call_output') {
        toolResults.unshift(it);
      } else break;
    }
    if (toolResults.length > 0) {
      return toolResults
        .map((t) => {
          const out = typeof t.output === 'string' ? t.output : JSON.stringify(t.output ?? '');
          return `[TOOL_RESULT${t.call_id ? ` call_id=${t.call_id}` : ''}]\n${out}`;
        })
        .join('\n\n');
    }

    // 1. Latest genuine user message (skip injected context envelopes)
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (typeof item === 'string' || item.role === 'user') {
        const text = extractTextFromItem(item).trim();
        if (text && !isContextEnvelope(text)) return text;
      }
    }

    // 2. User items exist but are all injected context envelopes → nothing
    // real to ask Muse. Only fall back to a non-user item when there are no
    // user items at all.
    const hasUserItems = items.some((item: any) => typeof item !== 'string' && item?.role === 'user');
    if (hasUserItems) return '';

    // 3. Last item in the array
    return extractTextFromItem(items[items.length - 1]).trim();
  }

  if (typeof input === 'object') return extractTextFromItem(input).trim();
  return String(input);
}

export function extractPromptFromChatMessages(messages: ChatMessage[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const toText = (content: ChatMessage['content']) =>
    (typeof content === 'string' ? content : extractTextFromItem({ content })).trim();

  // Latest genuine user message, skipping context envelopes
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const text = toText(messages[i].content);
    if (text && !isContextEnvelope(text)) return text;
  }

  // All user messages are envelopes → nothing real to ask
  if (messages.some((m) => m.role === 'user')) return '';

  const last = messages[messages.length - 1];
  return toText(last.content);
}
