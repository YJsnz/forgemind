import { analyzeFactory, applyFactoryPatchToSave, buildFactoryPatchProposal, simulateFactoryBranch, validateFactoryPatch } from '../src/game/factoryAgent'
import { DEFAULT_ITEMS, DEFAULT_RECIPES } from '../src/game/item'
import { SimulationEngine } from '../src/game/simulation'
import type { AgentFactoryContext } from '../src/game/agentTypes'
import type { FactoryObject } from '../src/game/types'

const objects: FactoryObject[] = [
  { id: 'agent_source', type: 'source', pos: { x: 0, z: 0 }, rotation: 0, floorId: 1, itemId: 'item_steel_blank' },
  { id: 'agent_conveyor', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 0, floorId: 1 },
  { id: 'agent_machine', type: 'machine', pos: { x: 2, z: 0 }, rotation: 0, floorId: 1 },
]
const engine = new SimulationEngine(20260821)
engine.init(objects, DEFAULT_RECIPES)
engine.advance(10)
const context: AgentFactoryContext = { objects, items: DEFAULT_ITEMS, recipes: DEFAULT_RECIPES, snapshot: engine.getSnapshot(), floorCount: 1 }
const analysis = analyzeFactory('诊断当前工厂，每小时目标 60 件，优先最小调整', context, 'plan_design')
if (analysis.status !== 'completed' || analysis.graph.nodes.length !== DEFAULT_ITEMS.length + DEFAULT_RECIPES.length + objects.length || analysis.findings.length === 0) throw new Error('Agent 诊断没有返回结构化图、指标和 Finding')
const patch = buildFactoryPatchProposal(analysis, context)
if (!patch || !patch.operations.some((operation) => operation.kind === 'update_config' && operation.objectId === 'agent_machine' && operation.path === 'recipeId')) throw new Error('Agent 没有为无配方设备生成受控 Patch')
if (validateFactoryPatch(patch, context).length > 0) throw new Error(`Agent Patch 校验失败：${validateFactoryPatch(patch, context).join('；')}`)
const save = { version: 6, name: 'agent-regression', floorCount: 1, floorNames: ['1F'], objects, items: DEFAULT_ITEMS, recipes: DEFAULT_RECIPES, machineDefinitions: [] }
const nextSave = applyFactoryPatchToSave(save, patch)
const recipeOperation = patch.operations.find((operation) => operation.kind === 'update_config' && operation.objectId === 'agent_machine' && operation.path === 'recipeId')
if (!recipeOperation || nextSave.objects.find((object) => object.id === 'agent_machine')?.recipeId !== recipeOperation.value) throw new Error('Agent Patch 未正确写入对象配置')
const branch = simulateFactoryBranch(patch, context, 20)
if (!Number.isFinite(branch.delta.throughputPerHour) || !['apply', 'iterate', 'discard'].includes(branch.recommendation)) throw new Error('Agent 分支仿真结果非法')

const layoutObjects: FactoryObject[] = [
  { id: 'layout_source', type: 'source', pos: { x: -12, z: -6 }, rotation: 0, floorId: 1, itemId: DEFAULT_RECIPES[0].inputs[0].itemId },
  { id: 'layout_machine', type: 'machine', pos: { x: 10, z: 8 }, rotation: 0, floorId: 1, recipeId: DEFAULT_RECIPES[0].id },
]
const layoutEngine = new SimulationEngine(20260821)
layoutEngine.init(layoutObjects, DEFAULT_RECIPES)
const layoutContext: AgentFactoryContext = { objects: layoutObjects, items: DEFAULT_ITEMS, recipes: DEFAULT_RECIPES, snapshot: layoutEngine.getSnapshot(), floorCount: 1 }
const layoutAnalysis = analyzeFactory('重新排列 L1 设备，缩短供料距离，保留设备且不允许删除', layoutContext, 'plan_design')
const layoutPatch = buildFactoryPatchProposal(layoutAnalysis, layoutContext)
if (!layoutPatch?.operations.some((operation) => operation.kind === 'move_object' && operation.objectId === 'layout_machine')) throw new Error('Agent 没有为断线设备生成无碰撞移动 Patch')
if (!layoutPatch.operations.some((operation) => operation.kind === 'add_object' && operation.object.type === 'inboundWarehouse')) throw new Error('Agent 没有为零库存供料生成真实入货边界')
if (layoutPatch.operations.some((operation) => operation.kind === 'remove_object')) throw new Error('Agent 违反了保留现有设备约束')
if (validateFactoryPatch(layoutPatch, layoutContext).length > 0) throw new Error(`布局 Patch 校验失败：${validateFactoryPatch(layoutPatch, layoutContext).join('；')}`)

