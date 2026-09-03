/**
 * 产线平衡与节拍分析（确定性纯函数）。
 *
 * 从目标吞吐节拍与各工序加工时长/设备数计算出工序级产能、所需设备数、
 * 欠配缺口与平衡损失，供生成式规划评分与 Agent 工序失衡诊断复用。
 * 本模块不依赖 factoryAgent / generativeFactory，避免 import 环：
 * generativeFactory 会反向 import 本模块来计算评分，因此依赖 RecipeGraph
 * 的工序推导函数放在 generativeFactory 侧。
 *
 * 运行：npm run line-balance:units
 */
import { objectRole, type FactoryObject } from './types'
import type { Recipe } from './item'

export interface LineStage {
  /** 工序标识：生成式侧为 'machining' | 'washing' | ...，对象侧为 recipeId。 */
  nodeId: string
  name: string
  machineType?: string
  recipeId: string
  /** 该工序单件加工时长（秒）。 */
  durationSec: number
  /** 当前/计划设备数。 */
  machineCount: number
  /** = machineCount × 3600/durationSec（整工序理论能力）。 */
  capacityPerHour: number
  /** = 3600/durationSec（单机理论能力）。 */
  perMachineCapacityPerHour: number
  /** = ceil(target / perMachineCapacity)（target 给定时）。 */
  requiredCount: number
  /** = requiredCount − machineCount（>0 欠配，<0 过剩）。 */
  capacityGap: number
  /** = capacityPerHour / target（1=恰好；<1 欠配即瓶颈；>1 富余）。 */
  loadRatio: number
  /** 实测利用率回填（瓶颈报告/快照），仅作展示证据，不参与理论判定。 */
  measuredUtilizationPct?: number
}

/** computeLineBalance 的精简输入：只需时长与设备数，其余字段由计算补齐。 */
export type StageInput = Pick<LineStage, 'nodeId' | 'name' | 'recipeId' | 'durationSec' | 'machineCount'> & {
  machineType?: string
  measuredUtilizationPct?: number
}

export interface LineBalanceReport {
  targetThroughputPerHour: number | null
  /** = 3600/target（目标节拍，秒）。 */
  taktSec: number | null
  stages: LineStage[]
  /** = 1 − min(loadRatio)/max(loadRatio) ∈ [0,1]（target 给定时）。 */
  balanceLoss: number
  /** loadRatio 最小者，仅当 min < 1−tolerance。 */
  bottleneckNodeId: string | null
  /** loadRatio > 1+tolerance 且富余 ≥2 台（target 给定时）。 */
  overprovisionedNodeIds: string[]
  /** 每工序 loadRatio ≥ 1−tolerance。 */
  feasible: boolean
  /** 中文一行摘要。 */
  summary: string
}

/** 默认平衡容差：目标节拍的 ±15%。 */
export const DEFAULT_BALANCE_TOLERANCE = 0.15

/**
 * 由目标节拍与工序列表计算平衡报告。纯函数、无副作用、同输入逐字节可复现。
 */
