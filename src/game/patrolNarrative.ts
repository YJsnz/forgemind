/**
 * 自动巡检叙述层 —— 把一轮巡检结果整理成中文报告。
 *
 * - buildPatrolReport：确定性模板，永远可用、可测试（不依赖任何服务）
 * - narratePatrolReport：可选 LLM 润色；narrator 由调用方注入（浏览器端接
 *   ai-service 的 askAssistant），超时/失败/未启用时原样回退模板文本。
 * LLM 只负责把已确定的 Finding 组织成文字，不产生新的诊断结论。
 */
import type { AutopilotCycleResult } from './factoryAutopilot'

export type PatrolNarrator = (question: string, context: Record<string, unknown>) => Promise<string>

export interface PatrolNarration {
  text: string
  source: 'rule' | 'ai'
}

function trendText(result: AutopilotCycleResult): string {
  const { forecast } = result
  switch (forecast.trend) {
    case 'rising':
      return '交付速率处于上升趋势。'
    case 'declining':
      return forecast.etaZeroSec !== null
        ? `交付速率持续下滑，按当前趋势约 ${formatEta(forecast.etaZeroSec)}后归零。`
        : '交付速率持续下滑。'
    case 'critical':
      return '交付已经停滞且阻塞仍在增长，需要立即处理。'
    default:
      return '交付速率总体平稳。'
  }
}

function formatEta(etaSec: number): string {
  if (etaSec < 90) return `${etaSec} 秒`
  return `${Math.round(etaSec / 60)} 分钟`
}

/** 确定性巡检报告模板；同一输入永远得到同一文本。 */
export function buildPatrolReport(result: AutopilotCycleResult): string {
  const lines: string[] = []
  lines.push(`【自动巡检报告】证据窗口 ${result.metrics.timeSec.toFixed(0)} 秒（时序样本 ${result.samples.length} 轮）`)
  lines.push(
    `吞吐 ${result.metrics.throughputPerHour.toFixed(1)} 件/h；利用率 ${result.metrics.utilization.toFixed(1)}%；` +
    `阻塞 ${result.metrics.blockedObjects} 个；在途 ${result.metrics.wip} 批。`,
  )
  lines.push(`趋势：${trendText(result)}（斜率 ${result.forecast.slopePerCycle.toFixed(2)} 件/分钟·周期）`)
  if (result.baselineReset) lines.push('注意：工厂结构相对上一基线发生变化，本轮为跨结构比较。')

  const autopilotFindings = result.analysis.findings.filter((finding) => finding.code.startsWith('autopilot_'))
  if (autopilotFindings.length === 0 && !result.degraded) {
    lines.push('结论：较基线无明显劣化，维持监测即可。')
  } else {
    if (autopilotFindings.length > 0) {
      lines.push('发现：')
      for (const finding of autopilotFindings) {
        lines.push(`- [${finding.severity}] ${finding.title}：${finding.detail}`)
        lines.push(`  建议：${finding.recommendation}`)
      }
    }
    lines.push(result.degraded ? '结论：本轮判定运行劣化，建议进入方案设计并生成受控修复 Patch（需人工审批）。' : '结论：存在提示信息，暂无需修复动作。')
  }
  return lines.join('\n')
}

/** 可选 LLM 润色：narrator 失败或返回空文本时回退确定性模板。 */
export async function narratePatrolReport(result: AutopilotCycleResult, narrator?: PatrolNarrator): Promise<PatrolNarration> {
  const template = buildPatrolReport(result)
  if (!narrator) return { text: template, source: 'rule' }
  try {
    const answer = await narrator(
      '请把以下自动巡检报告改写成一段更通顺的中文简报，保留全部数字与结论，不要新增事实：',
      { report: template, degraded: result.degraded },
    )
    const text = answer.trim()
    return text.length > 0 ? { text, source: 'ai' } : { text: template, source: 'rule' }
  } catch {
    return { text: template, source: 'rule' }
  }
}
