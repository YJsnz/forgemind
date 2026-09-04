import type { AgentMode } from './agentTypes'
import { assistantScopedStorageKey } from './assistantStorage'
import { planAssistantSubtasks } from './assistantTaskPlan'

const TASK_HISTORY_KEY = 'forgemind.assistant-task-history.v1'
const MAX_TASK_HISTORY = 12
const MAX_SERVER_TASK_HISTORY = 8
const SERVER_TASK_HISTORY_URL = 'http://127.0.0.1:8080/api/agent/runs'

export type AssistantAgentTaskCommand =
  | { kind: 'agent'; objective: string; mode: AgentMode }
  | { kind: 'autopilot' }

export interface AssistantTaskState {
  kind: AssistantAgentTaskCommand['kind']
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  objective?: string
  mode?: AgentMode
  message: string
  resultSummary?: string
  progress?: number
  activeStepId?: string
  steps?: AssistantTaskStep[]
  updatedAt: string
}

export interface AssistantTaskStep {
  id: string
  label: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  message?: string
}

export type AssistantTaskHistoryItem = AssistantTaskState & { taskId: string }

export interface AssistantServerTaskHistoryItem {
  taskId: string
  objective: string
  mode: 'read_only' | 'plan_design'
  status: string
  summary: string
  updatedAt: string
}

function readPersistedTaskHistory(): AssistantTaskHistoryItem[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(assistantScopedStorageKey(TASK_HISTORY_KEY)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AssistantTaskHistoryItem => Boolean(item)
      && typeof item.taskId === 'string'
      && (item.kind === 'agent' || item.kind === 'autopilot')
      && ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(item.status)
      && typeof item.message === 'string'
      && typeof item.updatedAt === 'string')
      .map((item) => normalizeTaskHistoryItem(item))
      .slice(0, MAX_TASK_HISTORY)
  } catch {
    return []
  }
}

let taskHistory: AssistantTaskHistoryItem[] = []

function persistTaskHistory() {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(assistantScopedStorageKey(TASK_HISTORY_KEY), JSON.stringify(taskHistory.slice(0, MAX_TASK_HISTORY))) } catch { /* optional persistence */ }
}

function taskCommandFromState(state: AssistantTaskState): AssistantAgentTaskCommand {
  return state.kind === 'autopilot'
    ? { kind: 'autopilot' }
    : { kind: 'agent', objective: state.objective ?? '', mode: state.mode ?? 'diagnose' }
}

function normalizeTaskHistoryItem(item: AssistantTaskHistoryItem): AssistantTaskHistoryItem {
  const steps = Array.isArray(item.steps)
    ? item.steps.filter((step): step is AssistantTaskStep => Boolean(step)
      && typeof step.id === 'string'
      && typeof step.label === 'string'
      && ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(step.status))
      .map((step) => ({ ...step, message: typeof step.message === 'string' ? step.message : undefined }))
    : undefined
  return {
    ...item,
    ...(typeof item.progress === 'number' && Number.isFinite(item.progress) ? { progress: Math.max(0, Math.min(1, item.progress)) } : {}),
    ...(typeof item.activeStepId === 'string' ? { activeStepId: item.activeStepId } : {}),
    ...(steps?.length ? { steps } : {}),
  }
}

function taskSteps(command: AssistantAgentTaskCommand): AssistantTaskStep[] {
  const labels = command.kind === 'autopilot'
    ? [
        ['observe', '读取当前运行信号'],
        ['sample', '采集只读证据窗口'],
        ['analyze', '对比基线并分析劣化'],
        ['report', '汇总巡检结论'],
      ]
      : planAssistantSubtasks(command.objective, command.mode).map((subtask) => [subtask.id, subtask.label])
  return labels.map(([id, label]) => ({ id, label, status: 'queued' as const }))
}

function persistCurrentTask(state: AssistantTaskState, taskId = currentAssistantTask?.taskId ?? `assistant-task-${Date.now().toString(36)}`) {
  const previous = taskHistory.filter((item) => item.taskId !== taskId)
  taskHistory = [{ ...state, taskId }, ...previous].slice(0, MAX_TASK_HISTORY)
  persistTaskHistory()
  return taskId
}

