/**
 * 瓶颈根因归因层（约束理论 lite）。
 *
 * 在固定种子下运行一段「分采样」的只读证据副本：每 5 秒读取一次全部机器
 * 运行状态，把 60 秒窗口聚合为每台设备的忙碌率、出料受阻率、断料率，
 * 再按约束得分排序，给出「供料者 → 约束设备」的因果链。
 *
 * 边界：
 * - 这是采样式归因，不是排队论精确解；样本粒度 5 秒
 * - 只读，不改存档；结论作为 Finding 注入标准分析结果，修复仍走审批链路
 * - 同一输入永远得到同一排序（固定种子 + 固定步长）
 */
import { SimulationEngine } from './simulation'
import type { SimulationSnapshot } from './simulation'
import { getFactoryObjectDisplayName, objectRole, type FactoryObject } from './types'
import { objectCompatiblePortCells, occupiedCells } from './grid'
import type { Recipe } from './item'

export interface MachineConstraintStats {
  objectId: string
  displayName: string
  /** (processing + loading + output) 占采样比例 */
  busyRatio: number
  /** 停在 output 阶段的比例——出料受阻的代理指标 */
  outputStalledRatio: number
  /** idle 且所有输入缓冲为空的比例——上游断料 */
  starvedRatio: number
  /** 输入缓冲平均占用（已收数量 / 配方需求总数） */
  inputFillRatio: number
  /** 约束得分 = 忙碌 ×0.7 +（1 - 相对完成率）×0.3；高忙碌低完成即真约束 */
  score: number
}

export interface BottleneckReport {
  horizonSec: number
  sampleCount: number
  machines: MachineConstraintStats[]
  /** 得分最高且显著忙碌的约束设备；机器不足两台或无显著约束时为 null */
  primary: string | null
  /** 「供料者 → 约束设备」的可读链路；无主约束时为空 */
  chain: string[]
}

const SAMPLE_STEP_SEC = 5

/**
 * 分采样只读副本：固定种子，每 stepSec 秒停一次表针并回调快照。
 * 瓶颈归因与能耗归因共用同一跑法，保证口径一致、结论可复现。
 */
export function runSampledEvidence(
  objects: FactoryObject[],
  recipes: Recipe[],
  horizonSec: number,
  visit: (snapshot: SimulationSnapshot) => void,
  stepSec = SAMPLE_STEP_SEC,
): number {
  const engine = new SimulationEngine(20260821)
  engine.init(objects, recipes)
  const stepCount = Math.max(1, Math.round(horizonSec / stepSec))
  for (let index = 0; index < stepCount; index++) {
    engine.advance(stepSec)
    visit(engine.getSnapshot())
  }
  return stepCount
}

function recipeInputTotal(recipes: Recipe[], recipeId: string | null): number {
  if (!recipeId) return 0
  const recipe = recipes.find((entry) => entry.id === recipeId)
  return recipe ? recipe.inputs.reduce((sum, input) => sum + input.qty, 0) : 0
}

function recipeDurationSec(recipes: Recipe[], recipeId: string | null): number | null {
  if (!recipeId) return null
  const recipe = recipes.find((entry) => entry.id === recipeId)
  return recipe && recipe.durationSec > 0 ? recipe.durationSec : null
}

/** 找到压住 machine 输入端口格最多的上游对象（按占用格匹配）。 */
function dominantFeeder(machine: FactoryObject, objects: FactoryObject[]): FactoryObject | null {
  const inputCells = new Set(objectCompatiblePortCells(machine, 'input').map((cell) => `${cell.x},${cell.z}`))
  let best: FactoryObject | null = null
  let bestTouches = 0
  for (const other of objects) {
    if (other.id === machine.id) continue
    if ((other.floorId ?? 1) !== (machine.floorId ?? 1)) continue
    const role = objectRole(other.type, other.resourceId)
    if (role !== 'conveyor' && role !== 'machine' && role !== 'storage') continue
    const touches = occupiedCells(other).filter((cell) => inputCells.has(`${cell.x},${cell.z}`)).length
    if (touches > bestTouches) {
      best = other
      bestTouches = touches
    }
  }
  return best
}

/**
 * 分采样证据副本：与 runBranch 相同的种子与总时长，但每 5 秒停一次表针。
 * 返回按约束得分降序的设备统计。
 */
