import { useEffect } from 'react'
import { dispatchAssistantNotice, dispatchAssistantState, requestAssistant, speakAssistantText, warmAssistantVoicePresets } from '../game/assistantRuntime'
import { AI_SERVICE_ENABLED } from '../game/api'
import { dispatchAssistantPanelCommand } from '../game/assistantPanels'
import type { AssistantPanelId } from '../game/assistantProtocol'
import { hydrateAssistantReminderPolicy } from '../game/assistantReminderPolicy'
import { hydrateAssistantMemory } from '../game/assistantMemory'
import { assistantVisionSignature, readAssistantVisionSnapshot, VISION_RESULT_KEY } from '../game/assistantVision'

/**
 * 统一接入桥：文字面板、浏览器麦克风和独立 voice-chat 都可以派发同一事件。
 *
 * window.dispatchEvent(new CustomEvent('forgemind:assistant-request', {
 *   detail: { question: '现在工厂运行情况怎么样？' }
 * }))
 */
export function AssistantRuntime() {
  useEffect(() => {
    if (AI_SERVICE_ENABLED) void warmAssistantVoicePresets()
    if (window.localStorage.getItem('forgemind.token')) {
      void hydrateAssistantReminderPolicy()
      void hydrateAssistantMemory()
    }
  }, [])

  useEffect(() => {
    let noticeTimer: number | null = null
    let lastVisionFingerprint = ''
    const onRequest = (event: Event) => {
      const question = (event as CustomEvent<{ question?: string }>).detail?.question
      if (typeof question === 'string' && question.trim()) void requestAssistant(question)
    }
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; openPanel?: AssistantPanelId; speak?: boolean }>).detail
      if (!detail?.message?.trim()) return
      dispatchAssistantState({ phase: 'speaking', message: detail.message.trim().slice(0, 160) })
      if (detail.openPanel) dispatchAssistantPanelCommand({ action: 'open_panel', panelId: detail.openPanel })
      if (detail.speak && AI_SERVICE_ENABLED) void speakAssistantText(detail.message).catch(() => undefined)
      if (noticeTimer !== null) window.clearTimeout(noticeTimer)
      noticeTimer = window.setTimeout(() => {
        dispatchAssistantState({ phase: 'idle', message: '等待驾驶员指令' })
        noticeTimer = null
      }, 9000)
    }
    const onVisionSnapshot = () => {
      const snapshot = readAssistantVisionSnapshot()
      if (!snapshot || snapshot.status !== 'ready' || snapshot.verdict !== 'fail' || snapshot.detections.length === 0) {
        if (snapshot?.verdict === 'pass') lastVisionFingerprint = ''
        return
      }
      const classes = [...new Set(snapshot.detections.map((detection) => detection.className))].sort().join(',')
      const fingerprint = assistantVisionSignature(snapshot)
      if (fingerprint === lastVisionFingerprint) return
      lastVisionFingerprint = fingerprint
      void dispatchAssistantNotice({
        message: `视觉检测发现 ${snapshot.detections.length} 个缺陷（${classes}），置信度最高 ${(snapshot.confidence * 100).toFixed(0)}%${snapshot.frameAvailable ? '，当前帧已同步到检测面板' : ''}。`,
        severity: 'warning',
        openPanel: 'inspection',
        dedupeKey: `vision:${fingerprint}`,
        source: 'vision:yolo',
      })
    }
    const onVisionStorage = (event: StorageEvent) => { if (event.key === VISION_RESULT_KEY) onVisionSnapshot() }
    const onVisionEvent = () => onVisionSnapshot()
    window.addEventListener('forgemind:assistant-request', onRequest)
    window.addEventListener('forgemind:assistant-notice', onNotice)
    window.addEventListener('storage', onVisionStorage)
    window.addEventListener('forgemind:assistant-vision', onVisionEvent)
    return () => {
      window.removeEventListener('forgemind:assistant-request', onRequest)
      window.removeEventListener('forgemind:assistant-notice', onNotice)
      window.removeEventListener('storage', onVisionStorage)
      window.removeEventListener('forgemind:assistant-vision', onVisionEvent)
      if (noticeTimer !== null) window.clearTimeout(noticeTimer)
    }
  }, [])

  return null
}
