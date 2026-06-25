import { pb } from './pocketbase'

// ─── Shared AI access ─────────────────────────────────────────────────────────
// All OpenAI calls go through a PocketBase server-side proxy (`/api/ai/chat`).
// The OpenAI key is stored server-side and injected by the proxy, so it is never
// sent to the browser. Admins set/rotate the key on the Settings page.

// A message's content is either plain text, or (for vision) an array of parts.
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
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

// ─── Model tiers by task intensity ────────────────────────────────────────────
// Pick a tier at each call site by how much reasoning/accuracy the task needs.
// Tune the model behind each tier here, in one place.
//   fast   → high-volume, mechanical work (captions, lightweight extraction)
//   smart  → judgement & accuracy (recipe formatting + tagging, categorization)
//   vision → image understanding (thumbnail best-photo pick)
export const AI_MODELS = {
  fast: 'gpt-4o-mini',
  smart: 'gpt-4o',
  vision: 'gpt-4o',
} as const
export type AiTier = keyof typeof AI_MODELS

// Calls the server proxy with the current user's login token (handled by the SDK).
// Throws a ClientResponseError if the key is missing or OpenAI returns an error.
// Defaults to the `fast` tier unless the payload specifies a model.
export async function aiChat(payload: ChatPayload): Promise<ChatCompletion> {
  return pb.send<ChatCompletion>('/api/ai/chat', {
    method: 'POST',
    body: { model: AI_MODELS.fast, ...payload },
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