export function analyzeBottlenecks(
  objects: FactoryObject[],
  recipes: Recipe[],
  horizonSec = 60,
): BottleneckReport {
  const machines = objects.filter((object) => objectRole(object.type, object.resourceId) === 'machine')
  const emptyReport: BottleneckReport = { horizonSec, sampleCount: 0, machines: [], primary: null, chain: [] }
  if (machines.length === 0) return emptyReport

  const statsById = new Map<string, { busy: number; output: number; starved: number; fillSum: number }>()
  for (const machine of machines) statsById.set(machine.id, { busy: 0, output: 0, starved: 0, fillSum: 0 })

  let lastSnapshot: SimulationSnapshot | null = null
  const stepCount = runSampledEvidence(objects, recipes, horizonSec, (snapshot) => {
    lastSnapshot = snapshot
    for (const runtime of snapshot.machines) {
      const entry = statsById.get(runtime.objectId)
      if (!entry) continue
      if (runtime.state !== 'idle') entry.busy += 1
      if (runtime.state === 'output') entry.output += 1
      const need = recipeInputTotal(recipes, runtime.recipeId)
      const have = Object.values(runtime.inputBuffer).reduce((sum, qty) => sum + qty, 0)
      if (runtime.state === 'idle' && have === 0) entry.starved += 1
      entry.fillSum += need > 0 ? Math.min(1, have / need) : 0
    }
  })

  // 窗口结束时的累计加工时长折算完成量：约束设备的完成率显著低于同厂最佳。
  const completions = new Map<string, number>()
  for (const runtime of (lastSnapshot as SimulationSnapshot | null)?.machines ?? []) {
    const durationSec = recipeDurationSec(recipes, runtime.recipeId)
    completions.set(runtime.objectId, durationSec ? Math.max(0, runtime.processingTime / durationSec) : 0)
  }
  const maxCompletions = Math.max(0.001, ...machines.map((machine) => completions.get(machine.id) ?? 0))

  const list: MachineConstraintStats[] = machines.map((machine) => {
    const entry = statsById.get(machine.id)!
    const busyRatio = entry.busy / stepCount
    const outputStalledRatio = entry.output / stepCount
    const starvedRatio = entry.starved / stepCount
    const inputFillRatio = entry.fillSum / stepCount
    // 忙碌但完成率低 = 真约束；完成率高或闲置 = 非约束（断料机由 starved 体现）。
    const relativeThroughput = (completions.get(machine.id) ?? 0) / maxCompletions
    return {
      objectId: machine.id,
      displayName: getFactoryObjectDisplayName(machine),
      busyRatio,
      outputStalledRatio,
      starvedRatio,
      inputFillRatio,
      score: busyRatio * 0.7 + (1 - relativeThroughput) * 0.3,
    }
  }).sort((left, right) => right.score - left.score || left.objectId.localeCompare(right.objectId))

  // 主约束必须显著忙碌（≥85%）且至少存在两台设备才有「瓶颈」可言。
  const top = list[0]
  const hasRealConstraint = list.length >= 2 && top.busyRatio >= 0.85
  const primary = hasRealConstraint ? top.objectId : null

  const chain: string[] = []
  if (primary && top) {
    const machineObj = machines.find((machine) => machine.id === primary)
    const feeder = machineObj ? dominantFeeder(machineObj, objects) : null
    const detail = [`忙碌 ${(top.busyRatio * 100).toFixed(0)}%`]
    if (top.outputStalledRatio > 0.15) detail.push(`出料受阻 ${(top.outputStalledRatio * 100).toFixed(0)}%`)
    if (top.starvedRatio > 0.15) detail.push(`断料 ${(top.starvedRatio * 100).toFixed(0)}%`)
    let text = `${top.displayName}[${top.objectId}]（${detail.join('，')}）`
    if (feeder && feeder.id !== top.objectId) {
      text = `${getFactoryObjectDisplayName(feeder)}[${feeder.id}] → ${text}`
    }
    chain.push(text)
    // 次级约束：得分紧随其后的设备也值得一提。
    const second = list[1]
    if (second && second.busyRatio >= 0.7) {
      chain.push(`次级观察：${second.displayName}[${second.objectId}]（忙碌 ${(second.busyRatio * 100).toFixed(0)}%）`)
    }
  }

  return { horizonSec, sampleCount: stepCount, machines: list, primary, chain }
}