let pendingAssistantAgentTask: AssistantAgentTaskCommand | null = null
let currentAssistantTask: AssistantTaskHistoryItem | null = null
let lastAssistantAgentTaskCommand: AssistantAgentTaskCommand | null = null
let taskStorageScope = ''
let serverTaskHistory: AssistantServerTaskHistoryItem[] = []

function ensureTaskScope() {
  const scopeKey = assistantScopedStorageKey(TASK_HISTORY_KEY)
  if (scopeKey === taskStorageScope) return
  taskStorageScope = scopeKey
  taskHistory = readPersistedTaskHistory()
  currentAssistantTask = taskHistory[0] ? { ...taskHistory[0] } : null
  lastAssistantAgentTaskCommand = currentAssistantTask ? taskCommandFromState(currentAssistantTask) : null
  pendingAssistantAgentTask = null
  serverTaskHistory = []

  // A browser refresh cannot resume a worker. Convert an interrupted task into
  // a retryable failure instead of leaving the assistant claiming it is running.
  if (currentAssistantTask && ['queued', 'running'].includes(currentAssistantTask.status)) {
    currentAssistantTask = { ...currentAssistantTask, status: 'failed', message: '页面已刷新，上一任务未完成，可要求 BT 重试。', updatedAt: new Date().toISOString() }
    persistCurrentTask(currentAssistantTask)
  }
}

/** 从服务端读取当前项目的 Agent 摘要；服务不可用时保持本地任务上下文。 */
export async function hydrateAssistantServerTaskHistory(factoryId?: string | null): Promise<AssistantServerTaskHistoryItem[]> {
  if (typeof window === 'undefined' || !factoryId || !window.localStorage.getItem('forgemind.token')) return serverTaskHistory
  try {
    const response = await fetch(`${SERVER_TASK_HISTORY_URL}?factory_id=${encodeURIComponent(factoryId)}`, {
      headers: { Authorization: `Bearer ${window.localStorage.getItem('forgemind.token') ?? ''}` },
    })
    if (!response.ok) throw new Error(`Agent 历史读取失败：${response.status}`)
    const runs = await response.json() as Array<Record<string, unknown>>
    serverTaskHistory = runs.filter((run) => typeof run.id === 'string' && typeof run.objective === 'string')
      .map((run) => ({
        taskId: String(run.id),
        objective: String(run.objective).slice(0, 700),
        mode: run.mode === 'plan_design' ? 'plan_design' as const : 'read_only' as const,
        status: typeof run.status === 'string' ? run.status : 'unknown',
        summary: typeof run.summary === 'string' ? run.summary.slice(0, 700) : '',
        updatedAt: typeof run.updated_at === 'string' ? run.updated_at : new Date().toISOString(),
      }))
      .slice(0, MAX_SERVER_TASK_HISTORY)
    return serverTaskHistory.map((item) => ({ ...item }))
  } catch {
    return serverTaskHistory
  }
}

export function readAssistantServerTaskHistory(): AssistantServerTaskHistoryItem[] {
  return serverTaskHistory.map((item) => ({ ...item }))
}

/**
 * Agent 任务可能在诊断工作区尚未挂载时到达，因此先保留一个待消费任务。
 * 这只是页面会话级队列，不是工厂事实，也不绕过后端任务审计。
 */
export function dispatchAssistantAgentTask(command: AssistantAgentTaskCommand) {
  ensureTaskScope()
  queueAssistantAgentTask(command)
  window.dispatchEvent(new CustomEvent('forgemind:assistant-agent-task', { detail: command }))
}

/** 页面刷新后由诊断面板显式恢复同一目标；不自动执行，避免越过用户意图。 */
export function resumeAssistantAgentTask(command: AssistantAgentTaskCommand) {
  ensureTaskScope()
  queueAssistantAgentTask(command)
}