export function computeLineBalance(
  targetThroughputPerHour: number | null,
  stages: StageInput[],
  tolerance = DEFAULT_BALANCE_TOLERANCE,
): LineBalanceReport {
  const targetValid = targetThroughputPerHour != null && targetThroughputPerHour > 0
  const enriched: LineStage[] = stages.map((stage) => {
    const perMachineCapacityPerHour = 3600 / stage.durationSec
    const capacityPerHour = stage.machineCount * perMachineCapacityPerHour
    const requiredCount = targetValid ? Math.max(1, Math.ceil(targetThroughputPerHour! / perMachineCapacityPerHour)) : 1
    const capacityGap = targetValid ? requiredCount - stage.machineCount : 0
    const loadRatio = targetValid ? capacityPerHour / targetThroughputPerHour! : 1
    return {
      ...stage,
      perMachineCapacityPerHour,
      capacityPerHour,
      requiredCount,
      capacityGap,
      loadRatio,
    }
  })

  let bottleneckNodeId: string | null = null
  if (targetValid && enriched.length > 0) {
    const minRatio = Math.min(...enriched.map((stage) => stage.loadRatio))
    if (minRatio < 1 - tolerance) {
      bottleneckNodeId = enriched.find((stage) => stage.loadRatio === minRatio)?.nodeId ?? null
    }
  }

  const overprovisionedNodeIds = targetValid
    ? enriched.filter((stage) => stage.loadRatio > 1 + tolerance && stage.capacityGap <= -2).map((stage) => stage.nodeId)
    : []

  let balanceLoss = 0
  if (targetValid && enriched.length >= 2) {
    const ratios = enriched.map((stage) => stage.loadRatio)
    const minRatio = Math.min(...ratios)
    const maxRatio = Math.max(...ratios)
    if (maxRatio > 0) balanceLoss = 1 - minRatio / maxRatio
  }

  const feasible = targetValid && enriched.length > 0 && enriched.every((stage) => stage.loadRatio >= 1 - tolerance)

  const summary = buildSummary(targetValid, targetThroughputPerHour, enriched, bottleneckNodeId, feasible, balanceLoss)

  return {
    targetThroughputPerHour: targetValid ? targetThroughputPerHour! : null,
    taktSec: targetValid ? 3600 / targetThroughputPerHour! : null,
    stages: enriched,
    balanceLoss,
    bottleneckNodeId,
    overprovisionedNodeIds,
    feasible,
    summary,
  }
}

function buildSummary(
  targetValid: boolean,
  targetThroughputPerHour: number | null,
  stages: LineStage[],
  bottleneckNodeId: string | null,
  feasible: boolean,
  balanceLoss: number,
): string {
  if (!targetValid) return '未设定目标节拍，当前无法评估产线平衡。'
  if (stages.length === 0) return '没有可评估的工序。'
  if (feasible) return `产线节拍均衡（平衡损失 ${(balanceLoss * 100).toFixed(1)}%），所有工序产能均达到目标节拍 ${targetThroughputPerHour!.toFixed(0)}/h。`
  const bottleneck = bottleneckNodeId ? stages.find((stage) => stage.nodeId === bottleneckNodeId) : undefined
  if (bottleneck) {
    return `瓶颈工序「${bottleneck.name}」产能 ${bottleneck.capacityPerHour.toFixed(0)}/h，低于目标节拍，需要 ${bottleneck.requiredCount - bottleneck.machineCount} 台并行设备（当前 ${bottleneck.machineCount} 台）。`
  }
  return `当前产能未达目标节拍 ${targetThroughputPerHour!.toFixed(0)}/h，平衡损失 ${(balanceLoss * 100).toFixed(1)}%。`
}

/**
 * 由现有工厂对象 + 配方构建工序模型（Agent 侧复用）。
 * 只统计绑定有效配方的机器，按 recipeId 分组为工序。
 */
export function stageModelFromObjects(
  objects: FactoryObject[],
  recipes: Recipe[],
): StageInput[] {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const groups = new Map<string, { recipe: Recipe; count: number }>()
  for (const object of objects) {
    if (objectRole(object.type, object.resourceId) !== 'machine') continue
    if (!object.recipeId || !recipesById.has(object.recipeId)) continue
    const entry = groups.get(object.recipeId)
    if (entry) entry.count += 1
    else groups.set(object.recipeId, { recipe: recipesById.get(object.recipeId)!, count: 1 })
  }
  if (groups.size === 0) return []
  return orderStagesByFlow([...groups.entries()]).map(([recipeId, { recipe, count }]) => ({
    nodeId: recipeId,
    name: recipe.name || recipeId,
    recipeId,
    durationSec: recipe.durationSec,
    machineCount: count,
  }))
}

