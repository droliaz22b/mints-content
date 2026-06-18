import { pb } from './pocketbase'

// ─── Shared AI access ─────────────────────────────────────────────────────────
// All OpenAI calls go through a PocketBase server-side proxy (`/api/ai/chat`).
// The OpenAI key is stored server-side and injected by the proxy, so it is never
// sent to the browser. Admins set/rotate the key on the Settings page.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatPayload {
  model?: string
  messages: ChatMessage[]
  response_format?: { type: string }
  max_tokens?: number
  temperature?: number
}

export interface ChatCompletion {
  choices: { message: { content: string } }[]
}

// Calls the server proxy with the current user's login token (handled by the SDK).
// Throws a ClientResponseError if the key is missing or OpenAI returns an error.
export async function aiChat(payload: ChatPayload): Promise<ChatCompletion> {
  return pb.send<ChatCompletion>('/api/ai/chat', {
    method: 'POST',
    body: { model: 'gpt-4o-mini', ...payload },
  })
}

// ─── Admin key management (Settings page) ─────────────────────────────────────

export async function getAiKeyStatus(): Promise<boolean> {
  const res = await pb.send<{ configured: boolean }>('/api/ai/config', { method: 'GET' })
  return !!res.configured
}

export async function setAiKey(openai_key: string): Promise<void> {
  await pb.send('/api/ai/config', { method: 'POST', body: { openai_key } })
}
