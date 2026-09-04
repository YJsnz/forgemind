import { streamAssistant, type AssistantReply } from './api'
import { executeAssistantToolCall, getCurrentFactoryAssistantContext, type AssistantExecutionResult } from './assistantExecutor'
import type { AssistantPanelId, AssistantToolCall } from './assistantProtocol'
import { getAssistantTaskState, hydrateAssistantServerTaskHistory, readAssistantServerTaskHistory, readAssistantTaskHistory } from './assistantTasks'
import { hydrateAssistantMemory, readAssistantMemory } from './assistantMemory'
import { readAssistantProjectMemory } from './assistantProjectMemory'
import { isAssistantReminderQuiet, readAssistantReminderPolicy, reminderSeverityAllowed } from './assistantReminderPolicy'
import { hydrateAssistantProactiveEvents, recordAssistantProactiveEvent, resolveAssistantProactiveEvent } from './assistantProactiveEvents'
import { assistantScopedStorageKey } from './assistantStorage'
import { recordAssistantMetric } from '../api/assistantMetrics'
import { clearAssistantConversationSummary, readAssistantConversationSummary, writeAssistantConversationSummary, type AssistantConversationTurn } from './assistantConversation'
import { readAssistantCloudSettings } from './assistantCloudSettings'
import { hydrateAssistantKnowledge, readAssistantKnowledge } from './assistantKnowledge'

const AI_TTS_URL = 'http://127.0.0.1:8000/api/ai/tts'
const ASSISTANT_HISTORY_KEY = 'forgemind.assistant-history.v1'
const ASSISTANT_NOTICE_MEMORY_KEY = 'forgemind.assistant-notices.v1'
const MAX_HISTORY_TURNS = 12

export interface AssistantUiContext {
  route?: string
  view?: string
  panel?: string | null
  floorId?: number
  selectedObjectId?: string | null
  selectedObjectLabel?: string | null
  projectId?: string | null
  projectName?: string | null
  projectVersion?: number | null
}

let assistantUiContext: AssistantUiContext = {}

export interface AssistantRequestResult {
  answer: string
  execution: AssistantExecutionResult | null
  pendingConfirmation: AssistantToolCall | null
}

export function dispatchAssistantState(detail: {
  phase: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
  message?: string
  level?: number
}) {
  window.dispatchEvent(new CustomEvent('forgemind:assistant-state', { detail }))
}

export async function dispatchAssistantNotice(detail: {
  message: string
  severity?: 'info' | 'warning' | 'critical'
  openPanel?: AssistantPanelId
  dedupeKey?: string
  cooldownMs?: number
  source?: string
}) {
  const severity = detail.severity ?? 'info'
  const policy = readAssistantReminderPolicy()
  if (!reminderSeverityAllowed(policy, severity) || (severity !== 'critical' && isAssistantReminderQuiet(policy))) return
  const dedupeKey = detail.dedupeKey ?? detail.message.trim().slice(0, 160)
  const cooldownMs = detail.cooldownMs ?? policy.cooldownMinutes * 60 * 1000
  const aggregate = recordAssistantProactiveEvent({ fingerprint: dedupeKey, source: detail.source ?? 'assistant', severity, message: detail.message })
  const notice = aggregate && aggregate.sources.length > 1
    ? { ...detail, message: `多来源信号（${aggregate.sources.join('、')}）：${detail.message}`, speak: severity !== 'info' }
    : { ...detail, speak: severity !== 'info' }
  const token = window.localStorage.getItem('forgemind.token')
  if (token) {
    try {
      const remote = await claimRemoteAssistantReminder({ ...detail, severity, dedupeKey, cooldownMs })
      if (!remote.emit) return
      markLocalAssistantNotice(dedupeKey, severity, cooldownMs)
      window.dispatchEvent(new CustomEvent('forgemind:assistant-notice', { detail: notice }))
      return
    } catch {
      // Continue with local/session dedupe when the backend is offline.
    }
  }
  if (!markLocalAssistantNotice(dedupeKey, severity, cooldownMs)) return
  window.dispatchEvent(new CustomEvent('forgemind:assistant-notice', { detail: notice }))
}

export async function resolveAssistantNotice(dedupeKey: string): Promise<boolean> {
  const key = dedupeKey.trim()
  const localResolved = resolveAssistantProactiveEvent(key)
  const token = window.localStorage.getItem('forgemind.token')
  if (!key || !token) return localResolved
  try {
    const response = await fetch('http://127.0.0.1:8080/api/assistant/reminders/resolve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dedupeKey: key }),
    })
    if (!response.ok) return false
    const result = await response.json() as { resolved?: boolean }
    return result.resolved === true || localResolved
  } catch {
    return localResolved
  }
}