/** 按生产流向排序工序：先处理深度下游更长的工序（越靠原料越靠前）。 */
function orderStagesByFlow(
  entries: Array<[string, { recipe: Recipe; count: number }]>,
): Array<[string, { recipe: Recipe; count: number }]> {
  const byId = new Map(entries)
  const consumersByOutput = new Map<string, string[]>()
  for (const [recipeId, { recipe }] of entries) {
    for (const port of recipe.outputs) {
      const consumers = consumersByOutput.get(port.itemId) ?? []
      consumers.push(recipeId)
      consumersByOutput.set(port.itemId, consumers)
    }
  }
  const downstreamDepth = new Map<string, number>()
  const depthOf = (recipeId: string, seen: Set<string>): number => {
    const cached = downstreamDepth.get(recipeId)
    if (cached !== undefined) return cached
    if (seen.has(recipeId)) return 0
    seen.add(recipeId)
    const recipe = byId.get(recipeId)!.recipe
    let maxDepth = 0
    for (const port of recipe.outputs) {
      for (const consumer of consumersByOutput.get(port.itemId) ?? []) {
        if (consumer === recipeId) continue
        maxDepth = Math.max(maxDepth, 1 + depthOf(consumer, seen))
      }
    }
    seen.delete(recipeId)
    downstreamDepth.set(recipeId, maxDepth)
    return maxDepth
  }
  for (const [recipeId] of entries) depthOf(recipeId, new Set())
  return [...entries].sort((a, b) => {
    const depthDelta = (downstreamDepth.get(b[0]) ?? 0) - (downstreamDepth.get(a[0]) ?? 0)
    if (depthDelta !== 0) return depthDelta
    return a[0].localeCompare(b[0])
  })
}

/** 确定性中文模板报告（LLM 润色钩子：只允许改写表述，不得新增事实）。 */
export function formatBalanceReport(report: LineBalanceReport): string {
  const lines: string[] = []
  lines.push('【线平衡报告】')
  const targetText = report.taktSec !== null
    ? `目标节拍 ${report.targetThroughputPerHour!.toFixed(0)} 件/h（${report.taktSec.toFixed(2)} s/件）`
    : '未设定目标节拍'
  lines.push(`节拍：${targetText}；平衡损失 ${(report.balanceLoss * 100).toFixed(1)}%`)
  for (const stage of report.stages) {
    const parts = [
      `「${stage.name}」${stage.machineCount} 台`,
      `单机能力 ${stage.perMachineCapacityPerHour.toFixed(0)}/h`,
      `工序能力 ${stage.capacityPerHour.toFixed(0)}/h`,
    ]
    if (report.targetThroughputPerHour !== null) {
      parts.push(`需 ${stage.requiredCount} 台`)
      if (stage.capacityGap > 0) parts.push(`缺口 ${stage.capacityGap} 台`)
    }
    if (stage.measuredUtilizationPct !== undefined) parts.push(`实测利用率 ${stage.measuredUtilizationPct.toFixed(1)}%`)
    lines.push(`- ${parts.join('，')}`)
  }
  if (report.bottleneckNodeId) {
    const bottleneck = report.stages.find((stage) => stage.nodeId === report.bottleneckNodeId)
    if (bottleneck) lines.push(`瓶颈：${bottleneck.name}（${bottleneck.machineCount} 台，需 ${bottleneck.requiredCount} 台）`)
  }
  if (report.overprovisionedNodeIds.length > 0) {
    lines.push(`过剩：${report.overprovisionedNodeIds.map((nodeId) => report.stages.find((stage) => stage.nodeId === nodeId)?.name ?? nodeId).join('、')}（可削减并行设备）`)
  }
  lines.push(`结论：${report.feasible ? '节拍均衡，可稳定达到目标产能' : report.bottleneckNodeId ? '存在工序瓶颈，需扩容或平衡各工序设备数' : report.targetThroughputPerHour === null ? '缺少目标节拍，无法评估平衡' : '未达目标节拍，需要调整布局'}`)
  return lines.join('\n')
}
