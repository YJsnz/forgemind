/**
 * 自动巡检编排层 —— 把「证据副本 → 指标时序 → 趋势预警 → 劣化检测」串成一次确定性循环。
 *
 * 设计边界（与 ForgeCore Agent 一致）：
 * - 只读：巡检本身不修改工厂存档，产出的是 Finding 与提示
 * - 人工审批：发现劣化后仅预选「方案设计」模式，Patch 仍走既有生成→校验→审批链路
 * - 确定性：固定种子副本仿真 + 纯函数趋势判定，同一输入永远同一结论
 * - 基线语义：结构版本变化时仍与上一基线比较（回答「改动是否伤产能」），并标记基线重置
 */
import { analyzeFactory, createFactoryVersion, runFactoryEvidence } from './factoryAgent'
import type { AgentFactoryContext } from './agentTypes'
import type { AgentAnalysisResult, AgentFinding, AgentMetrics } from './agentTypes'
import { analyzeBottlenecks, type BottleneckReport } from './bottleneckAnalysis'
import { analyzeEnergy, type EnergyReport } from './energyAnalysis'
import { appendRackTotals, forecastRackDepletion, type RackStockForecast } from './inventoryForecast'
import {
  forecastBottleneck,
  DEFAULT_METRICS_HISTORY_CAPACITY,
  type BottleneckForecast,
  type MetricsSample,
} from './metricsHistory'

export interface AutopilotBaseline {
  /** 建立基线时的工厂结构版本；结构变化后自动重置 */
  version: string
  throughputPerHour: number
  utilization: number
  blockedObjects: number
}

export interface AutopilotOptions {
  /** 每次巡检的只读副本时长（秒） */
  evidenceHorizonSec?: number
  /** 巡检周期（秒），用于把周期斜率折算成 ETA */
  cycleIntervalSec?: number
  /** 相对基线的吞吐下降比例阈值（0-1） */
  throughputDropRatio?: number
  /** 阻塞对象相对基线的绝对增量阈值 */
  blockedIncrease?: number
  /** 时序环形容量 */
  historyCapacity?: number
  /** 是否运行分采样瓶颈归因（默认开启） */
  includeBottleneckAnalysis?: boolean
  /** 是否运行能耗归因（默认开启） */
  includeEnergyAnalysis?: boolean
}

export interface AutopilotCycleInput {
  context: AgentFactoryContext
  baseline: AutopilotBaseline | null
  previousSamples: MetricsSample[]
  /** 跨周期货架库存历史（rackId -> 每轮总量），由调用方保存并回传 */
  rackHistory?: Record<string, number[]>
  options?: AutopilotOptions
}

export interface AutopilotCycleResult {
  metrics: AgentMetrics
  sample: MetricsSample
  samples: MetricsSample[]
  forecast: BottleneckForecast
  /** 分采样瓶颈归因报告（关闭时为 null） */
  bottleneck: BottleneckReport | null
  /** 能耗归因报告（关闭时为 null） */
  energy: EnergyReport | null
  /** 有限货架库存耗尽预测（按剩余时间升序） */
  stockForecasts: RackStockForecast[]
  /** 更新后的货架库存历史，调用方保存并回传下一轮 */
  rackHistory: Record<string, number[]>
  /** 预警文案（已并入 analysis.findings） */
  findings: string[]
  /** 相对基线发生显著劣化 */
  degraded: boolean
  /** 结构变化导致基线重置 */
  baselineReset: boolean
  analysis: AgentAnalysisResult
  baseline: AutopilotBaseline
  summaryText: string
}

const DEFAULTS: Required<Omit<AutopilotOptions, 'includeEnergyAnalysis' | 'rackHistory'>> & { includeEnergyAnalysis: boolean } = {
  evidenceHorizonSec: 60,
  cycleIntervalSec: 60,
  throughputDropRatio: 0.25,
  blockedIncrease: 1,
  historyCapacity: DEFAULT_METRICS_HISTORY_CAPACITY,
  includeBottleneckAnalysis: true,
  includeEnergyAnalysis: true,
}

function toSample(metrics: AgentMetrics, horizonSec: number): MetricsSample {
  return {
    timeSec: horizonSec,
    deliveredPerMin: metrics.timeSec > 0 ? (metrics.produced / metrics.timeSec) * 60 : 0,
    utilizationPct: metrics.utilization,
    blockedObjects: metrics.blockedObjects,
    inTransitLots: metrics.wip,
  }
}

function finding(severity: AgentFinding['severity'], code: string, title: string, detail: string, impact: string, recommendation: string, evidenceValue: string): AgentFinding {
  return {
    id: `autopilot-${code}`,
    severity,
    code,
    title,
    detail,
    impact,
    recommendation,
    objectIds: [],
    evidence: [{ kind: 'metric', label: 'AUTO PATROL', value: evidenceValue }],
  }
}

