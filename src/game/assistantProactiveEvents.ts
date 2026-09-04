import { assistantScopedStorageKey } from './assistantStorage'

const PROACTIVE_EVENTS_KEY = 'forgemind.assistant-proactive-events.v1'
const MAX_EVENTS = 48
const REMOTE_EVENTS_URL = 'http://127.0.0.1:8080/api/assistant/reminders'

export type AssistantProactiveSeverity = 'info' | 'warning' | 'critical'

export interface AssistantProactiveEventInput {
  fingerprint: string
  source: string
  severity: AssistantProactiveSeverity
  message: string
}

export interface AssistantProactiveAggregate extends AssistantProactiveEventInput {
  sources: string[]
  count: number
  firstObservedAt: number
  lastObservedAt: number
  status: 'open' | 'resolved'
}

interface RemoteReminderEvent {
  dedupe_key?: unknown
  severity?: unknown
  last_message?: unknown
  source_summary?: unknown
  occurrence_count?: unknown
  first_observed_at?: unknown
  last_emitted_at?: unknown
  resolved_at?: unknown
}

const rank: Record<AssistantProactiveSeverity, number> = { info: 1, warning: 2, critical: 3 }

export function mergeAssistantProactiveEvent(current: AssistantProactiveAggregate[], input: AssistantProactiveEventInput, now = Date.now()): AssistantProactiveAggregate[] {
  const fingerprint = input.fingerprint.trim().slice(0, 180)
  const source = input.source.trim().slice(0, 80) || 'assistant'
  if (!fingerprint || !input.message.trim()) return current.slice(0, MAX_EVENTS)
  const index = current.findIndex((event) => event.fingerprint === fingerprint)
  if (index < 0) {
    return [{ ...input, fingerprint, source, message: input.message.trim().slice(0, 1000), sources: [source], count: 1, firstObservedAt: now, lastObservedAt: now, status: 'open' as const }, ...current].slice(0, MAX_EVENTS)
  }
  const previous = current[index]
  const next: AssistantProactiveAggregate = {
    ...previous,
    ...input,
    fingerprint,
    source,
    message: input.message.trim().slice(0, 1000),
    sources: Array.from(new Set([...previous.sources, source])).slice(0, 12),
    count: previous.count + 1,
    lastObservedAt: now,
    status: 'open' as const,
    severity: rank[input.severity] >= rank[previous.severity] ? input.severity : previous.severity,
  }
  return [next, ...current.filter((_, candidateIndex) => candidateIndex !== index)].slice(0, MAX_EVENTS)
}

export function recordAssistantProactiveEvent(input: AssistantProactiveEventInput): AssistantProactiveAggregate | null {
  if (typeof window === 'undefined') return null
  const next = mergeAssistantProactiveEvent(readAssistantProactiveEvents(), input)
  try { window.localStorage.setItem(assistantScopedStorageKey(PROACTIVE_EVENTS_KEY), JSON.stringify(next)) } catch { /* optional persistence */ }
  return next[0] ?? null
}

export function resolveAssistantProactiveEvent(fingerprint: string): boolean {
  if (typeof window === 'undefined') return false
  const key = fingerprint.trim()
  if (!key) return false
  const events = readAssistantProactiveEvents()
  const index = events.findIndex((event) => event.fingerprint === key)
  if (index < 0) return false
  events[index] = { ...events[index], status: 'resolved' }
  try { window.localStorage.setItem(assistantScopedStorageKey(PROACTIVE_EVENTS_KEY), JSON.stringify(events)) } catch { /* optional persistence */ }
  return true
}

export function readAssistantProactiveEvents(): AssistantProactiveAggregate[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(assistantScopedStorageKey(PROACTIVE_EVENTS_KEY)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((event): event is AssistantProactiveAggregate => Boolean(event)
      && typeof event.fingerprint === 'string' && typeof event.source === 'string'
      && (event.severity === 'info' || event.severity === 'warning' || event.severity === 'critical')
      && typeof event.message === 'string' && Array.isArray(event.sources)
      && typeof event.count === 'number' && typeof event.firstObservedAt === 'number' && typeof event.lastObservedAt === 'number'
      && (event.status === 'open' || event.status === 'resolved'))
      .slice(0, MAX_EVENTS)
  } catch {
    return []
  }
}

