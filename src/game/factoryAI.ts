import type { GenerationSpec } from './generativeFactory'

const AI_BASE = (import.meta.env.VITE_AI_BASE_URL as string | undefined) ?? 'http://localhost:8000'

export interface FactorySpecReply {
  spec: Partial<GenerationSpec>
  source: 'deepseek' | 'qwen' | 'rule' | 'fallback'
  note: string | null
}

/** Optional LLM extraction; the caller always keeps the deterministic parser as fallback. */
export async function requestFactorySpec(brief: string, defaults: GenerationSpec): Promise<FactorySpecReply> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2800)
  try {
    const response = await fetch(`${AI_BASE}/api/ai/factory-spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief, defaults }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
    return (await response.json()) as FactorySpecReply
  } finally {
    window.clearTimeout(timer)
  }
}