function markLocalAssistantNotice(dedupeKey: string, severity: 'info' | 'warning' | 'critical', cooldownMs: number): boolean {
  const now = Date.now()
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(assistantScopedStorageKey(ASSISTANT_NOTICE_MEMORY_KEY)) ?? '{}') as Record<string, { at?: number; severity?: string }>
    const previous = parsed[dedupeKey]
    const rank = { info: 1, warning: 2, critical: 3 } as const
    const escalated = previous?.severity && rank[severity] > (rank[previous.severity as keyof typeof rank] ?? 0)
    if (previous?.at && now - previous.at < cooldownMs && !escalated) return false
    const next = Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item?.at === 'number' && now - item.at < 24 * 60 * 60 * 1000))
    next[dedupeKey] = { at: now, severity }
    window.sessionStorage.setItem(assistantScopedStorageKey(ASSISTANT_NOTICE_MEMORY_KEY), JSON.stringify(next))
  } catch {
    // Storage 不可用时不阻塞主动提醒，允许本次事件继续发送。
  }
  return true
}

async function claimRemoteAssistantReminder(detail: { message: string; severity: 'info' | 'warning' | 'critical'; dedupeKey: string; cooldownMs: number }): Promise<{ emit: boolean }> {
  const response = await fetch('http://127.0.0.1:8080/api/assistant/reminders/claim', {
    method: 'POST',
    headers: { Authorization: `Bearer ${window.localStorage.getItem('forgemind.token') ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(detail),
  })
  if (!response.ok) throw new Error(`提醒去重服务返回 ${response.status}`)
  return await response.json() as { emit: boolean }
}

export function clearAssistantConversation() {
  window.sessionStorage.removeItem(assistantScopedStorageKey(ASSISTANT_HISTORY_KEY))
  clearAssistantConversationSummary()
}

export function setAssistantUiContext(next: AssistantUiContext) {
  assistantUiContext = { ...next }
}

function readAssistantConversation(): AssistantConversationTurn[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(assistantScopedStorageKey(ASSISTANT_HISTORY_KEY)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((turn): turn is AssistantConversationTurn =>
      Boolean(turn)
      && (turn.role === 'user' || turn.role === 'assistant')
      && typeof turn.content === 'string'
      && turn.content.trim().length > 0,
    ).slice(-MAX_HISTORY_TURNS)
  } catch {
    return []
  }
}

function writeAssistantConversation(turns: AssistantConversationTurn[]) {
  const bounded = turns.slice(-MAX_HISTORY_TURNS)
  window.sessionStorage.setItem(assistantScopedStorageKey(ASSISTANT_HISTORY_KEY), JSON.stringify(bounded))
  writeAssistantConversationSummary(turns, readAssistantConversationSummary())
}

export async function requestAssistant(question: string): Promise<AssistantRequestResult> {
  const prompt = question.trim()
  if (!prompt) throw new Error('请输入要交给智能管家的问题。')

  const startedAt = performance.now()
  let firstTokenAt: number | null = null
  let serviceFallback = false
  dispatchAssistantState({ phase: 'thinking', message: '正在读取工厂信号' })
  try {
    const conversation = readAssistantConversation()
    const cloudSettings = readAssistantCloudSettings()
    await hydrateAssistantMemory()
    await hydrateAssistantKnowledge()
    await hydrateAssistantProactiveEvents()
    await hydrateAssistantServerTaskHistory(assistantUiContext.projectId)
    const context = getCurrentFactoryAssistantContext()
    const requestContext = {
      ...context,
      conversation: cloudSettings.contextEnabled ? conversation : [],
      conversationSummary: cloudSettings.contextEnabled ? readAssistantConversationSummary() : '',
      ui: assistantUiContext,
      task: cloudSettings.contextEnabled ? getAssistantTaskState() : null,
      taskHistory: cloudSettings.contextEnabled ? readAssistantTaskHistory() : [],
      serverTaskHistory: cloudSettings.contextEnabled ? readAssistantServerTaskHistory() : [],
      projectMemory: cloudSettings.contextEnabled && cloudSettings.projectMemoryEnabled ? readAssistantProjectMemory(assistantUiContext.projectId) : { projectId: assistantUiContext.projectId ?? null, versions: [], runs: [] },
      userMemory: cloudSettings.contextEnabled && cloudSettings.userMemoryEnabled ? readAssistantMemory() : {},
      knowledgeDocuments: cloudSettings.ragEnabled ? readAssistantKnowledge() : [],
      assistantCloudSettings: cloudSettings,
    }
    const speech = createSpeechQueue()
    let streamedText = ''
    let speechBuffer = ''
    let reply: AssistantReply
    try {
      reply = await streamAssistant(
        prompt,
        requestContext as unknown as Record<string, unknown>,
        (delta) => {
          if (firstTokenAt === null) firstTokenAt = performance.now()
          streamedText += delta
          speechBuffer += delta
          dispatchAssistantState({ phase: 'speaking', message: streamedText.trim().slice(-54) })
          const extracted = extractSpeechFragments(speechBuffer)
          speechBuffer = extracted.remainder
          extracted.fragments.forEach((fragment) => speech.enqueue(fragment))
        },
      )
    } catch {
      serviceFallback = true
      reply = createBuiltInRuleReply(prompt)
      dispatchAssistantState({ phase: 'speaking', message: reply.answer })
    }
    let execution: AssistantExecutionResult | null = null
    let pendingConfirmation: AssistantToolCall | null = null

    if (reply.action && reply.validated) {
      execution = executeAssistantToolCall(reply.action)
      if (execution.status === 'awaiting_confirmation') pendingConfirmation = execution.call
    } else if (reply.action && !reply.validated) {
      execution = { status: 'rejected', answer: reply.note || '动作未通过安全校验。' }
    }

    const answer = execution?.answer ?? reply.answer
    window.dispatchEvent(new CustomEvent('forgemind:assistant-evidence', {
      detail: { evidence: reply.evidence ?? [], answer },
    }))
    if (execution?.status === 'awaiting_confirmation') {
      window.dispatchEvent(new CustomEvent('forgemind:assistant-confirmation', {
        detail: { call: pendingConfirmation, summary: execution.summary },
      }))
    }
    writeAssistantConversation([
      ...conversation,
      { role: 'user', content: prompt.slice(0, 700) },
      { role: 'assistant', content: answer.slice(0, 700) },
    ])
    if (execution) {
      speechBuffer = ''
      speech.enqueue(answer)
    } else if (streamedText.trim()) {
      const tail = speechBuffer.trim()
      if (tail) speech.enqueue(tail)
    } else {
      speech.enqueue(answer)
    }
    recordAssistantMetric({
      provider: reply.source,
      firstTokenMs: Math.max(0, Math.round((firstTokenAt ?? performance.now()) - startedAt)),
      completeMs: Math.max(0, Math.round(performance.now() - startedAt)),
      toolCall: Boolean(reply.action),
      toolSuccess: execution?.status === 'executed',
      fallback: serviceFallback || reply.source === 'fallback',
    })
    await speech.finish()
    return { answer, execution, pendingConfirmation }
  } catch (error) {
    const message = error instanceof Error ? error.message : '智能助手暂不可用。'
    dispatchAssistantState({ phase: 'error', message })
    throw error
  }
}

function createBuiltInRuleReply(question: string): AssistantReply {
  const normalized = question.toLowerCase().replace(/\s+/gu, '')
  let action: AssistantToolCall | null = null

  if (['重置仿真', '重新开始', '清空进度'].some((word) => normalized.includes(word))) {
    action = { protocolVersion: '1.0.0', name: 'reset_simulation', arguments: {} }
  } else {
    const speedMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:倍|x)/u)
    if (speedMatch && ['倍率', '倍速', '速度', '调到', '设置'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'set_simulation_speed', arguments: { speed: Number(speedMatch[1]) } }
    } else if (['暂停仿真', '停止仿真', '暂停生产'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'set_simulation_running', arguments: { running: false } }
    } else if (['启动仿真', '开始仿真', '开始生产', '继续仿真'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'set_simulation_running', arguments: { running: true } }
    } else if (['工厂状态', '运行情况', '生产情况', '累计产出', '在途物料'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'query_factory_status', arguments: {} }
    }
  }

  const validSpeed = action?.name !== 'set_simulation_speed' || (action.arguments.speed >= 0.1 && action.arguments.speed <= 4)
  return {
    answer: action ? '规则助手已识别工厂操作。' : '规则助手已就绪。可查询工厂状态、启停仿真、调整倍率或发起重置确认。',
    source: 'rule',
    note: '浏览器规则模式，不需要本地部署大语言模型。',
    protocolVersion: '1.0.0',
    action,
    validated: Boolean(action && validSpeed),
    requiresConfirmation: action?.name === 'reset_simulation',
  }
}

export async function confirmAssistantAction(call: AssistantToolCall): Promise<AssistantExecutionResult> {
  const execution = executeAssistantToolCall(call, { confirmed: true })
  window.dispatchEvent(new CustomEvent('forgemind:assistant-confirmation', { detail: { call: null, summary: null } }))
  await speakAssistantText(execution.status === 'executed' ? execution.answer : execution.answer)
  return execution
}

export async function speakAssistantText(text: string) {
  if (!text.trim()) {
    dispatchAssistantState({ phase: 'idle', message: '等待驾驶员指令' })
    return
  }

  const speech = createSpeechQueue()
  speech.enqueue(text)
  await speech.finish()
}

async function synthesizeAssistantAudio(text: string): Promise<HTMLAudioElement> {
  const response = await fetch(AI_TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) throw new Error(`BT TTS 返回 ${response.status}`)
  const audio = new Audio(URL.createObjectURL(await response.blob()))
  audio.preload = 'auto'
  return audio
}

function createSpeechQueue() {
  let playback = Promise.resolve()
  let failed = false
  return {
    enqueue(text: string) {
      const fragment = text.trim()
      if (!fragment) return
      // 合成请求立即发出；播放仍按入队顺序进行，实现 LLM、TTS、播放三段并行。
      const audioResult = synthesizeAssistantAudio(fragment).then(
        (audio) => ({ audio, error: null as unknown }),
        (error: unknown) => ({ audio: null, error }),
      )
      playback = playback.then(async () => {
        const result = await audioResult
        if (!result.audio) {
          failed = true
          return
        }
        await playSerialized(result.audio, fragment)
      }).catch(() => { failed = true })
    },
    async finish() {
      await playback
      dispatchAssistantState({
        phase: 'idle',
        message: failed ? '文字回复已就绪，语音服务未连接' : '等待驾驶员指令',
      })
    },
  }
}

let serializedSpeech: Promise<void> = Promise.resolve()

/** 所有回答和主动提醒共用播放锁，避免两条 BT 语音同时输出。 */
function playSerialized(audio: HTMLAudioElement, message: string): Promise<void> {
  const next = serializedSpeech.then(() => playWithMeter(audio, message))
  serializedSpeech = next.catch(() => undefined)
  return next
}

function extractSpeechFragments(buffer: string): { fragments: string[]; remainder: string } {
  const fragments: string[] = []
  let remainder = buffer
  const targetLength = 14
  const maxLength = 18
  while (true) {
    // 标点优先；没有标点时按短语长度切分，让 TTS 在模型继续生成时立即开始。
    const punctuation = /[，。！？!?；]/.exec(remainder)
    let end = -1
    if (punctuation && punctuation.index !== undefined && punctuation.index < maxLength) {
      end = punctuation.index + punctuation[0].length
    } else if (remainder.length >= targetLength) {
      const window = remainder.slice(0, maxLength)
      const boundaries = [...window.matchAll(/[、，,；;：:]/g)]
      const boundary = boundaries[boundaries.length - 1]
      end = boundary && boundary.index !== undefined && boundary.index >= 6
        ? boundary.index + boundary[0].length
        : targetLength
    }
    if (end < 0) break
    const fragment = remainder.slice(0, end).trim()
    remainder = remainder.slice(end)
    if (fragment) fragments.push(fragment)
  }
  return { fragments, remainder }
}

async function playWithMeter(audio: HTMLAudioElement, message: string): Promise<void> {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) {
    dispatchAssistantState({ phase: 'speaking', message })
    await playAudio(audio)
    URL.revokeObjectURL(audio.src)
    return
  }

  const audioContext = new AudioContextCtor()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 128
  const source = audioContext.createMediaElementSource(audio)
  source.connect(analyser)
  analyser.connect(audioContext.destination)
  const samples = new Uint8Array(analyser.frequencyBinCount)
  let frame = 0
  const sample = () => {
    analyser.getByteFrequencyData(samples)
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length / 255
    window.dispatchEvent(new CustomEvent('forgemind:assistant-audio-level', { detail: { level: average } }))
    frame = requestAnimationFrame(sample)
  }

  dispatchAssistantState({ phase: 'speaking', message })
  try {
    await audioContext.resume()
    sample()
    await playAudio(audio)
  } finally {
    cancelAnimationFrame(frame)
    source.disconnect()
    analyser.disconnect()
    await audioContext.close()
    URL.revokeObjectURL(audio.src)
  }
}

function playAudio(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEnded = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); reject(new Error('BT TTS 音频播放失败')) }
    const cleanup = () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.play().catch((error) => { cleanup(); reject(error) })
  })
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
