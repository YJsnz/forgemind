import { BACKEND_BASE } from './backendBase'

export interface AssistantMetricInput {
  provider: 'rule' | 'llm' | 'ollama' | 'deepseek' | 'fallback' | 'stub'
  firstTokenMs: number
  completeMs: number
  toolCall: boolean
  toolSuccess: boolean
  fallback: boolean
}

/** 只上传助手链路元数据，不上传问题、对象、库存或仿真内容。 */
export function recordAssistantMetric(input: AssistantMetricInput): void {
  const token = localStorage.getItem('forgemind.token')
  if (!token) return
  void fetch(`${BACKEND_BASE}/api/assistant/metrics`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => undefined)
}
