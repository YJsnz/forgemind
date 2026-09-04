import { assistantScopedStorageKey } from './assistantStorage'

const REMINDER_POLICY_KEY = 'forgemind.assistant-reminder-policy.v1'
const REMINDER_POLICY_URL = 'http://127.0.0.1:8080/api/assistant/reminder-policy'

export type AssistantReminderSeverity = 'info' | 'warning' | 'critical'

export interface AssistantReminderPolicy {
  enabled: boolean
  minSeverity: AssistantReminderSeverity
  cooldownMinutes: number
  quietStart: string | null
  quietEnd: string | null
}

export const DEFAULT_ASSISTANT_REMINDER_POLICY: AssistantReminderPolicy = {
  enabled: true,
  minSeverity: 'warning',
  cooldownMinutes: 10,
  quietStart: null,
  quietEnd: null,
}

const severityRank: Record<AssistantReminderSeverity, number> = { info: 1, warning: 2, critical: 3 }

export function readAssistantReminderPolicy(): AssistantReminderPolicy {
  if (typeof window === 'undefined') return { ...DEFAULT_ASSISTANT_REMINDER_POLICY }
  try {
    const value = JSON.parse(window.localStorage.getItem(assistantScopedStorageKey(REMINDER_POLICY_KEY)) ?? '{}') as Partial<AssistantReminderPolicy>
    return normalizeAssistantReminderPolicy(value)
  } catch {
    return { ...DEFAULT_ASSISTANT_REMINDER_POLICY }
  }
}

export function writeAssistantReminderPolicy(input: Partial<AssistantReminderPolicy>): AssistantReminderPolicy {
  const next = normalizeAssistantReminderPolicy({ ...readAssistantReminderPolicy(), ...input })
  persistLocalPolicy(next)
  void syncAssistantReminderPolicy(next)
  return next
}

/** 登录后把 MySQL 中的用户策略同步到浏览器；后端不可用时继续使用本地策略。 */
export async function hydrateAssistantReminderPolicy(): Promise<AssistantReminderPolicy> {
  if (typeof window === 'undefined') return { ...DEFAULT_ASSISTANT_REMINDER_POLICY }
  try {
    const response = await fetch(REMINDER_POLICY_URL, { headers: authHeaders() })
    if (!response.ok) throw new Error(`提醒策略读取失败：${response.status}`)
    const value = await response.json() as Partial<AssistantReminderPolicy> & { persisted?: boolean }
    if (value.persisted === false && window.localStorage.getItem(assistantScopedStorageKey(REMINDER_POLICY_KEY))) {
      const local = readAssistantReminderPolicy()
      void syncAssistantReminderPolicy(local)
      return local
    }
    const next = normalizeAssistantReminderPolicy(value)
    persistLocalPolicy(next)
    return next
  } catch {
    return readAssistantReminderPolicy()
  }
}

export async function syncAssistantReminderPolicy(policy: AssistantReminderPolicy): Promise<AssistantReminderPolicy | null> {
  if (typeof window === 'undefined' || !window.localStorage.getItem('forgemind.token')) return null
  try {
    const response = await fetch(REMINDER_POLICY_URL, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(policy) })
    if (!response.ok) throw new Error(`提醒策略保存失败：${response.status}`)
    const next = normalizeAssistantReminderPolicy(await response.json() as Partial<AssistantReminderPolicy>)
    persistLocalPolicy(next)
    return next
  } catch {
    return null
  }
}

export function reminderSeverityAllowed(policy: AssistantReminderPolicy, severity: AssistantReminderSeverity): boolean {
  return policy.enabled && severityRank[severity] >= severityRank[policy.minSeverity]
}

export function isAssistantReminderQuiet(policy: AssistantReminderPolicy, now = new Date()): boolean {
  if (!policy.quietStart || !policy.quietEnd) return false
  const current = now.getHours() * 60 + now.getMinutes()
  const start = clockMinutes(policy.quietStart)
  const end = clockMinutes(policy.quietEnd)
  if (start === end) return true
  return start < end ? current >= start && current < end : current >= start || current < end
}

function normalizeAssistantReminderPolicy(value: Partial<AssistantReminderPolicy>): AssistantReminderPolicy {
  const minSeverity = value.minSeverity === 'info' || value.minSeverity === 'critical' ? value.minSeverity : 'warning'
  const cooldownMinutes = typeof value.cooldownMinutes === 'number' && Number.isFinite(value.cooldownMinutes)
    ? Math.max(1, Math.min(1440, Math.round(value.cooldownMinutes)))
    : DEFAULT_ASSISTANT_REMINDER_POLICY.cooldownMinutes
  return {
    enabled: value.enabled !== false,
    minSeverity,
    cooldownMinutes,
    quietStart: validClock(value.quietStart) ? value.quietStart! : null,
    quietEnd: validClock(value.quietEnd) ? value.quietEnd! : null,
  }
}

function persistLocalPolicy(policy: AssistantReminderPolicy) {
  try { window.localStorage.setItem(assistantScopedStorageKey(REMINDER_POLICY_KEY), JSON.stringify(policy)) } catch { /* optional persistence */ }
}

function authHeaders(): Record<string, string> {
  const token = window.localStorage.getItem('forgemind.token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function validClock(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)
}

function clockMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}