/** 执行一轮自动巡检：证据副本 → 记录样本 → 趋势/劣化判定 → 注入标准分析结果。 */
export function runAutopilotCycle(input: AutopilotCycleInput): AutopilotCycleResult {
  const options = { ...DEFAULTS, ...input.options }
  const { context } = input

  const evidence = runFactoryEvidence(context, options.evidenceHorizonSec)
  const metrics = evidence.metrics
  const sample = toSample(metrics, options.evidenceHorizonSec)
  const samples = [...input.previousSamples, sample].slice(-options.historyCapacity)
  const forecast = forecastBottleneck(samples, options.cycleIntervalSec)

  const findings: string[] = []
  const autopilotFindings: AgentFinding[] = []
  let degraded = false
  let baselineReset = false

  const currentVersion = createFactoryVersion(context)
  const hasBaseline = input.baseline !== null
  const structureChanged = hasBaseline && input.baseline!.version !== currentVersion
  if (structureChanged) {
    baselineReset = true
    findings.push('工厂结构已变化，本轮相对上一结构的基线比较。')
  }

  if (input.baseline) {
    // 无论结构是否变化都与上一基线比较：这正是「改动是否伤产能」的直接答案。
    const base = input.baseline
    const dropRatio = base.throughputPerHour > 0.5 ? Math.max(0, (base.throughputPerHour - metrics.throughputPerHour) / base.throughputPerHour) : 0
    const blockedDelta = metrics.blockedObjects - base.blockedObjects
    if (dropRatio >= options.throughputDropRatio) {
      degraded = true
      findings.push(`交付吞吐较基线下降 ${(dropRatio * 100).toFixed(0)}%（${base.throughputPerHour.toFixed(1)} → ${metrics.throughputPerHour.toFixed(1)} 件/h）。`)
      autopilotFindings.push(finding(
        'warning',
        'autopilot_throughput_degradation',
        '自动巡检发现吞吐劣化',
        `证据副本 ${metrics.timeSec.toFixed(0)} 秒吞吐 ${metrics.throughputPerHour.toFixed(1)} 件/h，基线为 ${base.throughputPerHour.toFixed(1)} 件/h。`,
        '持续劣化会放大为交付延迟和库存积压。',
        '进入方案设计模式，根据瓶颈 Finding 生成受控修复方案并做分支比较。',
        `${base.throughputPerHour.toFixed(1)} → ${metrics.throughputPerHour.toFixed(1)} /h`,
      ))
    }
    if (blockedDelta >= options.blockedIncrease && metrics.blockedObjects > 0) {
      degraded = true
      findings.push(`阻塞对象较基线增加 ${blockedDelta} 个（当前 ${metrics.blockedObjects}）。`)
      autopilotFindings.push(finding(
        'critical',
        'autopilot_blocked_increase',
        '自动巡检发现阻塞扩大',
        `当前 ${metrics.blockedObjects} 个供料边界或载具处于阻塞/等待，基线为 ${base.blockedObjects}。`,
        '阻塞会沿上游传播，最终表现为吞吐下降。',
        '检查新增阻塞点的下游容量、货架库存与运输任务。',
        `+${blockedDelta}`,
      ))
    }
  }

  if (forecast.trend === 'declining' && forecast.etaZeroSec !== null) {
    findings.push(`按近 ${forecast.sampleCount} 轮趋势外推，交付速率约 ${formatEta(forecast.etaZeroSec)} 后归零。`)
    autopilotFindings.push(finding(
      'info',
      'autopilot_bottleneck_forecast',
      '瓶颈趋势预测',
      `最近 ${forecast.sampleCount} 轮巡检交付速率每周期变化 ${forecast.slopePerCycle.toFixed(2)} 件/分钟。`,
      '线性外推仅供参考，持续下滑会演变为真实阻塞。',
      '提前检查最慢工序或末端接收容量。',
      `ETA ≈ ${formatEta(forecast.etaZeroSec)}`,
    ))
  } else if (forecast.trend === 'critical') {
    findings.push('交付已经停止且阻塞仍在增长。')
    autopilotFindings.push(finding(
      'critical',
      'autopilot_delivery_stalled',
      '交付停滞且阻塞增长',
      `最新窗口无交付，阻塞对象 ${samples[samples.length - 1].blockedObjects} 个且仍在增加。`,
      '生产线处于实际停摆状态。',
      '立即定位首个阻塞点并恢复下游流通。',
      'STALLED',
    ))
    degraded = true
  }

  // 分采样瓶颈归因：给出「供料者 → 约束设备」的因果链。
  let bottleneck: BottleneckReport | null = null
  if (options.includeBottleneckAnalysis) {
    bottleneck = analyzeBottlenecks(context.objects, context.recipes, options.evidenceHorizonSec)
    if (bottleneck.primary && bottleneck.chain.length > 0) {
      const chainText = bottleneck.chain.join('；')
      findings.push(`首要瓶颈：${chainText}`)
      autopilotFindings.push(finding(
        degraded ? 'warning' : 'info',
        'autopilot_constraint_chain',
        '约束链归因',
        chainText,
        '约束设备的节拍决定全厂产出上限；优先改善它收益最大。',
        '先对首要约束做分支验证（并行设备/缓存/节拍调整），再考虑非约束环节。',
        `primary=${bottleneck.primary}`,
      ))
    }
  }

  // 能耗归因：找出待机浪费最大的设备。
  let energy: EnergyReport | null = null
  if (options.includeEnergyAnalysis) {
    energy = analyzeEnergy(context.objects, context.recipes, options.evidenceHorizonSec)
    const waster = energy.topIdleWaster
    if (waster) {
      findings.push(`待机浪费：${waster.displayName} 占其能耗 ${(waster.idleShare * 100).toFixed(0)}%`)
      autopilotFindings.push(finding(
        'info',
        'autopilot_idle_energy',
        '待机能耗偏高',
        `${waster.displayName}（额定 ${waster.ratedKw} kW）本窗口待机能耗 ${waster.idleKwh.toFixed(3)} kWh，占自身能耗 ${(waster.idleShare * 100).toFixed(0)}%。`,
        '长期待机空转会推高单位产出能耗。',
        '检查该设备的供料是否长期断续，或调整开机编排。',
        `idle=${(waster.idleKwh * 1000).toFixed(0)} Wh`,
      ))
    }
  }

  // 库存耗尽预测：有限货架按跨周期消耗斜率外推。
  const rackTotals = evidence.snapshot.racks
    .filter((rack) => rack.kind === 'rack')
    .map((rack) => ({ rackId: rack.objectId, total: Object.values(rack.inventory).reduce((sum, qty) => sum + qty, 0) }))
  const rackHistory = appendRackTotals(input.rackHistory ?? {}, rackTotals, options.historyCapacity)
  const stockForecasts = forecastRackDepletion(rackHistory, options.cycleIntervalSec)
  for (const forecast of stockForecasts) {
    if (forecast.empty) {
      findings.push(`货架 ${forecast.rackId} 库存已耗尽。`)
      autopilotFindings.push(finding(
        'warning',
        'autopilot_stock_empty',
        '货架库存耗尽',
        `货架 ${forecast.rackId} 最新巡检窗口库存为 0。`,
        '依赖该货架的运输与供料会真实阻塞，不会凭空补货。',
        '补充库存或调整供料边界。',
        'EMPTY',
      ))
      degraded = true
    } else if (forecast.etaEmptySec !== null) {
      findings.push(`货架 ${forecast.rackId} 约 ${formatEta(forecast.etaEmptySec)}后耗尽（剩 ${forecast.latest}）。`)
      autopilotFindings.push(finding(
        'info',
        'autopilot_stock_forecast',
        '库存耗尽预警',
        `货架 ${forecast.rackId} 每周期消耗 ${Math.abs(forecast.slopePerCycle).toFixed(1)} 件，剩余 ${forecast.latest} 件。`,
        '库存归零后相关物流会真实停摆。',
        '提前安排补货或降低该线路消耗。',
        `ETA ≈ ${formatEta(forecast.etaEmptySec)}`,
      ))
    }
  }

  const objectivePrefix = degraded ? '自动巡检发现运行劣化，请重点诊断瓶颈与背压。' : '自动巡检：维持交付吞吐，监控瓶颈与背压趋势。'
  const analysis = analyzeFactory(objectivePrefix, context, 'diagnose')
  const enriched: AgentAnalysisResult = {
    ...analysis,
    headline: degraded ? `自动巡检：${analysis.headline}` : analysis.headline,
    findings: [...autopilotFindings, ...analysis.findings],
  }

  const baseline: AutopilotBaseline = {
    version: currentVersion,
    throughputPerHour: metrics.throughputPerHour,
    utilization: metrics.utilization,
    blockedObjects: metrics.blockedObjects,
  }

  const parts = [`证据 ${metrics.timeSec.toFixed(0)}s`, `${metrics.throughputPerHour.toFixed(1)} 件/h`, `利用率 ${metrics.utilization.toFixed(0)}%`]
  if (bottleneck?.primary) parts.push(`首要瓶颈 ${bottleneck.primary}`)
  if (findings.length > 0) parts.push(...findings)
  else parts.push('较基线无明显劣化')

  return {
    metrics,
    sample,
    samples,
    forecast,
    bottleneck,
    energy,
    stockForecasts,
    rackHistory,
    findings,
    degraded,
    baselineReset,
    analysis: enriched,
    baseline,
    summaryText: parts.join('；'),
  }
}

function formatEta(etaSec: number): string {
  if (etaSec < 90) return `${etaSec} 秒`
  return `${Math.round(etaSec / 60)} 分钟`
}
