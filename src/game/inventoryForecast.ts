/**
 * 货架库存耗尽预测 —— 纯函数。
 *
 * 输入是跨巡检周期的货架总库存序列（每轮一个点），用与吞吐趋势相同的
 * 最小二乘斜率外推耗尽时间。只对有限容量货架（kind='rack'）有意义；
 * 入货仓库是无限供货边界，库存不随取出减少，不参与预测。
 */
import { linearSlope } from './metricsHistory'

export interface RackStockPoint {
  rackId: string
  total: number
}

export interface RackStockForecast {
  rackId: string
  latest: number
  slopePerCycle: number
  /** 按当前消耗线性外推的耗尽剩余秒数；不适用时为 null */
  etaEmptySec: number | null
  /** 最新一轮已经耗尽 */
  empty: boolean
}

const SLOPE_EPSILON = 0.01

export function forecastRackDepletion(
  history: Record<string, number[]>,
  cycleIntervalSec = 60,
): RackStockForecast[] {
  const forecasts: RackStockForecast[] = []
  for (const [rackId, points] of Object.entries(history)) {
    if (points.length < 2) continue
    const latest = points[points.length - 1]
    const slope = linearSlope(points)
    if (latest <= 0.01) {
      forecasts.push({ rackId, latest: 0, slopePerCycle: slope, etaEmptySec: null, empty: true })
      continue
    }
    if (slope < -SLOPE_EPSILON) {
      const cyclesToEmpty = Math.ceil(latest / -slope)
      forecasts.push({ rackId, latest, slopePerCycle: slope, etaEmptySec: Math.round(cyclesToEmpty * cycleIntervalSec), empty: false })
    }
  }
  return forecasts.sort((left, right) => (left.etaEmptySec ?? Number.MAX_SAFE_INTEGER) - (right.etaEmptySec ?? Number.MAX_SAFE_INTEGER) || left.rackId.localeCompare(right.rackId))
}

/** 把本轮货架快照并入历史（固定容量，超容量丢最旧）。 */
export function appendRackTotals(
  history: Record<string, number[]>,
  racks: Array<{ rackId: string; total: number }>,
  capacity: number,
): Record<string, number[]> {
  const next: Record<string, number[]> = {}
  for (const [rackId, points] of Object.entries(history)) next[rackId] = [...points]
  for (const { rackId, total } of racks) {
    const points = next[rackId] ?? []
    points.push(total)
    if (points.length > capacity) points.splice(0, points.length - capacity)
    next[rackId] = points
  }
  return next
}
