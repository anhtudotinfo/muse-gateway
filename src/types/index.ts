export interface CookieMap {
  [key: string]: string;
}

export interface Profile {
  id: string;
  name: string;
  cookies: string;
  createdAt: string;
  updatedAt: string;
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
}

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}
