export interface CookieMap {
  [key: string]: string;
}

export interface Profile {
  id: string;
  name: string;
  cookies: string;
  createdAt: string;
  updatedAt: string;
  /** Last liveness check timestamp (ISO) — set by /api/sessions/test. */
  lastTested?: string | null;
  /** Last liveness result — 'valid' = cookie still works. */
  lastStatus?: 'valid' | 'invalid' | null;
  /** Optional egress proxy for this account's browser session —
   *  e.g. "http://user:pass@host:8080" or "socks5://host:1080".
   *  Accounts sharing the same proxy reuse one headless browser. */
  proxy?: string | null;
}

export interface BrowserDetection {
  chrome: string | null;
  edge: string | null;
}

export interface SessionTestData {
  vm_state?: string;
  vm_id?: string;
  status?: string;
  endpoint_url?: string;
  [key: string]: any;
}

export interface SessionTestResult {
  valid: boolean;
  message?: string;
  data?: SessionTestData;
  status?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | string;
  content: string | any;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** Open a fresh Muse chat before sending — isolates a new scenario/script
   *  from the previous conversation's context. */
  new_chat?: boolean;
}

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}