function queueAssistantAgentTask(command: AssistantAgentTaskCommand) {
  pendingAssistantAgentTask = command
  lastAssistantAgentTaskCommand = command
  const taskId = `assistant-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  currentAssistantTask = {
    taskId,
    kind: command.kind,
    status: 'queued',
    ...(command.kind === 'agent' ? { objective: command.objective, mode: command.mode } : {}),
    message: command.kind === 'autopilot' ? '自动巡检等待诊断面板消费' : 'Agent 任务等待诊断面板消费',
    progress: 0,
    steps: taskSteps(command),
    updatedAt: new Date().toISOString(),
  }
  persistCurrentTask(currentAssistantTask, taskId)
}

export function retryAssistantAgentTask(): boolean {
  ensureTaskScope()
  if (!lastAssistantAgentTaskCommand || !currentAssistantTask || !['failed', 'cancelled'].includes(currentAssistantTask.status)) return false
  dispatchAssistantAgentTask(lastAssistantAgentTaskCommand)
  return true
}

export function cancelAssistantAgentTask(): boolean {
  ensureTaskScope()
  if (!currentAssistantTask || !['queued', 'running'].includes(currentAssistantTask.status)) return false
  pendingAssistantAgentTask = null
  window.dispatchEvent(new CustomEvent('forgemind:assistant-task-cancel'))
  currentAssistantTask = { ...currentAssistantTask, status: 'cancelled', message: '已请求取消 Agent 任务', updatedAt: new Date().toISOString() }
  persistCurrentTask(currentAssistantTask)
  window.dispatchEvent(new CustomEvent('forgemind:assistant-task-status', { detail: currentAssistantTask }))
  return true
}

export function consumeAssistantAgentTask(): AssistantAgentTaskCommand | null {
  ensureTaskScope()
  const command = pendingAssistantAgentTask
  pendingAssistantAgentTask = null
  return command
}

export function getAssistantTaskState(): AssistantTaskState | null {
  ensureTaskScope()
  return currentAssistantTask ? { ...currentAssistantTask } : null
}

export function isAssistantAgentTaskCancelled(): boolean {
  ensureTaskScope()
  return currentAssistantTask?.status === 'cancelled'
}

export function readAssistantTaskHistory(): AssistantTaskHistoryItem[] {
  ensureTaskScope()
  return taskHistory.map((item) => ({ ...item }))
}

export function updateAssistantTaskState(status: AssistantTaskState['status'], message: string, resultSummary?: string) {
  ensureTaskScope()
  if (!currentAssistantTask || !['queued', 'running'].includes(currentAssistantTask.status)) return
  const steps = currentAssistantTask.steps?.map((step) => ({
    ...step,
    status: status === 'completed' ? 'completed' : status === 'failed' ? (step.status === 'running' ? 'failed' : step.status) : status === 'cancelled' ? (step.status === 'running' ? 'cancelled' : step.status) : step.status,
  }))
  currentAssistantTask = {
    ...currentAssistantTask,
    status,
    message,
    ...(status === 'completed' ? { progress: 1, activeStepId: undefined } : {}),
    ...(steps ? { steps } : {}),
    ...(resultSummary ? { resultSummary } : {}),
    updatedAt: new Date().toISOString(),
  }
  persistCurrentTask(currentAssistantTask)
  window.dispatchEvent(new CustomEvent('forgemind:assistant-task-status', { detail: currentAssistantTask }))
}

export function updateAssistantTaskProgress(progress: number, activeStepId: string, message: string) {
  ensureTaskScope()
  if (!currentAssistantTask || !['queued', 'running'].includes(currentAssistantTask.status)) return
  const task = currentAssistantTask
  const bounded = Math.max(0, Math.min(1, progress))
  const steps = task.steps?.map((step) => {
    const activeIndex = task.steps?.findIndex((candidate) => candidate.id === activeStepId) ?? -1
    const stepIndex = task.steps?.findIndex((candidate) => candidate.id === step.id) ?? -1
    return {
      ...step,
      status: step.id === activeStepId ? 'running' as const : stepIndex >= 0 && stepIndex < activeIndex ? 'completed' as const : step.status,
      ...(step.id === activeStepId ? { message } : {}),
    }
  })
  currentAssistantTask = { ...task, status: 'running', message, progress: bounded, activeStepId, ...(steps ? { steps } : {}), updatedAt: new Date().toISOString() }
  persistCurrentTask(currentAssistantTask)
  window.dispatchEvent(new CustomEvent('forgemind:assistant-task-status', { detail: currentAssistantTask }))
}
