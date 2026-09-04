import type { AgentAnalysisResult } from './agentTypes'
import { assistantScopedStorageKey } from './assistantStorage'

const PROJECT_MEMORY_KEY = 'forgemind.assistant-project-memory.v1'
const MAX_PROJECTS = 12
const MAX_RUNS_PER_PROJECT = 6
const MAX_FINDINGS_PER_RUN = 6
const MAX_VERSIONS_PER_PROJECT = 12

export interface AssistantProjectFindingMemory {
  id: string
  severity: string
  title: string
  detail: string
  recommendation: string
  objectIds: string[]
}

export interface AssistantProjectRunMemory {
  runId: string
  createdAt: string
  mode: AgentAnalysisResult['mode']
  headline: string
  summary: string
  findings: AssistantProjectFindingMemory[]
}

export interface AssistantProjectVersionMemory {
  version: number
  observedAt: string
  label?: string
}

export interface AssistantProjectMemory {
  projectId: string
  projectName?: string
  updatedAt: string
  runs: AssistantProjectRunMemory[]
  versions: AssistantProjectVersionMemory[]
}

function readAll(): Record<string, AssistantProjectMemory> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(assistantScopedStorageKey(PROJECT_MEMORY_KEY)) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, AssistantProjectMemory> = {}
    for (const [projectId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const candidate = value as Partial<AssistantProjectMemory>
      if (candidate.projectId !== projectId || typeof candidate.updatedAt !== 'string' || !Array.isArray(candidate.runs)) continue
      result[projectId] = {
        projectId,
        ...(typeof candidate.projectName === 'string' ? { projectName: candidate.projectName } : {}),
        updatedAt: candidate.updatedAt,
        runs: candidate.runs.filter(isRun).slice(0, MAX_RUNS_PER_PROJECT),
        versions: Array.isArray(candidate.versions) ? candidate.versions.filter(isVersion).slice(0, MAX_VERSIONS_PER_PROJECT) : [],
      }
    }
    return result
  } catch {
    return {}
  }
}

function writeAll(value: Record<string, AssistantProjectMemory>) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(assistantScopedStorageKey(PROJECT_MEMORY_KEY), JSON.stringify(value)) } catch { /* optional persistence */ }
}

export function readAssistantProjectMemory(projectId: string | null | undefined): AssistantProjectMemory | null {
  if (!projectId) return null
  return readAll()[projectId] ?? null
}

export function rememberAssistantProjectRun(input: {
  projectId: string
  projectName?: string | null
  result: AgentAnalysisResult
}): AssistantProjectMemory {
  const all = readAll()
  const previous = all[input.projectId]
  const nextRun: AssistantProjectRunMemory = {
    runId: input.result.runId,
    createdAt: input.result.createdAt,
    mode: input.result.mode,
    headline: input.result.headline,
    summary: input.result.summary,
    findings: input.result.findings.slice(0, MAX_FINDINGS_PER_RUN).map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      recommendation: finding.recommendation,
      objectIds: finding.objectIds.slice(0, 12),
    })),
  }
  const memory: AssistantProjectMemory = {
    projectId: input.projectId,
    ...(input.projectName ? { projectName: input.projectName } : previous?.projectName ? { projectName: previous.projectName } : {}),
    updatedAt: new Date().toISOString(),
    runs: [nextRun, ...(previous?.runs ?? []).filter((run) => run.runId !== nextRun.runId)].slice(0, MAX_RUNS_PER_PROJECT),
    versions: previous?.versions ?? [],
  }
  const nextAll = Object.fromEntries([
    [input.projectId, memory],
    ...Object.entries(all).filter(([projectId]) => projectId !== input.projectId),
  ].slice(0, MAX_PROJECTS))
  writeAll(nextAll)
  return memory
}

export function rememberAssistantProjectVersion(input: {
  projectId: string
  projectName?: string | null
  version: number
}): AssistantProjectMemory | null {
  if (!input.projectId || !Number.isInteger(input.version) || input.version < 0) return null
  const all = readAll()
  const previous = all[input.projectId]
  const version: AssistantProjectVersionMemory = {
    version: input.version,
    observedAt: new Date().toISOString(),
    label: input.projectName ? `${input.projectName} · v${input.version}` : `v${input.version}`,
  }
  const memory: AssistantProjectMemory = {
    projectId: input.projectId,
    ...(input.projectName ? { projectName: input.projectName } : previous?.projectName ? { projectName: previous.projectName } : {}),
    updatedAt: version.observedAt,
    runs: previous?.runs ?? [],
    versions: [version, ...(previous?.versions ?? []).filter((entry) => entry.version !== input.version)].slice(0, MAX_VERSIONS_PER_PROJECT),
  }
  const nextAll = Object.fromEntries([
    [input.projectId, memory],
    ...Object.entries(all).filter(([projectId]) => projectId !== input.projectId),
  ].slice(0, MAX_PROJECTS))
  writeAll(nextAll)
  return memory
}

function isRun(value: unknown): value is AssistantProjectRunMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AssistantProjectRunMemory>
  return typeof candidate.runId === 'string'
    && typeof candidate.createdAt === 'string'
    && (candidate.mode === 'diagnose' || candidate.mode === 'plan_design')
    && typeof candidate.headline === 'string'
    && typeof candidate.summary === 'string'
    && Array.isArray(candidate.findings)
}

function isVersion(value: unknown): value is AssistantProjectVersionMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AssistantProjectVersionMemory>
  return Number.isInteger(candidate.version)
    && (candidate.version as number) >= 0
    && typeof candidate.observedAt === 'string'
    && (candidate.label === undefined || typeof candidate.label === 'string')
}
