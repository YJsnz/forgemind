export interface AssistantVisionDetection {
  className: string
  confidence: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface AssistantVisionSnapshot {
  source: 'yolo' | 'vision'
  partId: string
  status: 'ready' | 'offline' | 'error'
  verdict: 'pass' | 'fail' | 'unknown'
  detections: AssistantVisionDetection[]
  confidence: number
  inferenceMs: number
  capturedAt: string
  frameId?: string
  frameAvailable?: boolean
  frameCapturedAt?: string
}

export const VISION_RESULT_KEY = 'forgemind.assistant-vision-latest.v1'
export const VISION_FRAME_KEY = 'forgemind.assistant-vision-frame.v1'

export interface AssistantVisionFrame {
  frameId: string
  dataUrl: string
  capturedAt: string
}

export function readAssistantVisionSnapshot(): AssistantVisionSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(VISION_RESULT_KEY) ?? 'null') as Partial<AssistantVisionSnapshot> | null
    if (!value || !Array.isArray(value.detections) || typeof value.capturedAt !== 'string') return null
    return {
      source: value.source === 'vision' ? 'vision' : 'yolo',
      partId: typeof value.partId === 'string' ? value.partId.slice(0, 80) : 'unknown',
      status: value.status === 'offline' || value.status === 'error' ? value.status : 'ready',
      verdict: value.verdict === 'pass' || value.verdict === 'fail' ? value.verdict : 'unknown',
      detections: value.detections.filter((item): item is AssistantVisionDetection => Boolean(item) && typeof item.className === 'string' && typeof item.confidence === 'number').slice(0, 32),
      confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0,
      inferenceMs: typeof value.inferenceMs === 'number' ? Math.max(0, value.inferenceMs) : 0,
      capturedAt: value.capturedAt,
      frameId: typeof value.frameId === 'string' ? value.frameId.slice(0, 120) : undefined,
      frameAvailable: value.frameAvailable === true,
      frameCapturedAt: typeof value.frameCapturedAt === 'string' ? value.frameCapturedAt : undefined,
    }
  } catch {
    return null
  }
}

export function readAssistantVisionFrame(): AssistantVisionFrame | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(VISION_FRAME_KEY) ?? 'null') as Partial<AssistantVisionFrame> | null
    if (!value || typeof value.frameId !== 'string' || typeof value.dataUrl !== 'string' || typeof value.capturedAt !== 'string') return null
    if (!value.dataUrl.startsWith('data:image/')) return null
    return { frameId: value.frameId.slice(0, 120), dataUrl: value.dataUrl, capturedAt: value.capturedAt }
  } catch {
    return null
  }
}

/** Stores a small same-origin preview for the inspection panel; it is not sent to Qwen. */
export function writeAssistantVisionFrame(frame: AssistantVisionFrame): boolean {
  if (typeof window === 'undefined' || !frame.dataUrl.startsWith('data:image/')) return false
  try {
    if (frame.dataUrl.length > 260_000) return false
    window.localStorage.setItem(VISION_FRAME_KEY, JSON.stringify(frame))
    return true
  } catch { /* optional bridge */ return false }
}

export function assistantVisionSignature(snapshot: AssistantVisionSnapshot): string {
  const classes = [...new Set(snapshot.detections.map((detection) => detection.className))].sort().join(',')
  return `${snapshot.partId}:${snapshot.verdict}:${classes}`
}

export function writeAssistantVisionSnapshot(snapshot: AssistantVisionSnapshot): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(VISION_RESULT_KEY, JSON.stringify(snapshot)) } catch { /* optional bridge */ }
  window.dispatchEvent(new CustomEvent('forgemind:assistant-vision', { detail: snapshot }))
}
