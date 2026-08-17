import { requestAssistant, dispatchAssistantState, type AssistantRequestResult } from './assistantRuntime'

const AI_ASR_URL = 'http://127.0.0.1:8000/api/ai/asr'
const TARGET_SAMPLE_RATE = 16000

interface AssistantRecorder {
  stop: () => Promise<Blob>
}

export async function startAssistantRecorder(): Promise<AssistantRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持麦克风访问。')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const sink = audioContext.createGain()
  const chunks: Float32Array[] = []
  sink.gain.value = 0
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  source.connect(processor)
  processor.connect(sink)
  sink.connect(audioContext.destination)

  const sourceSampleRate = audioContext.sampleRate
  return {
    stop: async () => {
      processor.onaudioprocess = null
      source.disconnect()
      processor.disconnect()
      sink.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      await audioContext.close()
      return encodeWav(resample(chunks.flatMap((chunk) => Array.from(chunk)), sourceSampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE)
    },
  }
}

export async function askFromMicrophone(): Promise<AssistantRequestResult> {
  dispatchAssistantState({ phase: 'listening', message: '正在接收语音输入' })
  const recorder = await startAssistantRecorder()
  // The caller controls when stop() is invoked through the button component.
  return requestAssistantFromRecorder(recorder)
}

export async function transcribeAssistantWav(audio: Blob): Promise<string> {
  dispatchAssistantState({ phase: 'thinking', message: '正在识别语音' })
  const response = await fetch(AI_ASR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: audio,
  })
  if (!response.ok) throw new Error(`本地 ASR 返回 ${response.status}`)
  const result = (await response.json()) as { text?: string }
  const text = result.text?.trim() ?? ''
  if (!text) throw new Error('没有识别到清晰语音。')
  return text
}

export async function requestAssistantFromRecorder(recorder: AssistantRecorder): Promise<AssistantRequestResult> {
  const audio = await recorder.stop()
  const text = await transcribeAssistantWav(audio)
  return requestAssistant(text)
}

function resample(samples: number[], fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return Float32Array.from(samples)
  const targetLength = Math.max(1, Math.round(samples.length * toRate / fromRate))
  const result = new Float32Array(targetLength)
  const ratio = (samples.length - 1) / Math.max(1, targetLength - 1)
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(samples.length - 1, left + 1)
    const amount = position - left
    result[index] = (samples[left] ?? 0) * (1 - amount) + (samples[right] ?? 0) * amount
  }
  return result
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}
