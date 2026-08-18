import type { Recipe } from './item'
import type { SimulationSnapshot } from './simulation'
import { objectPortCells, occupiedCells } from './grid'
import { cellKey } from './dir'
import { objectRole, type FactoryObject } from './types'

export interface FactoryDiagnosticState {
  status: 'STABLE' | 'ATTENTION' | 'BLOCKED'
  score: number
  throughputPerHour: number
  utilization: number
  activeMachines: number
  blockedSources: number
  disconnectedSources: number
  backpressureSources: number
  openIssues: string[]
  recommendation: string
}

/** Read-only live diagnosis shared by A-01 and A-02. */
export function diagnoseFactory(
  objects: FactoryObject[],
  snapshot: SimulationSnapshot,
  recipes: Recipe[],
): FactoryDiagnosticState {
  const recipeIds = new Set(recipes.map((recipe) => recipe.id))
  const machines = objects.filter((object) => objectRole(object.type) === 'machine')
  const objectsByCell = new Map<string, FactoryObject>()
  for (const object of objects) {
    for (const cell of occupiedCells(object)) objectsByCell.set(cellKey(cell.x, cell.z), object)
  }
  const blockedSources = snapshot.sources.filter((source) => source.state === 'blocked').length
  const sourceObjects = objects.filter((object) => object.type === 'source' && object.itemId)
  const disconnectedSourceIds = new Set(sourceObjects.filter((source) => !objectPortCells(source, 'output').some((cell) => {
    const downstream = objectsByCell.get(cellKey(cell.x, cell.z))
    if (!downstream) return false
    const inputCells = objectPortCells(downstream, 'input')
    return inputCells.length === 0 || occupiedCells(source).some((occupied) => inputCells.some((input) => occupied.x === input.x && occupied.z === input.z))
  })).map((source) => source.id))
  const disconnectedSources = disconnectedSourceIds.size
  const backpressureSources = snapshot.sources.filter((source) => source.state === 'blocked' && !disconnectedSourceIds.has(source.objectId)).length
  const targetItemId = inferTargetItemId(recipes)
  const noRecipeMachines = machines.filter((machine) => !machine.recipeId || !recipeIds.has(machine.recipeId)).length
  const activeMachines = snapshot.machines.filter((machine) => machine.state === 'processing' || machine.state === 'output').length
  const throughputPerHour = snapshot.timeSec > 0
    ? ((snapshot.stats.produced[targetItemId] ?? 0) / snapshot.timeSec) * 3600
    : 0
  const utilization = machines.length === 0 || snapshot.timeSec <= 0
    ? 0
    : Math.min(100, (snapshot.machines.reduce((sum, machine) => sum + machine.processingTime, 0) / (machines.length * snapshot.timeSec)) * 100)
  const openIssues: string[] = []

  if (objects.length === 0) openIssues.push('当前场地还没有设备')
  if (noRecipeMachines > 0) openIssues.push(`${noRecipeMachines} 台设备没有有效配方`)
  if (disconnectedSources > 0) openIssues.push(`${disconnectedSources} 个来料站没有有效物流接口`)
  if (backpressureSources > 0) openIssues.push(`${backpressureSources} 个来料站受到下游满载背压`)
  if (snapshot.itemLots.length > Math.max(6, objects.length * 0.7)) openIssues.push('在途物料堆积，物流节拍可能低于加工节拍')

  const status = disconnectedSources > 0 || noRecipeMachines > 0
    ? 'BLOCKED'
    : openIssues.length > 0
      ? 'ATTENTION'
      : 'STABLE'
  const score = Math.max(0, Math.round(100 - disconnectedSources * 24 - backpressureSources * 4 - noRecipeMachines * 16 - Math.max(0, snapshot.itemLots.length - objects.length * 0.35) * 2))
  const recommendation = status === 'BLOCKED'
    ? '先修复断开的来料接口和无配方设备，再运行布局优化。'
    : status === 'ATTENTION'
      ? '建议运行一次副本诊断，检查下游满载背压是否需要增加缓存或并行设备。'
      : '当前结构可以继续仿真；可用 Generative Factory 比较下一轮布局。'

  return { status, score, throughputPerHour, utilization, activeMachines, blockedSources, disconnectedSources, backpressureSources, openIssues, recommendation }
}

function inferTargetItemId(recipes: Recipe[]): string {
  const inspectionOutputs = recipes
    .filter((recipe) => /inspection|inspect|质检|检/i.test(`${recipe.id} ${recipe.name}`))
    .flatMap((recipe) => recipe.outputs)
  const inspectionOutput = inspectionOutputs[inspectionOutputs.length - 1]?.itemId
  if (inspectionOutput) return inspectionOutput

  const consumed = new Set(recipes.flatMap((recipe) => recipe.inputs.map((port) => port.itemId)))
  return recipes.flatMap((recipe) => recipe.outputs).find((port) => !consumed.has(port.itemId))?.itemId ?? 'item_inspected_motor'
}
