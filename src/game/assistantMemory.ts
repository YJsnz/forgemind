import { assistantScopedStorageKey } from './assistantStorage'

const ASSISTANT_MEMORY_URL = 'http://127.0.0.1:8080/api/assistant/memory'

const MEMORY_KEY = 'forgemind.assistant-memory.v1'

export type AssistantMemory = Record<string, string>

export function readAssistantMemory(): AssistantMemory {
  try {
    const value = JSON.parse(window.localStorage.getItem(assistantScopedStorageKey(MEMORY_KEY)) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const memory: AssistantMemory = {}
    for (const [key, content] of Object.entries(value)) {
      if (key.length > 0 && key.length <= 80 && typeof content === 'string' && content.length <= 400) memory[key] = content
    }
    return memory
  } catch {
    return {}
  }
}

function writeAssistantMemory(memory: AssistantMemory) {
  try { window.localStorage.setItem(assistantScopedStorageKey(MEMORY_KEY), JSON.stringify(memory)) } catch { /* optional persistence */ }
}

function authHeaders(): Record<string, string> {
  const token = window.localStorage.getItem('forgemind.token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** 登录后把用户级长期记忆同步到浏览器；后端不可用时继续使用本地缓存。 */
export async function hydrateAssistantMemory(): Promise<AssistantMemory> {
  if (typeof window === 'undefined' || !window.localStorage.getItem('forgemind.token')) return readAssistantMemory()
  try {
    const response = await fetch(ASSISTANT_MEMORY_URL, { headers: authHeaders() })
    if (!response.ok) throw new Error(`记忆读取失败：${response.status}`)
    const body = await response.json() as { memory?: unknown; persisted?: boolean }
    const local = readAssistantMemory()
    const remote = normalizeMemory(body.memory)
    const next = { ...local, ...remote }
    if (Object.keys(next).length > Object.keys(remote).length) void syncAssistantMemory(next)
    writeAssistantMemory(next)
    return next
  } catch {
    return readAssistantMemory()
  }
}

async function syncAssistantMemory(memory: AssistantMemory): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage.getItem('forgemind.token')) return
  await Promise.all(Object.entries(memory).map(([key, value]) => fetch(ASSISTANT_MEMORY_URL, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => undefined)))
}

function syncAssistantMemoryEntry(key: string, value: string) {
  if (typeof window === 'undefined' || !window.localStorage.getItem('forgemind.token')) return
  void fetch(ASSISTANT_MEMORY_URL, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => undefined)
}

function normalizeMemory(value: unknown): AssistantMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const memory: AssistantMemory = {}
  for (const [key, content] of Object.entries(value)) {
    if (key.length > 0 && key.length <= 80 && typeof content === 'string' && content.length <= 400) memory[key] = content
  }
  return memory
}

export function rememberAssistantPreference(key: string, value: string): AssistantMemory {
  const normalizedKey = key.trim().slice(0, 80)
  const normalizedValue = value.trim().slice(0, 400)
  const next = { ...readAssistantMemory(), [normalizedKey]: normalizedValue }
  writeAssistantMemory(next)
  syncAssistantMemoryEntry(normalizedKey, normalizedValue)
  return next
}

export function forgetAssistantPreference(key: string): AssistantMemory {
  const next = readAssistantMemory()
  delete next[key]
  writeAssistantMemory(next)
  if (typeof window !== 'undefined' && window.localStorage.getItem('forgemind.token')) {
    void fetch(ASSISTANT_MEMORY_URL, { method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).catch(() => undefined)
  }
  return next
}
