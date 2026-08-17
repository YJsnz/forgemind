import { useRef, useState } from 'react'
import { dispatchAssistantState, requestAssistant } from '../game/assistantRuntime'
import { startAssistantRecorder, transcribeAssistantWav } from '../game/assistantVoice'

interface RecorderHandle {
  stop: () => Promise<Blob>
}

export function AssistantVoiceButton() {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const recorderRef = useRef<RecorderHandle | null>(null)

  const toggle = async () => {
    if (busy) return
    if (recording) {
      setRecording(false)
      setBusy(true)
      try {
        const recorder = recorderRef.current
        recorderRef.current = null
        if (!recorder) return
        const text = await transcribeAssistantWav(await recorder.stop())
        await requestAssistant(text)
      } catch (error) {
        dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
      } finally {
        setBusy(false)
      }
      return
    }

    try {
      recorderRef.current = await startAssistantRecorder()
      setRecording(true)
      dispatchAssistantState({ phase: 'listening', message: '正在接收语音输入' })
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
    }
  }

  return (
    <button
      className={`fm-assistant-mic ${recording ? 'is-recording' : ''} ${busy ? 'is-busy' : ''}`}
      type="button"
      onClick={() => void toggle()}
      aria-label={recording ? '结束语音输入' : '开始语音输入'}
      title={recording ? '结束语音输入' : '开始语音输入'}
    >
      <span>{recording ? '■' : '◉'}</span>
      <small>{recording ? '结束' : '语音'}</small>
    </button>
  )
}

function readableVoiceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  if (raw.includes('404')) return '语音服务未启动'
  if (raw.includes('权限') || raw.includes('denied') || raw.includes('NotAllowed')) return '麦克风权限未开启'
  if (raw.includes('没有识别')) return '没有听清，请再说一次'
  return raw || '语音输入失败'
}
