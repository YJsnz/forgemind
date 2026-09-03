/**
 * 巡检语音提醒 —— 把一轮巡检结果压缩成一句可朗读的中文警报。
 *
 * - buildPatrolAlert：纯函数，确定性文本，可测试
 * - speakPatrolAlert：优先可选 AI 服务的 TTS，失败或未启用时回退浏览器
 *   speechSynthesis；两条路径都失败就静默跳过，绝不阻塞巡检循环
 * LLM/TTS 只负责「读出已确定的结论」，不产生新事实。
 */
import { AI_SERVICE_ENABLED, AI_BASE } from './api'
import type { AutopilotCycleResult } from './factoryAutopilot'

export function buildPatrolAlert(result: AutopilotCycleResult): string {
  const parts: string[] = []
  parts.push(result.degraded ? '自动巡检警报。' : '自动巡检完成。')
  parts.push(`吞吐 ${result.metrics.throughputPerHour.toFixed(1)} 件每小时，利用率 ${result.metrics.utilization.toFixed(0)}%。`)
  if (result.degraded) parts.push('检测到运行劣化，请进入方案设计处理。')
  if (result.bottleneck?.primary) parts.push(`首要瓶颈 ${result.bottleneck.primary}。`)
  for (const forecast of result.stockForecasts) {
    if (forecast.empty) parts.push(`货架 ${forecast.rackId} 已耗尽。`)
    else if (forecast.etaEmptySec !== null) parts.push(`货架 ${forecast.rackId} 预计 ${formatEtaShort(forecast.etaEmptySec)}后耗尽。`)
  }
  const waster = result.energy?.topIdleWaster
  if (waster) parts.push(`${waster.displayName} 待机能耗偏高。`)
  return parts.join('')
}

function formatEtaShort(etaSec: number): string {
  if (etaSec < 90) return `${etaSec}秒`
  return `${Math.round(etaSec / 60)}分钟`
}

/** 语音去重：同一警报内容只播报一次，由调用方保存上次文本。 */
export function shouldSpeakAgain(lastSpoken: string | null, alert: string): boolean {
  return alert.length > 0 && alert !== lastSpoken
}

export async function speakPatrolAlert(text: string): Promise<'ai' | 'browser' | 'skipped'> {
  const trimmed = text.trim()
  if (!trimmed) return 'skipped'
  if (AI_SERVICE_ENABLED) {
    try {
      const response = await fetch(`${AI_BASE}/api/ai/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      if (response.ok) {
        const audio = new Audio(URL.createObjectURL(await response.blob()))
        await audio.play()
        return 'ai'
      }
    } catch {
      // 落到浏览器合成
    }
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      const utterance = new SpeechSynthesisUtterance(trimmed)
      utterance.lang = 'zh-CN'
      utterance.rate = 1.05
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      return 'browser'
    } catch {
      return 'skipped'
    }
  }
  return 'skipped'
}
