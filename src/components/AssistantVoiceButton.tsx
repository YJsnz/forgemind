import { useEffect, useRef, useState } from 'react'
import { animateIfAllowed } from '../utils/animeMotion'
import { AI_SERVICE_ENABLED } from '../game/api'
import { confirmAssistantAction, dispatchAssistantState, playBtSelfIntroPreset, requestAssistant } from '../game/assistantRuntime'
import type { AssistantToolCall } from '../game/assistantProtocol'
import { isBtSelfIntroRequest } from '../game/assistantVoicePreset'
import {
  ASSISTANT_WAKE_WORD,
  removeAssistantWakeWord,
  startAssistantTurnRecorder,
  startKeywordWakeListener,
  transcribeAssistantWav,
  type AssistantTurnRecorder,
  type KeywordWakeListener,
} from '../game/assistantVoice'

export function AssistantVoiceButton() {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [wakeEnabled, setWakeEnabled] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState<{ call: AssistantToolCall; summary: string } | null>(null)
  const recorderRef = useRef<AssistantTurnRecorder | null>(null)
  const wakeRef = useRef<KeywordWakeListener | null>(null)
  const recordingRef = useRef(false)
  const busyRef = useRef(false)
  const wakeTriggeredRef = useRef(false)
  const wakeAutoEnabledRef = useRef(true)
  const sessionActiveRef = useRef(false)
  const sessionEndsAtRef = useRef(0)
  const sessionTimerRef = useRef<number | null>(null)
  const controlsRef = useRef<HTMLDivElement>(null)

  const setBusyState = (next: boolean) => {
    busyRef.current = next
    setBusy(next)
  }

  const stopWake = async () => {
    const listener = wakeRef.current
    wakeRef.current = null
    setWakeEnabled(false)
    if (listener) await listener.stop()
  }

  const endContinuousSession = async () => {
    sessionActiveRef.current = false
    sessionEndsAtRef.current = 0
    setSessionActive(false)
    if (sessionTimerRef.current !== null) window.clearTimeout(sessionTimerRef.current)
    sessionTimerRef.current = null
    const recorder = recorderRef.current
    if (recorder && recordingRef.current) {
      recorderRef.current = null
      recordingRef.current = false
      setRecording(false)
      await recorder.cancel()
    }
    await rearmWake()
  }

  const beginContinuousSession = () => {
    sessionActiveRef.current = true
    sessionEndsAtRef.current = Date.now() + 30_000
    setSessionActive(true)
    if (sessionTimerRef.current !== null) window.clearTimeout(sessionTimerRef.current)
    sessionTimerRef.current = window.setTimeout(() => { void endContinuousSession() }, 30_000)
  }

  const startVoiceTurn = async (message = '连续会话：请继续说话，无需重复唤醒词') => {
    if (recordingRef.current || busyRef.current) return
    try {
      recorderRef.current = await startAssistantTurnRecorder({
        onState: (state) => {
          if (state === 'speaking') dispatchAssistantState({ phase: 'listening', message: '已听到语音，继续说完即可' })
          if (state === 'finishing') dispatchAssistantState({ phase: 'thinking', message: '正在结束本轮语音' })
        },
        onAutoStop: () => { void finishRecording() },
      })
      recordingRef.current = true
      setRecording(true)
      dispatchAssistantState({ phase: 'listening', message })
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
      await endContinuousSession()
    }
  }

  const finishRecording = async () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    setBusyState(true)
    let continueSession = false
    try {
      const recorder = recorderRef.current
      recorderRef.current = null
      if (!recorder) return
      const text = await transcribeAssistantWav(await recorder.stop())
      const result = isBtSelfIntroRequest(text)
        ? await playBtSelfIntroPreset(text)
        : await requestAssistant(text)
      continueSession = !result.pendingConfirmation
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
    } finally {
      setBusyState(false)
      if (continueSession && sessionActiveRef.current && Date.now() < sessionEndsAtRef.current) await startVoiceTurn()
      else {
        if (sessionActiveRef.current) await endContinuousSession()
        else await rearmWake()
      }
    }
  }

  const handleWake = async (transcript: string) => {
    if (wakeTriggeredRef.current || recordingRef.current || busyRef.current) return
    wakeTriggeredRef.current = true
    await stopWake()
    beginContinuousSession()
    const command = removeAssistantWakeWord(transcript)
    if (command) {
      setBusyState(true)
      dispatchAssistantState({ phase: 'thinking', message: '已唤醒，正在处理指令' })
      let continueSession = false
      try {
        const result = isBtSelfIntroRequest(command)
          ? await playBtSelfIntroPreset(transcript)
          : await requestAssistant(command)
        continueSession = !result.pendingConfirmation
      } catch (error) {
        dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
      } finally {
        setBusyState(false)
        if (continueSession && sessionActiveRef.current) await startVoiceTurn()
        else if (!continueSession) {
          dispatchAssistantState({ phase: 'idle', message: '等待确认或继续操作' })
          if (!sessionActiveRef.current) await rearmWake()
        }
      }
      return
    }
    await startVoiceTurn(`已唤醒，请说出指令；本轮结束后可直接继续追问`)
  }

  const enableWake = async () => {
    try {
      wakeTriggeredRef.current = false
      const listener = await startKeywordWakeListener((transcript) => handleWake(transcript))
      wakeRef.current = listener
      setWakeEnabled(true)
      dispatchAssistantState({ phase: 'idle', message: `等待唤醒词：${ASSISTANT_WAKE_WORD}` })
    } catch (error) {
      const message = readableVoiceError(error)
      dispatchAssistantState({
        phase: message === '麦克风权限未开启' ? 'idle' : 'error',
        message: message === '麦克风权限未开启' ? '请允许麦克风，关键字唤醒将自动开启' : message,
      })
    }
  }

  const toggleWake = async () => {
    if (recording || busy) return
    if (sessionActive) await endContinuousSession()
    if (wakeEnabled) {
      wakeAutoEnabledRef.current = false
      await stopWake()
      dispatchAssistantState({ phase: 'idle', message: '关键字唤醒已关闭' })
      return
    }
    wakeAutoEnabledRef.current = true
    await enableWake()
  }

  const rearmWake = async () => {
    if (!wakeAutoEnabledRef.current || wakeRef.current || recordingRef.current || busyRef.current || sessionActiveRef.current) return
    await enableWake()
  }

  const toggle = async () => {
    if (busy) return
    if (recording) {
      await finishRecording()
      return
    }

    try {
      beginContinuousSession()
      if (wakeEnabled) await stopWake()
      await startVoiceTurn('正在接收语音输入；停顿后自动提交')
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
    }
  }

  // 默认开启；浏览器首次访问麦克风时会先请求用户授权。
  useEffect(() => {
    if (!AI_SERVICE_ENABLED) {
      dispatchAssistantState({ phase: 'idle', message: '规则模式已启用；语音服务为可选项' })
      return
    }
    void enableWake()
    return () => {
      if (sessionTimerRef.current !== null) window.clearTimeout(sessionTimerRef.current)
      void recorderRef.current?.cancel()
      void wakeRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    const onConfirmation = (event: Event) => {
      const detail = (event as CustomEvent<{ call?: AssistantToolCall | null; summary?: string | null }>).detail
      if (detail?.call && detail.summary) setPendingConfirmation({ call: detail.call, summary: detail.summary })
      else setPendingConfirmation(null)
    }
    window.addEventListener('forgemind:assistant-confirmation', onConfirmation)
    return () => window.removeEventListener('forgemind:assistant-confirmation', onConfirmation)
  }, [])

  const confirmPending = async () => {
    if (!pendingConfirmation || busy) return
    setBusyState(true)
    try {
      await confirmAssistantAction(pendingConfirmation.call)
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
    } finally {
      setBusyState(false)
      setPendingConfirmation(null)
      if (sessionActiveRef.current && Date.now() < sessionEndsAtRef.current) await startVoiceTurn()
      else await rearmWake()
    }
  }

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls || (!recording && !wakeEnabled)) return
    const activeButton = controls.querySelector<HTMLElement>(recording ? '.fm-assistant-mic' : '.fm-assistant-wake')
    if (!activeButton) return
    const animation = animateIfAllowed(activeButton, {
      scale: [0.94, 1.06, 1],
      duration: 420,
      ease: 'out(3)',
    })
    return () => { animation?.cancel() }
  }, [recording, wakeEnabled, busy])

  return (
    <div ref={controlsRef} className="fm-assistant-controls">
      {pendingConfirmation && <div className="fm-assistant-confirm" role="alertdialog" aria-label="确认助手动作">
        <span>{pendingConfirmation.summary}</span>
        <button type="button" onClick={() => void confirmPending()} disabled={busy}>确认</button>
        <button type="button" onClick={() => setPendingConfirmation(null)} disabled={busy}>取消</button>
      </div>}
      {sessionActive && <button className="fm-assistant-session-stop" type="button" onClick={() => void endContinuousSession()} disabled={busy} title="结束本次连续语音会话">结束</button>}
      <button
        className={`fm-assistant-mic ${recording ? 'is-recording' : ''} ${busy ? 'is-busy' : ''}`}
        type="button"
        onClick={() => void toggle()}
        disabled={!AI_SERVICE_ENABLED}
        aria-label={recording ? '结束语音输入' : '开始语音输入'}
        title={!AI_SERVICE_ENABLED ? '使用 -IncludeAI 启动可选语音服务' : recording ? '结束语音输入' : '开始语音输入'}
      >
        <span>{recording ? '■' : '◉'}</span>
        <small>{recording ? '结束' : '语音'}</small>
      </button>
      <button
        className={`fm-assistant-wake ${wakeEnabled ? 'is-enabled' : ''} ${busy ? 'is-busy' : ''}`}
        type="button"
        onClick={() => void toggleWake()}
        disabled={!AI_SERVICE_ENABLED}
        aria-label={wakeEnabled ? `关闭${ASSISTANT_WAKE_WORD}关键字唤醒` : `开启${ASSISTANT_WAKE_WORD}关键字唤醒`}
        title={!AI_SERVICE_ENABLED ? '使用 -IncludeAI 启动可选语音服务' : wakeEnabled ? `关闭${ASSISTANT_WAKE_WORD}关键字唤醒` : `开启${ASSISTANT_WAKE_WORD}关键字唤醒`}
      >
        <span>⌁</span>
        <small>{wakeEnabled ? '已启用' : '唤醒'}</small>
      </button>
    </div>
  )
}

function readableVoiceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  if (raw.includes('404')) return '语音服务未启动'
  if (raw.includes('权限') || raw.includes('denied') || raw.includes('NotAllowed')) return '麦克风权限未开启'
  if (raw.includes('没有识别')) return '没有听清，请再说一次'
  return raw || '语音输入失败'
}
