/**
 * 运行指标时序层 —— 自动巡检的确定性记忆。
 *
 * 只做纯函数与环形缓冲：
 * - 记录固定容量的指标样本（吞吐、利用率、阻塞数、在途数）
 * - 最小二乘斜率 + 零值到达时间预测
 * - 不引入任何概率模型；同一序列永远得到同一结论
 */

export interface MetricsSample {
  /** 该样本证据窗口的逻辑时长（秒），仅作展示 */
  timeSec: number
  /** 折算每分钟交付数 */
  deliveredPerMin: number
  /** 平均设备利用率百分比 */
  utilizationPct: number
  /** 阻塞的供料边界 + 等待载具数量 */
  blockedObjects: number
  /** 在途批次数量 */
  inTransitLots: number
}

export type BottleneckTrend = 'rising' | 'stable' | 'declining' | 'critical'

export interface BottleneckForecast {
  trend: BottleneckTrend
  /** 每个巡检周期的交付速率变化（件/分钟·周期） */
  slopePerCycle: number
  /** 当前最新交付速率 */
  latestPerMin: number
  /** 按当前斜率线性外推，交付归零的剩余秒数；不适用时为 null */
  etaZeroSec: number | null
  /** 参与判定的样本数 */
  sampleCount: number
}

export const DEFAULT_METRICS_HISTORY_CAPACITY = 36

/** 固定容量 FIFO；超容量丢弃最旧样本。 */
export class MetricsHistory {
  private readonly samples: MetricsSample[] = []

  constructor(private readonly capacity: number = DEFAULT_METRICS_HISTORY_CAPACITY) {}

  record(sample: MetricsSample): void {
    this.samples.push(sample)
    if (this.samples.length > this.capacity) this.samples.splice(0, this.samples.length - this.capacity)
  }

  toArray(): MetricsSample[] {
    return [...this.samples]
  }

  get size(): number {
    return this.samples.length
  }
}

/** 等权最小二乘斜率（以样本序号自变量）；样本不足或共线时返回 0。 */
export function linearSlope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const meanX = (n - 1) / 2
  const meanY = values.reduce((sum, value) => sum + value, 0) / n
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < n; index++) {
    const dx = index - meanX
    numerator += dx * (values[index] - meanY)
    denominator += dx * dx
  }
  return denominator === 0 ? 0 : numerator / denominator
}

const STABLE_EPSILON_PER_CYCLE = 0.05

/**
 * 瓶颈趋势判定（步长 = 巡检周期）：
 * - 样本 < 3 → stable（证据不足不做预言）
 * - 最新交付 ≈ 0 且阻塞在增长 → critical
 * - 斜率显著为负 → declining，并按 cycleIntervalSec 折算归零 ETA
 */
export function forecastBottleneck(
  samples: MetricsSample[],
  cycleIntervalSec = 60,
): BottleneckForecast {
  const latestPerMin = samples.length > 0 ? samples[samples.length - 1].deliveredPerMin : 0
  const base: BottleneckForecast = {
    trend: 'stable',
    slopePerCycle: 0,
    latestPerMin,
    etaZeroSec: null,
    sampleCount: samples.length,
  }
  if (samples.length < 3) return base

  const slopePerCycle = linearSlope(samples.map((sample) => sample.deliveredPerMin))

  const lastBlocked = samples[samples.length - 1].blockedObjects
  const prevBlocked = samples[samples.length - 2].blockedObjects
  if (latestPerMin <= 0.01 && lastBlocked > prevBlocked) {
    return { ...base, trend: 'critical', slopePerCycle }
  }

  if (slopePerCycle < -STABLE_EPSILON_PER_CYCLE) {
    const cyclesToZero = Math.ceil(latestPerMin / -slopePerCycle)
    return { ...base, trend: 'declining', slopePerCycle, etaZeroSec: Math.round(cyclesToZero * cycleIntervalSec) }
  }

  return { ...base, trend: slopePerCycle > STABLE_EPSILON_PER_CYCLE ? 'rising' : 'stable', slopePerCycle }
}
