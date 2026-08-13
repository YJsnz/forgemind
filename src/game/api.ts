import type { FactorySave } from './save'

/**
 * 后端 API 客户端（可选演进：接 Spring Boot 极薄后端）。
 *
 * 前端默认仍走本地 JSON 文件（7 天冲刺方案）；后端在线时可切换到
 * Spring Boot 的 /api/factory 读写。所有请求带超时，失败回退不阻塞 UI。
 */

const SPRING_BASE = 'http://localhost:8080'
const AI_BASE = 'http://localhost:8000'

async function withTimeout<T>(p: Promise<T>, ms = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 从 Spring Boot 拉取工厂存档 */
export async function fetchRemoteSave(): Promise<FactorySave> {
  const res = await withTimeout(fetch(`${SPRING_BASE}/api/factory`))
  if (!res.ok) throw new Error(`后端返回 ${res.status}`)
  return (await res.json()) as FactorySave
}

/** 推送存档到 Spring Boot */
export async function pushRemoteSave(save: FactorySave): Promise<void> {
  const res = await withTimeout(
    fetch(`${SPRING_BASE}/api/factory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(save),
    }),
  )
  if (!res.ok) throw new Error(`后端返回 ${res.status}`)
}

/** 探测 Spring Boot 是否在线 */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const res = await withTimeout(fetch(`${SPRING_BASE}/api/factory/health`), 1500)
    return res.ok
  } catch {
    return false
  }
}

export interface AssistantReply {
  answer: string
  source: string
  note: string | null
}

/** 调 AI 助手（离线编排占位） */
export async function askAssistant(
  question: string,
  context?: Record<string, unknown>,
): Promise<AssistantReply> {
  const res = await withTimeout(
    fetch(`${AI_BASE}/api/ai/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context }),
    }),
  )
  if (!res.ok) throw new Error(`AI 服务返回 ${res.status}`)
  return (await res.json()) as AssistantReply
}
