import { assistantScopedStorageKey } from './assistantStorage'

const ASSISTANT_SUMMARY_KEY = 'forgemind.assistant-history-summary.v1'
const MAX_SUMMARY_CHARS = 1600
export const ASSISTANT_SUMMARY_TRIGGER_TURNS = 8

export interface AssistantConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export function readAssistantConversationSummary(): string {
  try {
    const value = window.sessionStorage.getItem(assistantScopedStorageKey(ASSISTANT_SUMMARY_KEY)) ?? ''
    return typeof value === 'string' ? value.slice(0, MAX_SUMMARY_CHARS) : ''
  } catch {
    return ''
  }
}

/**
 * Extractive, deterministic compression for long conversations. It preserves
 * intent-bearing turns without asking the LLM to summarize its own safety
 * constraints or turning a stale factory fact into an authoritative value.
 */
export function buildAssistantConversationSummary(turns: AssistantConversationTurn[], previous = ''): string {
  const fragments = turns
    .filter((turn) => turn.content.trim())
    .map((turn) => `${turn.role === 'user' ? '驾驶员' : 'BT'}：${turn.content.trim().replace(/\s+/gu, ' ').slice(0, 260)}`)
  const material = [previous.trim(), ...fragments].filter(Boolean).join('\n')
  if (material.length <= MAX_SUMMARY_CHARS) return material
  const prefix = '早期对话摘要（动态工厂事实需重新读取）：'
  const head = fragments.slice(0, 2).join('\n').slice(0, 520)
  const tailBudget = Math.max(0, MAX_SUMMARY_CHARS - prefix.length - head.length - 2)
  return `${prefix}\n${head}\n${material.slice(-tailBudget)}`.slice(0, MAX_SUMMARY_CHARS)
}

export function writeAssistantConversationSummary(turns: AssistantConversationTurn[], previous = readAssistantConversationSummary()): void {
  if (turns.length <= ASSISTANT_SUMMARY_TRIGGER_TURNS) return
  try {
    window.sessionStorage.setItem(
      assistantScopedStorageKey(ASSISTANT_SUMMARY_KEY),
      buildAssistantConversationSummary(turns.slice(0, -ASSISTANT_SUMMARY_TRIGGER_TURNS), previous),
    )
  } catch {
    // Session storage is optional; the bounded raw conversation remains usable.
  }
}

export function clearAssistantConversationSummary(): void {
  try { window.sessionStorage.removeItem(assistantScopedStorageKey(ASSISTANT_SUMMARY_KEY)) } catch { /* optional storage */ }
}