/**
 * Hydrate the local event cache from the authenticated reminder ledger.
 * The cache remains the offline/read-only fallback, while the server remains
 * authoritative for cross-session dedupe and ownership.
 */
export async function hydrateAssistantProactiveEvents(): Promise<AssistantProactiveAggregate[]> {
  const local = readAssistantProactiveEvents()
  if (typeof window === 'undefined') return local
  const token = window.localStorage.getItem('forgemind.token')
  if (!token) return local
  try {
    const response = await fetch(`${REMOTE_EVENTS_URL}?status=open&limit=${MAX_EVENTS}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return local
    const body = await response.json() as { events?: unknown }
    const remote = Array.isArray(body.events) ? body.events.map(normalizeRemoteReminder).filter((event): event is AssistantProactiveAggregate => event !== null) : []
    const merged = mergeRemoteEvents(local, remote)
    window.localStorage.setItem(assistantScopedStorageKey(PROACTIVE_EVENTS_KEY), JSON.stringify(merged))
    return merged
  } catch {
    return local
  }
}

export function dismissAssistantNoticeInBackground(fingerprint: string): boolean {
  const key = fingerprint.trim()
  const localResolved = resolveAssistantProactiveEvent(key)
  if (typeof window === 'undefined' || !key) return localResolved
  const token = window.localStorage.getItem('forgemind.token')
  if (!token) return localResolved
  void fetch(`${REMOTE_EVENTS_URL}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dedupeKey: key }),
  }).catch(() => undefined)
  return localResolved
}

function normalizeRemoteReminder(value: unknown): AssistantProactiveAggregate | null {
  if (!value || typeof value !== 'object') return null
  const item = value as RemoteReminderEvent
  const fingerprint = typeof item.dedupe_key === 'string' ? item.dedupe_key.trim().slice(0, 180) : ''
  const message = typeof item.last_message === 'string' ? item.last_message.trim().slice(0, 1000) : ''
  const severity = item.severity === 'critical' || item.severity === 'warning' || item.severity === 'info' ? item.severity : null
  const firstObservedAt = parseRemoteTime(item.first_observed_at)
  const lastObservedAt = parseRemoteTime(item.last_emitted_at) || firstObservedAt
  if (!fingerprint || !message || !severity || !firstObservedAt || !lastObservedAt) return null
  const rawSources = Array.isArray(item.source_summary)
    ? item.source_summary.filter((source): source is string => typeof source === 'string')
    : typeof item.source_summary === 'string' ? parseSourceSummary(item.source_summary) : []
  const sources = Array.from(new Set(rawSources.map((source) => source.trim()).filter(Boolean))).slice(0, 12)
  return {
    fingerprint,
    source: sources[0] ?? 'assistant',
    severity,
    message,
    sources: sources.length ? sources : ['assistant'],
    count: typeof item.occurrence_count === 'number' && Number.isFinite(item.occurrence_count) ? Math.max(1, Math.floor(item.occurrence_count)) : 1,
    firstObservedAt,
    lastObservedAt,
    status: item.resolved_at ? 'resolved' : 'open',
  }
}

function mergeRemoteEvents(local: AssistantProactiveAggregate[], remote: AssistantProactiveAggregate[]): AssistantProactiveAggregate[] {
  const byKey = new Map(local.map((event) => [event.fingerprint, event]))
  for (const event of remote) {
    const previous = byKey.get(event.fingerprint)
    byKey.set(event.fingerprint, previous
      ? { ...previous, ...event, sources: Array.from(new Set([...previous.sources, ...event.sources])).slice(0, 12), count: Math.max(previous.count, event.count), firstObservedAt: Math.min(previous.firstObservedAt, event.firstObservedAt), lastObservedAt: Math.max(previous.lastObservedAt, event.lastObservedAt) }
      : event)
  }
  return [...byKey.values()].sort((left, right) => right.lastObservedAt - left.lastObservedAt).slice(0, MAX_EVENTS)
}

function parseRemoteTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function parseSourceSummary(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((source): source is string => typeof source === 'string') : []
  } catch {
    return []
  }
}

export function autopilotSource(code: string): string {
  if (code.includes('throughput')) return 'throughput'
  if (code.includes('blocked') || code.includes('constraint') || code.includes('delivery')) return 'backpressure'
  if (code.includes('stock')) return 'inventory'
  if (code.includes('energy')) return 'energy'
  if (code.includes('bottleneck')) return 'bottleneck'
  return 'autopilot'
}