const routeObjects: FactoryObject[] = [
  { id: 'route_source', type: 'source', pos: { x: -10, z: 0 }, rotation: 0, floorId: 1, itemId: DEFAULT_RECIPES[0].inputs[0].itemId },
  { id: 'route_machine', type: 'machine', pos: { x: 8, z: 0 }, rotation: 0, floorId: 1, recipeId: DEFAULT_RECIPES[0].id },
]
const routeEngine = new SimulationEngine(20260821)
routeEngine.init(routeObjects, DEFAULT_RECIPES)
const routeContext: AgentFactoryContext = { objects: routeObjects, items: DEFAULT_ITEMS, recipes: DEFAULT_RECIPES, snapshot: routeEngine.getSnapshot(), floorCount: 1 }
const routeAnalysis = analyzeFactory('修复所有断开的供料链路，保留现有设备', routeContext, 'plan_design')
const routePatch = buildFactoryPatchProposal(routeAnalysis, routeContext)
if (!routePatch?.operations.some((operation) => operation.kind === 'add_object' && operation.object.type === 'conveyor')) throw new Error('Agent 没有为断开的供料边界生成传送带路线')
if (validateFactoryPatch(routePatch, routeContext).length > 0) throw new Error(`供料路线 Patch 校验失败：${validateFactoryPatch(routePatch, routeContext).join('；')}`)
const brokenObjects: FactoryObject[] = [
  { id: 'broken_left', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0, floorId: 1 },
  { id: 'broken_middle', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 90, floorId: 1 },
  { id: 'broken_right', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0, floorId: 1 },
]
const brokenConveyor = brokenObjects[1]
const brokenEngine = new SimulationEngine(20260821)
brokenEngine.init(brokenObjects, DEFAULT_RECIPES)
const brokenContext: AgentFactoryContext = { objects: brokenObjects, items: DEFAULT_ITEMS, recipes: DEFAULT_RECIPES, snapshot: brokenEngine.getSnapshot(), floorCount: 1 }
const brokenAnalysis = analyzeFactory('修复传送带开放端和错误方向', brokenContext, 'plan_design')
const brokenPatch = buildFactoryPatchProposal(brokenAnalysis, brokenContext)
if (!brokenPatch?.operations.some((operation) => operation.kind === 'update_config' && operation.objectId === brokenConveyor.id && operation.path === 'rotation')) throw new Error('Agent 没有为错误方向的传送带生成旋转 Patch')
if (validateFactoryPatch(brokenPatch, brokenContext).length > 0) throw new Error(`传送带方向 Patch 校验失败：${validateFactoryPatch(brokenPatch, brokenContext).join('；')}`)

const openEndObjects: FactoryObject[] = [
  { id: 'open_source', type: 'source', pos: { x: -6, z: 4 }, rotation: 0, floorId: 1, itemId: DEFAULT_RECIPES[0].inputs[0].itemId },
  { id: 'open_end', type: 'conveyor', pos: { x: 5, z: 4 }, rotation: 0, floorId: 1 },
  { id: 'open_machine', type: 'machine', pos: { x: 6, z: 4 }, rotation: 0, floorId: 1, recipeId: DEFAULT_RECIPES[0].id },
]
const openEndEngine = new SimulationEngine(20260821)
openEndEngine.init(openEndObjects, DEFAULT_RECIPES)
const openEndContext: AgentFactoryContext = { objects: openEndObjects, items: DEFAULT_ITEMS, recipes: DEFAULT_RECIPES, snapshot: openEndEngine.getSnapshot(), floorCount: 1 }
const openEndPatch = buildFactoryPatchProposal(analyzeFactory('补齐传送线缺失的上游连接', openEndContext, 'plan_design'), openEndContext)
if (!openEndPatch?.operations.some((operation) => operation.kind === 'add_object' && operation.object.type === 'conveyor')) throw new Error('Agent 没有为 IN=0 的开放端补齐上游传送带')
if (validateFactoryPatch(openEndPatch, openEndContext).length > 0) throw new Error(`开放端补线 Patch 校验失败：${validateFactoryPatch(openEndPatch, openEndContext).join('；')}`)

console.log(`Agent 目标编译：${analysis.goal.status} · ${analysis.goal.intent}`)
console.log(`Factory Graph：${analysis.graph.nodes.length} nodes / ${analysis.graph.edges.length} edges`)
console.log(`Findings：${analysis.findings.length} · Patch：${patch.operations.length} ops · Branch：${branch.recommendation}`)
console.log(`布局调整：${layoutPatch.operations.length} ops · move/add 均已生成`)
console.log(`链路修复：${routePatch.operations.length} ops · 传送带路线已生成`)
console.log(`开放端修复：${brokenConveyor.id} · rotation Patch 已生成`)
console.log(`缺失上游修复：${openEndPatch.operations.length} ops · 开放端补线已生成`)
console.log('Agent workflow regression passed')
