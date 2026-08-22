import { canPlace, objectCompatiblePortCells, occupiedCells } from './grid'
import { CARDINALS, cellKey, dirToRotation } from './dir'
import { BUILD_BOUND, getObjectDef, isTransportType, objectRole, type FactoryObject, type Rotation } from './types'
import type { FactorySave } from './save'
import { SimulationEngine, type SimulationSnapshot } from './simulation'
import type { Recipe } from './item'
import {
  type AgentFactoryContext,
  type AgentFinding,
  type AgentMode,
  type AgentMetrics,
  type AgentAnalysisResult,
  type AgentToolCall,
  type BranchSimulationResult,
  type FactoryGoal,
  type FactoryGraph,
  type FactoryGraphEdge,
  type FactoryGraphNode,
  type FactoryPatch,
  type FactoryPatchOperation,
} from './agentTypes'

const AGENT_TOOL_NAMES = [
  'get_factory_snapshot',
  'get_factory_graph',
  'get_simulation_metrics',
  'query_event_timeline',
  'inspect_inventory',
  'inspect_machine',
  'inspect_recipe_chain',
  'inspect_conveyors',
  'inspect_logistics',
  'calculate_capacity',
  'inspect_bottlenecks',
  'explain_constraint',
]

export function createFactoryVersion(context: Pick<AgentFactoryContext, 'objects' | 'recipes' | 'items'>): string {
  const normalized = {
    objects: context.objects.map((object) => ({
      id: object.id,
      type: object.type,
      resourceId: object.resourceId ?? null,
      pos: object.pos,
      rotation: object.rotation,
      floorId: object.floorId ?? 1,
      recipeId: object.recipeId ?? null,
      itemId: object.itemId ?? null,
      agvProgram: object.agvProgram ?? null,
      stationProgram: object.stationProgram ?? null,
      storageConfig: object.storageConfig ?? null,
    })),
    recipes: context.recipes,
    items: context.items.map((item) => ({ id: item.id, name: item.name, category: item.category })),
  }
  return `local-${hash(JSON.stringify(normalized))}`
}

export function compileFactoryGoal(objective: string, context: AgentFactoryContext, mode: AgentMode = 'diagnose'): FactoryGoal {
  const text = objective.trim() || '诊断当前工厂的瓶颈、库存和物流问题'
  const targetThroughputPerHour = parseThroughput(text)
  const targetItem = inferTargetItem(text, context)
  const hardConstraints: FactoryGoal['hardConstraints'] = {}
  const softConstraints: string[] = []
  const missingConstraints: string[] = []
  const conflicts: string[] = []

  for (const [label, key] of [['(?:机器|CNC|machine)', 'machineLimit'], ['AGV', 'agvLimit'], ['(?:无人机|drone)', 'droneLimit']] as const) {
    const limit = parseLimit(text, label)
    if (limit !== null) hardConstraints[key] = limit
  }
  const area = text.match(/(?:场地|面积|area)[^0-9]*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)/i)
  if (area) {
    hardConstraints.floorWidth = Number(area[1])
    hardConstraints.floorDepth = Number(area[2])
  }
  if (/能耗|energy|电费/i.test(text)) softConstraints.push('minimize_energy')
  if (/少改|最小调整|least\s+change/i.test(text)) softConstraints.push('minimize_changes')
  if (/吞吐|产能|throughput/i.test(text)) softConstraints.push('maximize_throughput')
  if (softConstraints.length === 0) softConstraints.push('minimize_changes', 'preserve_existing_assets')

  if (!targetThroughputPerHour && mode === 'plan_design') missingConstraints.push('target_throughput_per_hour')
  if (!targetItem && context.recipes.length > 0) missingConstraints.push('target_product')
  if (targetThroughputPerHour && targetThroughputPerHour <= 0) conflicts.push('target throughput must be positive')

  const lower = text.toLowerCase()
  const intent: FactoryGoal['intent'] = /解释|为什么|explain/.test(lower)
    ? 'explain'
    : /优化|调整|改造|optimi|improve|design/.test(lower) || mode === 'plan_design'
      ? 'optimize'
      : /监控|持续|monitor/.test(lower)
        ? 'monitor'
        : 'diagnose'

  return {
    schemaVersion: 1,
    objective: text,
    intent,
    mode,
    status: conflicts.length > 0 ? 'conflicted' : missingConstraints.length > 0 ? 'needs_input' : 'compiled',
    baselineVersion: createFactoryVersion(context),
    metrics: {
      targetThroughputPerHour: targetThroughputPerHour ?? undefined,
      targetItemId: targetItem?.id,
      targetItemName: targetItem?.name,
    },
    hardConstraints,
    softConstraints,
    timeHorizonSec: parseHorizon(text) ?? 3600,
    allowedActions: ['inspect', 'explain_constraint', 'update_config', 'move_object', 'add_object', 'remove_object'],
    assumptions: [
      '布局、碰撞、端口连接、物料数量和仿真指标均由本地确定性规则判定。',
      '远程模型（如果启用）只能提出工具选择，不能直接写入工厂状态。',
      '诊断默认使用当前快照；样本不足时会降低置信度。',
    ],
    missingConstraints,
    conflicts,
  }
}

export function buildFactoryGraph(context: AgentFactoryContext): FactoryGraph {
  const baselineVersion = createFactoryVersion(context)
  const nodes: FactoryGraphNode[] = []
  const edges: FactoryGraphEdge[] = []
  const invalidReferences: FactoryGraph['invalidReferences'] = []
  const objectIds = new Set(context.objects.map((object) => object.id))
  const recipeIds = new Set(context.recipes.map((recipe) => recipe.id))
  const itemIds = new Set(context.items.map((item) => item.id))

  context.items.forEach((item) => nodes.push({ id: `item:${item.id}`, kind: 'item', label: item.name, status: 'ok' }))
  context.recipes.forEach((recipe) => nodes.push({ id: `recipe:${recipe.id}`, kind: 'recipe', label: recipe.name, status: 'ok' }))
  context.objects.forEach((object) => nodes.push({
    id: `object:${object.id}`,
    kind: 'object',
    label: object.displayName || getObjectDef(object.type, object.resourceId).label,
    objectType: object.type,
    floorId: object.floorId ?? 1,
    status: 'ok',
  }))

  for (const recipe of context.recipes) {
    recipe.inputs.forEach((port) => {
      if (!itemIds.has(port.itemId)) invalidReferences.push({ code: 'recipe_input_item_missing', message: `配方 ${recipe.name} 引用了不存在的输入物品 ${port.itemId}`, objectIds: [] })
      else edges.push({ id: `recipe-input:${recipe.id}:${port.itemId}`, from: `item:${port.itemId}`, to: `recipe:${recipe.id}`, kind: 'recipe_consumes', label: `×${port.qty}` })
    })
    recipe.outputs.forEach((port) => {
      if (!itemIds.has(port.itemId)) invalidReferences.push({ code: 'recipe_output_item_missing', message: `配方 ${recipe.name} 引用了不存在的输出物品 ${port.itemId}`, objectIds: [] })
      else edges.push({ id: `recipe-output:${recipe.id}:${port.itemId}`, from: `recipe:${recipe.id}`, to: `item:${port.itemId}`, kind: 'recipe_produces', label: `×${port.qty}` })
    })
  }

  for (const object of context.objects) {
    const objectNode = `object:${object.id}`
    if (object.recipeId) {
      if (recipeIds.has(object.recipeId)) edges.push({ id: `binding:${object.id}:${object.recipeId}`, from: `recipe:${object.recipeId}`, to: objectNode, kind: 'machine_binding' })
      else invalidReferences.push({ code: 'object_recipe_missing', message: `${object.id} 绑定了不存在的配方 ${object.recipeId}`, objectIds: [object.id] })
    }
    if (object.itemId) {
      if (itemIds.has(object.itemId)) edges.push({ id: `inventory:${object.id}:${object.itemId}`, from: `item:${object.itemId}`, to: objectNode, kind: 'inventory_holds' })
      else invalidReferences.push({ code: 'object_item_missing', message: `${object.id} 绑定了不存在的物品 ${object.itemId}`, objectIds: [object.id] })
    }
    if ((object.floorId ?? 1) < 1 || (object.floorId ?? 1) > context.floorCount) invalidReferences.push({ code: 'object_floor_missing', message: `${object.id} 位于不存在的楼层 L${object.floorId ?? 1}`, objectIds: [object.id] })
    const program = object.agvProgram
    if (program) {
      for (const ref of [program.sourceObjectId, program.destinationObjectId]) {
        if (ref && !objectIds.has(ref)) invalidReferences.push({ code: 'vehicle_target_missing', message: `${object.id} 的运输任务引用了不存在的对象 ${ref}`, objectIds: [object.id, ref] })
      }
      if (program.itemId && !itemIds.has(program.itemId)) invalidReferences.push({ code: 'vehicle_item_missing', message: `${object.id} 的运输任务引用了不存在的物品 ${program.itemId}`, objectIds: [object.id] })
      if (program.enabled !== false && program.sourceObjectId && program.destinationObjectId
        && objectIds.has(program.sourceObjectId) && objectIds.has(program.destinationObjectId)) {
        edges.push({ id: `vehicle-source:${object.id}:${program.sourceObjectId}`, from: `object:${program.sourceObjectId}`, to: objectNode, kind: 'vehicle_transport', label: program.itemId ?? undefined })
        edges.push({ id: `vehicle-destination:${object.id}:${program.destinationObjectId}`, from: objectNode, to: `object:${program.destinationObjectId}`, kind: 'vehicle_transport', label: program.itemId ?? undefined })
      }
    }
  }

  const connectionEdges = new Set<string>()
  for (const upstream of context.objects) {
    const output = objectCompatiblePortCells(upstream, 'output')
    if (output.length === 0) continue
    for (const downstream of context.objects) {
      if (upstream.id === downstream.id || (upstream.floorId ?? 1) !== (downstream.floorId ?? 1)) continue
      const downstreamCells = new Set([
        ...occupiedCells(downstream).map((cell) => `${cell.x},${cell.z}`),
        ...objectCompatiblePortCells(downstream, 'input').map((cell) => `${cell.x},${cell.z}`),
      ])
      if (!output.some((cell) => downstreamCells.has(`${cell.x},${cell.z}`))) continue
      const kind = isTransportType(upstream.type, upstream.resourceId) || isTransportType(downstream.type, downstream.resourceId)
        ? 'conveyor_transport'
        : 'dependency'
      const key = `${upstream.id}->${downstream.id}`
      if (connectionEdges.has(key)) continue
      connectionEdges.add(key)
      edges.push({ id: `flow:${key}`, from: `object:${upstream.id}`, to: `object:${downstream.id}`, kind })
    }
  }

  for (const node of nodes) {
    if (node.kind !== 'object') continue
    const object = context.objects.find((entry) => `object:${entry.id}` === node.id)
    if (!object) continue
    const connected = edges.some((edge) => (edge.from === node.id || edge.to === node.id) && (edge.kind === 'dependency' || edge.kind === 'conveyor_transport'))
    if (objectRole(object.type, object.resourceId) === 'machine' && !connected) node.status = 'warning'
    if (invalidReferences.some((entry) => entry.objectIds.includes(object.id))) node.status = 'invalid'
  }

  return { schemaVersion: 1, baselineVersion, nodes, edges, invalidReferences }
}

export function analyzeFactory(objective: string, context: AgentFactoryContext, mode: AgentMode = 'diagnose'): AgentAnalysisResult {
  const goal = compileFactoryGoal(objective, context, mode)
  const graph = buildFactoryGraph(context)
  const evidenceSnapshot = context.snapshot.timeSec >= 60 ? context.snapshot : runBranch(context.objects, context.recipes, 60)
  const targetItemId = goal.metrics.targetItemId ?? inferTerminalItemId(context.recipes)
  const metrics = collectMetrics(context.objects, evidenceSnapshot, targetItemId, goal.metrics.targetThroughputPerHour ?? null)
  const findings: AgentFinding[] = []
  const add = (finding: Omit<AgentFinding, 'id'>) => findings.push({ ...finding, id: `finding-${findings.length + 1}-${finding.code}` })
  const objectEdges = (objectId: string, direction: 'in' | 'out') => graph.edges.filter((edge) => {
    if (edge.kind !== 'dependency' && edge.kind !== 'conveyor_transport' && edge.kind !== 'vehicle_transport') return false
    if (direction === 'in') return edge.to === `object:${objectId}` && edge.from.startsWith('object:')
    return edge.from === `object:${objectId}` && edge.to.startsWith('object:')
  })

  for (const invalid of graph.invalidReferences) {
    add({ severity: 'critical', code: invalid.code, title: '工厂图存在无效引用', detail: invalid.message, impact: '该引用无法进入稳定仿真，相关设备或运输任务不会按预期运行。', recommendation: '先修正对象、物品、配方或楼层引用，再重新运行诊断。', objectIds: invalid.objectIds, evidence: [{ kind: 'graph', label: 'INVALID REFERENCE', value: invalid.code, objectIds: invalid.objectIds }] })
  }
  const machines = context.objects.filter((object) => objectRole(object.type, object.resourceId) === 'machine')
  if (context.objects.length > 0 && machines.length === 0) add({ severity: 'warning', code: 'no_machines', title: '没有可运行的生产设备', detail: '当前工厂有对象但没有绑定生产机器。', impact: '不会形成加工产出，吞吐量会保持为零。', recommendation: '添加机器并绑定有效配方，或把当前工厂切换为物流诊断模式。', objectIds: context.objects.map((object) => object.id), evidence: [{ kind: 'metric', label: 'MACHINE COUNT', value: '0' }] })
  for (const machine of machines) {
    const recipe = machine.recipeId ? context.recipes.find((entry) => entry.id === machine.recipeId && entry.enabled !== false) : undefined
    if (!recipe) add({ severity: 'warning', code: machine.recipeId ? 'invalid_recipe_binding' : 'unbound_recipe', title: '设备没有有效配方', detail: `${machine.displayName || machine.id} 未绑定可用配方。`, impact: '设备会占用布局空间但不能消耗输入或产生输出。', recommendation: '选择与该工序匹配的启用配方后，再运行副本验证。', objectIds: [machine.id], evidence: [{ kind: 'object', label: 'MACHINE', value: machine.displayName || machine.id, objectIds: [machine.id] }] })
    if (objectEdges(machine.id, 'in').length === 0 && objectEdges(machine.id, 'out').length === 0) add({ severity: 'warning', code: 'machine_disconnected', title: '设备没有物流连接', detail: `${machine.displayName || machine.id} 在工厂图中没有输入或输出边。`, impact: '即使配方正确，设备也无法稳定获得物料或交付产物。', recommendation: '检查输入/输出端口和相邻传送线，必要时在审批补丁前先定位设备。', objectIds: [machine.id], evidence: [{ kind: 'graph', label: 'FLOW EDGES', value: '0', objectIds: [machine.id] }] })
  }

  const sources = context.objects.filter((object) => (object.type === 'source' || object.type === 'inboundWarehouse') && object.itemId)
  for (const source of sources) {
    const outgoing = objectEdges(source.id, 'out')
    const runtime = evidenceSnapshot.sources.find((entry) => entry.objectId === source.id)
    const vehicleServed = context.objects.some((object) => object.agvProgram?.enabled !== false && object.agvProgram?.sourceObjectId === source.id)
    if (outgoing.length === 0) add({ severity: 'critical', code: 'disconnected_source', title: '供料边界没有有效下游', detail: `${source.displayName || source.id} 没有连到传送线或生产设备。`, impact: '供料会堵塞，后续链路不会获得真实物料。', recommendation: '将供料站输出端连接到有效输入端，随后重新仿真。', objectIds: [source.id], evidence: [{ kind: 'graph', label: 'DOWNSTREAM EDGES', value: '0', objectIds: [source.id] }] })
    if (runtime?.state === 'blocked' && !vehicleServed) add({ severity: 'critical', code: 'blocked_source', title: '供料边界正在堵塞', detail: `${source.displayName || source.id} 当前处于阻塞状态。`, impact: '上游物料无法按完整批次进入生产链。', recommendation: '检查下游满载、货架库存和取放模式；不允许用半载或虚拟物料绕过阻塞。', objectIds: [source.id], evidence: [{ kind: 'runtime', label: 'SOURCE STATE', value: 'blocked', objectIds: [source.id] }, { kind: 'inventory', label: 'ITEM', value: source.itemId ?? '—', objectIds: [source.id] }] })
    const inventory = runtime?.inventory?.[source.itemId!] ?? 0
    if (source.type === 'source' && runtime && runtime.mode !== 'store' && inventory <= 0 && !context.objects.some((entry) => entry.type === 'inboundWarehouse' && entry.itemId === source.itemId)) add({ severity: 'warning', code: 'inventory_shortage', title: '供料库存不足', detail: `${source.displayName || source.id} 的 ${source.itemId} 没有可取库存。`, impact: '运输任务会等待库存，不会凭空补货。', recommendation: '补充对应货架库存或连接真实入货仓库。', objectIds: [source.id], evidence: [{ kind: 'inventory', label: 'AVAILABLE', value: String(inventory), objectIds: [source.id] }] })
  }

  for (const transport of context.objects.filter((object) => isTransportType(object.type, object.resourceId))) {
    if (objectEdges(transport.id, 'in').length === 0 || objectEdges(transport.id, 'out').length === 0) add({ severity: 'warning', code: 'disconnected_conveyor', title: '传送线存在开放端', detail: `${transport.displayName || transport.id} 只有单侧连接或没有有效连接。`, impact: '在途物料可能在末端积压，形成背压。', recommendation: '检查该段方向、拐点和两端端口吸附关系。', objectIds: [transport.id], evidence: [{ kind: 'graph', label: 'IN / OUT', value: `${objectEdges(transport.id, 'in').length} / ${objectEdges(transport.id, 'out').length}`, objectIds: [transport.id] }] })
  }

  const waitingVehicleIds = [...evidenceSnapshot.agvs, ...evidenceSnapshot.drones]
    .filter((vehicle) => vehicle.motionStatus === 'waiting' && vehicle.completedTrips === 0)
    .map((vehicle) => vehicle.objectId)
  if (waitingVehicleIds.length > 0) add({ severity: 'warning', code: 'vehicle_waiting', title: '运输载具正在等待', detail: `${waitingVehicleIds.length} 个 AGV/无人机处于等待状态。`, impact: '跨仓储或跨层物流可能成为实际瓶颈。', recommendation: '检查起终点对象、库存阈值、路径障碍和装卸容量。', objectIds: waitingVehicleIds, evidence: [{ kind: 'runtime', label: 'WAITING VEHICLES', value: String(waitingVehicleIds.length), objectIds: waitingVehicleIds }] })
  if (metrics.utilization >= 90 && metrics.machineCount > 0) add({ severity: 'warning', code: 'high_utilization', title: '生产利用率接近上限', detail: `当前平均利用率为 ${metrics.utilization.toFixed(1)}%。`, impact: '小幅波动就可能放大为排队和交付延迟。', recommendation: '在分支仿真中比较并行设备、缓存或运输策略。', objectIds: machines.map((machine) => machine.id), evidence: [{ kind: 'metric', label: 'UTILIZATION', value: `${metrics.utilization.toFixed(1)}%`, objectIds: machines.map((machine) => machine.id) }] })
  if (metrics.wip > Math.max(6, context.objects.length * 0.7)) add({ severity: 'warning', code: 'wip_accumulation', title: '在途物料堆积', detail: `当前有 ${metrics.wip} 个在途批次。`, impact: '物流节拍低于加工节拍，后续可能出现头堵背压。', recommendation: '检查最慢工序和末端接收容量，不要只增加上游供料。', objectIds: evidenceSnapshot.itemLots.map((lot) => lot.conveyorId), evidence: [{ kind: 'metric', label: 'WIP', value: String(metrics.wip) }] })
  if (goal.metrics.targetThroughputPerHour && metrics.timeSec >= 30 && metrics.throughputPerHour < goal.metrics.targetThroughputPerHour * 0.95) add({ severity: 'warning', code: 'throughput_below_target', title: '实际吞吐低于目标', detail: `当前 ${metrics.throughputPerHour.toFixed(1)}/h，目标 ${goal.metrics.targetThroughputPerHour.toFixed(1)}/h。`, impact: '当前布局或物流配置无法达到目标产能。', recommendation: '先查看瓶颈 Finding，再用受控 Patch 和分支仿真比较方案。', objectIds: [], evidence: [{ kind: 'metric', label: 'THROUGHPUT', value: `${metrics.throughputPerHour.toFixed(1)} / ${goal.metrics.targetThroughputPerHour.toFixed(1)} h` }] })
  if (metrics.timeSec < 59.5) add({ severity: 'info', code: 'short_evidence_window', title: '证据窗口较短', detail: `当前只采集到 ${metrics.timeSec.toFixed(1)} 秒仿真数据。`, impact: '吞吐和利用率可能尚未稳定，结论置信度有限。', recommendation: '继续运行仿真至少 60 秒，再确认优化方案。', objectIds: [], evidence: [{ kind: 'timeline', label: 'TIME HORIZON', value: `${metrics.timeSec.toFixed(1)} s` }] })
  if (findings.length === 0 || findings.every((finding) => finding.severity === 'info')) add({ severity: 'success', code: 'no_blocking_findings', title: '未发现阻塞性问题', detail: '工厂图、运行快照和物料边界目前保持一致。', impact: '当前结构可以继续仿真或进入方案比较。', recommendation: '可运行更长证据窗口，或切换到计划设计模式。', objectIds: [], evidence: [{ kind: 'metric', label: 'BLOCKING FINDINGS', value: '0' }] })

  const criticalCount = findings.filter((finding) => finding.severity === 'critical').length
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length
  const headline = criticalCount > 0 ? `发现 ${criticalCount} 个关键阻塞，需要先修复链路` : warningCount > 0 ? `发现 ${warningCount} 个可优化问题，建议进入分支验证` : '当前工厂没有阻塞性诊断问题'
  const confidence = Math.round(Math.min(1, (metrics.timeSec / 60) * 0.65 + (graph.invalidReferences.length === 0 ? 0.35 : 0)) * 100)
  const toolCalls: AgentToolCall[] = AGENT_TOOL_NAMES.map((name) => ({ name, status: 'completed', summary: toolSummary(name, metrics, graph, findings) }))
  return {
    runId: `run-${Date.now().toString(36)}-${hash(objective).slice(-6)}`,
    createdAt: new Date().toISOString(),
    status: 'completed',
    mode,
    goal,
    graph,
    metrics,
    findings,
    toolCalls,
    headline,
    confidence,
    summary: `${headline}。本次读取 ${metrics.timeSec.toFixed(1)} 秒快照、${graph.nodes.length} 个图节点和 ${graph.edges.length} 条关系边。`,
  }
}

export function buildFactoryPatchProposal(analysis: AgentAnalysisResult, context: AgentFactoryContext): FactoryPatch | null {
  const operations: FactoryPatchOperation[] = []
  const inverseOperations: FactoryPatchOperation[] = []
  const sourceFindingIds: string[] = []
  for (const finding of analysis.findings) {
    if (!['unbound_recipe', 'invalid_recipe_binding'].includes(finding.code)) continue
    const object = context.objects.find((entry) => entry.id === finding.objectIds[0])
    const recipe = chooseRecipeForObject(object, context.recipes)
    if (!object || !recipe || operations.some((operation) => operation.kind === 'update_config' && operation.objectId === object.id && operation.path === 'recipeId')) continue
    const operationId = `op-${operations.length + 1}`
    operations.push({ id: operationId, kind: 'update_config', objectId: object.id, path: 'recipeId', value: recipe.id, reason: `为 ${object.displayName || object.id} 绑定可用配方 ${recipe.name}` })
    inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'update_config', objectId: object.id, path: 'recipeId', value: object.recipeId ?? null, reason: `撤销配方绑定 ${recipe.name}` })
    sourceFindingIds.push(finding.id)
  }
  const requestsLayoutChange = /布局|排列|移动|靠近|缩短|紧凑|rearrange|layout|move|compact|distance/i.test(analysis.goal.objective)
  if (requestsLayoutChange) {
    for (const finding of analysis.findings.filter((entry) => entry.code === 'machine_disconnected')) {
      if (operations.length >= 64) break
      const machine = context.objects.find((entry) => entry.id === finding.objectIds[0])
      if (!machine || operations.some((entry) => entry.kind === 'move_object' && entry.objectId === machine.id)) continue
      const target = findConnectedMachinePosition(machine, context.objects, context.recipes)
      if (!target || (target.x === machine.pos.x && target.z === machine.pos.z)) continue
      const operationId = `op-${operations.length + 1}`
      operations.push({ id: operationId, kind: 'move_object', objectId: machine.id, target, reason: `将 ${machine.displayName || machine.id} 移到最近的兼容供料接口，缩短运输距离并恢复链路` })
      inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'move_object', objectId: machine.id, target: { ...machine.pos }, reason: `恢复 ${machine.displayName || machine.id} 的原始位置` })
      sourceFindingIds.push(finding.id)
    }
  }
  for (const finding of analysis.findings.filter((entry) => entry.code === 'disconnected_conveyor')) {
    if (operations.length >= 64) break
    const conveyor = context.objects.find((entry) => entry.id === finding.objectIds[0])
    if (!conveyor || !isTransportType(conveyor.type, conveyor.resourceId)) continue
    const overlappingSource = context.objects.find((entry) => entry.type === 'source' && cellsIntersect(occupiedCells(entry), occupiedCells(conveyor)))
    if (overlappingSource) {
      const placement = findSourcePositionForConveyor(overlappingSource, conveyor, context.objects)
      if (placement) {
        if (placement.rotation !== overlappingSource.rotation) {
          const rotationId = `op-${operations.length + 1}`
          operations.push({ id: rotationId, kind: 'update_config', objectId: overlappingSource.id, path: 'rotation', value: placement.rotation, reason: `旋转 ${overlappingSource.displayName || overlappingSource.id}，使旧存档仓储接口对准传送线` })
          inverseOperations.unshift({ id: `inverse-${rotationId}`, kind: 'update_config', objectId: overlappingSource.id, path: 'rotation', value: overlappingSource.rotation, reason: `恢复 ${overlappingSource.displayName || overlappingSource.id} 的原方向` })
        }
        const moveId = `op-${operations.length + 1}`
        operations.push({ id: moveId, kind: 'move_object', objectId: overlappingSource.id, target: placement.pos, reason: `将 ${overlappingSource.displayName || overlappingSource.id} 移出被覆盖的传送线并重新接入首段` })
        inverseOperations.unshift({ id: `inverse-${moveId}`, kind: 'move_object', objectId: overlappingSource.id, target: { ...overlappingSource.pos }, reason: `恢复 ${overlappingSource.displayName || overlappingSource.id} 的原位置` })
        sourceFindingIds.push(finding.id)
        continue
      }
    }
    const currentScore = conveyorConnectionScore(conveyor, context.objects)
    const reversedBoundary = context.objects.find((entry) => (entry.type === 'source' || entry.type === 'inboundWarehouse') && objectsAreFlowConnected(conveyor, entry))
    const boundaryRotation = reversedBoundary
      ? ([0, 90, 180, 270] as Rotation[]).find((rotation) => objectsAreFlowConnected(reversedBoundary, { ...conveyor, rotation }))
      : undefined
    const best = ([0, 90, 180, 270] as Rotation[])
      .map((rotation) => ({ rotation, score: conveyorConnectionScore({ ...conveyor, rotation }, context.objects) }))
      .sort((left, right) => right.score - left.score)[0]
    const repairRotation = boundaryRotation ?? (best && best.score > currentScore ? best.rotation : undefined)
    if (repairRotation === undefined || repairRotation === conveyor.rotation) continue
    const operationId = `op-${operations.length + 1}`
    operations.push({ id: operationId, kind: 'update_config', objectId: conveyor.id, path: 'rotation', value: repairRotation, reason: `旋转 ${conveyor.displayName || conveyor.id}，恢复传送带输入/输出吸附` })
    inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'update_config', objectId: conveyor.id, path: 'rotation', value: conveyor.rotation, reason: `恢复 ${conveyor.displayName || conveyor.id} 的原始方向` })
    sourceFindingIds.push(finding.id)
  }
  for (const finding of analysis.findings.filter((entry) => entry.code === 'vehicle_waiting')) {
    for (const objectId of finding.objectIds) {
      if (operations.length >= 64) break
      const vehicle = context.objects.find((entry) => entry.id === objectId)
      const program = vehicle?.agvProgram
      if (!vehicle || !program?.enabled || (program.loadQuantity ?? 1) <= 1) continue
      const operationId = `op-${operations.length + 1}`
      const nextProgram = { ...program, loadQuantity: 1 }
      operations.push({ id: operationId, kind: 'update_config', objectId: vehicle.id, path: 'agvProgram', value: nextProgram, reason: `将 ${vehicle.displayName || vehicle.id} 的完整单趟批量降为 1，避免大批量库存门槛导致持续等待` })
      inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'update_config', objectId: vehicle.id, path: 'agvProgram', value: program, reason: `恢复 ${vehicle.displayName || vehicle.id} 的原运输批量` })
      sourceFindingIds.push(finding.id)
    }
  }
  for (const finding of analysis.findings.filter((entry) => entry.code === 'blocked_source')) {
    if (operations.length >= 64) break
    const source = context.objects.find((entry) => entry.id === finding.objectIds[0])
    if (!source || (source.type !== 'source' && source.type !== 'inboundWarehouse')) continue
    const interval = recommendedSourceInterval(source, context.objects, context.recipes)
    const currentProgram = source.stationProgram
    if (currentProgram && currentProgram.mode === 'pickup' && currentProgram.transferIntervalSec >= interval) continue
    const nextProgram = {
      mode: 'pickup' as const,
      transferIntervalSec: interval,
      rackAssignments: currentProgram?.rackAssignments ?? {},
    }
    const operationId = `op-${operations.length + 1}`
    operations.push({ id: operationId, kind: 'update_config', objectId: source.id, path: 'stationProgram', value: nextProgram, reason: `将 ${source.displayName || source.id} 的供料周期调整为 ${interval} 秒，按下游加工节拍抑制满线背压` })
    inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'update_config', objectId: source.id, path: 'stationProgram', value: currentProgram ?? null, reason: `恢复 ${source.displayName || source.id} 的原供料程序` })
    sourceFindingIds.push(finding.id)
  }
  const plannedObjects = context.objects.map((entry) => ({ ...entry, pos: { ...entry.pos } }))
  for (const operation of operations) {
    if (operation.kind === 'move_object') {
      const object = plannedObjects.find((entry) => entry.id === operation.objectId)
      if (object) object.pos = { ...operation.target }
    } else if (operation.kind === 'update_config' && operation.path === 'rotation') {
      const object = plannedObjects.find((entry) => entry.id === operation.objectId)
      if (object) object.rotation = operation.value as Rotation
    } else if (operation.kind === 'add_object') plannedObjects.push(operation.object)
  }
  const rotatedConveyors = new Set(operations.flatMap((entry) => entry.kind === 'update_config' && entry.path === 'rotation' ? [entry.objectId] : []))
  for (const finding of analysis.findings.filter((entry) => entry.code === 'disconnected_conveyor')) {
    if (operations.length >= 64 || rotatedConveyors.has(finding.objectIds[0])) continue
    const conveyor = plannedObjects.find((entry) => entry.id === finding.objectIds[0])
    if (!conveyor) continue
    const counts = finding.evidence.find((entry) => entry.label === 'IN / OUT')?.value.match(/(\d+)\s*\/\s*(\d+)/)
    const missingInput = !counts || Number(counts[1]) === 0
    const missingOutput = !counts || Number(counts[2]) === 0
    let route: Array<{ x: number; z: number; rotation: Rotation }> | null = null
    if (missingInput) {
      const upstreamCandidates = plannedObjects
        .filter((entry) => entry.id !== conveyor.id && (entry.floorId ?? 1) === (conveyor.floorId ?? 1))
        .filter((entry) => entry.type === 'source' || entry.type === 'inboundWarehouse' || objectCompatiblePortCells(entry, 'output').length > 0)
        .filter((entry) => !objectsAreFlowConnected(conveyor, entry))
        .sort((left, right) => {
          const leftBoundary = left.type === 'source' || left.type === 'inboundWarehouse' ? 0 : 1
          const rightBoundary = right.type === 'source' || right.type === 'inboundWarehouse' ? 0 : 1
          return leftBoundary - rightBoundary || distance(left.pos, conveyor.pos) - distance(right.pos, conveyor.pos)
        })
      for (const upstream of upstreamCandidates) {
        route = findConveyorRouteBetween(upstream, conveyor, plannedObjects)
        if (route) break
      }
    }
    if (!route && missingOutput) {
      const downstreamCandidates = plannedObjects
        .filter((entry) => entry.id !== conveyor.id && (entry.floorId ?? 1) === (conveyor.floorId ?? 1))
        .filter((entry) => objectRole(entry.type, entry.resourceId) === 'machine' || entry.type === 'outboundWarehouse')
        .filter((entry) => !objectsAreFlowConnected(entry, conveyor))
        .sort((left, right) => distance(left.pos, conveyor.pos) - distance(right.pos, conveyor.pos))
      for (const downstream of downstreamCandidates) {
        route = findConveyorRouteBetween(conveyor, downstream, plannedObjects)
        if (route) break
      }
    }
    if (!route || route.length === 0 || operations.length + route.length > 64) continue
    appendConveyorRoute(route, conveyor, finding, operations, inverseOperations, plannedObjects)
    sourceFindingIds.push(finding.id)
  }
  for (const finding of analysis.findings.filter((entry) => entry.code === 'disconnected_source')) {
    if (operations.length >= 64) break
    const source = plannedObjects.find((entry) => entry.id === finding.objectIds[0])
    if (!source) continue
    if (requestsLayoutChange) {
      const target = findConnectedSourcePosition(source, plannedObjects, context.recipes)
      if (target && (target.pos.x !== source.pos.x || target.pos.z !== source.pos.z || target.rotation !== source.rotation)) {
        if (target.rotation !== source.rotation) {
          const rotationId = `op-${operations.length + 1}`
          operations.push({ id: rotationId, kind: 'update_config', objectId: source.id, path: 'rotation', value: target.rotation, reason: `旋转 ${source.displayName || source.id}，使输出端对准兼容机器输入端` })
          inverseOperations.unshift({ id: `inverse-${rotationId}`, kind: 'update_config', objectId: source.id, path: 'rotation', value: source.rotation, reason: `恢复 ${source.displayName || source.id} 的原始方向` })
        }
        const operationId = `op-${operations.length + 1}`
        operations.push({ id: operationId, kind: 'move_object', objectId: source.id, target: target.pos, reason: `将 ${source.displayName || source.id} 移到最近的兼容生产输入端，避免高密度场景中的超长补线` })
        inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'move_object', objectId: source.id, target: { ...source.pos }, reason: `恢复 ${source.displayName || source.id} 的原始位置` })
        source.pos = { ...target.pos }
        source.rotation = target.rotation
        sourceFindingIds.push(finding.id)
        continue
      }
    }
    const route = findConveyorRouteFromSource(source, plannedObjects, context.recipes)
    if (!route || route.length === 0 || operations.length + route.length > 64) {
      const target = findConnectedSourcePosition(source, plannedObjects, context.recipes)
      if (!target || (target.pos.x === source.pos.x && target.pos.z === source.pos.z && target.rotation === source.rotation)) continue
      if (target.rotation !== source.rotation) {
        const rotationId = `op-${operations.length + 1}`
        operations.push({ id: rotationId, kind: 'update_config', objectId: source.id, path: 'rotation', value: target.rotation, reason: `旋转 ${source.displayName || source.id}，使输出端对准兼容机器输入端` })
        inverseOperations.unshift({ id: `inverse-${rotationId}`, kind: 'update_config', objectId: source.id, path: 'rotation', value: source.rotation, reason: `恢复 ${source.displayName || source.id} 的原始方向` })
      }
      const operationId = `op-${operations.length + 1}`
      operations.push({ id: operationId, kind: 'move_object', objectId: source.id, target: target.pos, reason: `移动 ${source.displayName || source.id} 到可连接位置，替代超出 Patch 上限或无通路的补线` })
      inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'move_object', objectId: source.id, target: { ...source.pos }, reason: `恢复 ${source.displayName || source.id} 的原始位置` })
      source.pos = { ...target.pos }
      source.rotation = target.rotation
      sourceFindingIds.push(finding.id)
      continue
    }
    appendConveyorRoute(route, source, finding, operations, inverseOperations, plannedObjects)
    sourceFindingIds.push(finding.id)
  }
  for (const finding of analysis.findings.filter((entry) => entry.code === 'inventory_shortage')) {
    if (operations.length >= 64) break
    const source = context.objects.find((entry) => entry.id === finding.objectIds[0])
    if (!source?.itemId || plannedObjects.some((entry) => entry.type === 'inboundWarehouse' && entry.itemId === source.itemId)) continue
    const pos = findFreePositionNear(source, 'inboundWarehouse', plannedObjects)
    if (!pos) continue
    const operationId = `op-${operations.length + 1}`
    const warehouse: FactoryObject = {
      id: `agent-inbound-${hash(`${source.id}:${source.itemId}`).slice(-8)}`,
      type: 'inboundWarehouse',
      pos,
      rotation: source.rotation,
      floorId: source.floorId ?? 1,
      itemId: source.itemId,
      displayName: `${source.itemId} 入货仓库`,
    }
    operations.push({ id: operationId, kind: 'add_object', object: warehouse, reason: `为 ${source.itemId} 增加真实入货边界，修复零库存供料` })
    inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'remove_object', objectId: warehouse.id, reason: `移除新增的 ${source.itemId} 入货仓库` })
    plannedObjects.push(warehouse)
    sourceFindingIds.push(finding.id)
  }
  if (operations.length === 0) return null
  return {
    id: `patch-${Date.now().toString(36)}`,
    status: 'draft',
    baseVersion: analysis.goal.baselineVersion,
    createdAt: new Date().toISOString(),
    operations,
    inverseOperations,
    preconditions: ['当前工厂版本必须与诊断基线一致', '所有目标对象仍然存在', '目标配方必须处于启用状态'],
    diffSummary: operations.map((operation) => {
      const target = operation.kind === 'add_object' ? operation.object.id : operation.objectId
      return `${target}：${operation.kind === 'update_config' ? `${operation.path} ← ${String(operation.value)}` : operation.kind}`
    }),
    risk: operations.some((operation) => operation.kind === 'move_object' || operation.kind === 'add_object' || operation.kind === 'remove_object') ? 'medium' : 'low',
    sourceFindingIds,
  }
}

function recommendedSourceInterval(source: FactoryObject, objects: FactoryObject[], recipes: Recipe[]): number {
  const compatibleDurations = objects
    .filter((entry) => (entry.floorId ?? 1) === (source.floorId ?? 1) && objectRole(entry.type, entry.resourceId) === 'machine')
    .flatMap((entry) => recipes.filter((recipe) => recipe.id === entry.recipeId && (!source.itemId || recipe.inputs.some((input) => input.itemId === source.itemId))).map((recipe) => recipe.durationSec))
    .filter((duration) => Number.isFinite(duration) && duration > 0)
  return Math.max(2, Math.min(60, compatibleDurations.length > 0 ? Math.min(...compatibleDurations) : 6))
}

function cellsIntersect(left: Array<{ x: number; z: number }>, right: Array<{ x: number; z: number }>): boolean {
  const keys = new Set(left.map((cell) => cellKey(cell.x, cell.z)))
  return right.some((cell) => keys.has(cellKey(cell.x, cell.z)))
}

function findSourcePositionForConveyor(source: FactoryObject, conveyor: FactoryObject, objects: FactoryObject[]): { pos: { x: number; z: number }; rotation: Rotation } | null {
  const others = objects.filter((entry) => entry.id !== source.id && (entry.floorId ?? 1) === (source.floorId ?? 1))
  const targetCells = new Set([...occupiedCells(conveyor), ...objectCompatiblePortCells(conveyor, 'input')].map((cell) => cellKey(cell.x, cell.z)))
  for (let radius = 1; radius <= 12; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
      const pos = { x: conveyor.pos.x + dx, z: conveyor.pos.z + dz }
      for (const rotation of [source.rotation, 0, 90, 180, 270] as Rotation[]) {
        if (!canPlace(pos, source.type, rotation, others, source.resourceId)) continue
        const moved = { ...source, pos, rotation }
        if (objectCompatiblePortCells(moved, 'output').some((cell) => targetCells.has(cellKey(cell.x, cell.z)))) return { pos, rotation }
      }
    }
  }
  return null
}

function objectsAreFlowConnected(upstream: FactoryObject, downstream: FactoryObject): boolean {
  const downstreamCells = new Set([...occupiedCells(downstream), ...objectCompatiblePortCells(downstream, 'input')].map((cell) => cellKey(cell.x, cell.z)))
  return objectCompatiblePortCells(upstream, 'output').some((cell) => downstreamCells.has(cellKey(cell.x, cell.z)))
}

function findConnectedSourcePosition(source: FactoryObject, objects: FactoryObject[], recipes: Recipe[]): { pos: { x: number; z: number }; rotation: Rotation } | null {
  const targets = objects
    .filter((entry) => entry.id !== source.id && (entry.floorId ?? 1) === (source.floorId ?? 1) && objectRole(entry.type, entry.resourceId) === 'machine')
    .filter((entry) => {
      if (!source.itemId) return true
      const recipe = recipes.find((candidate) => candidate.id === entry.recipeId)
      return !recipe || recipe.inputs.some((input) => input.itemId === source.itemId)
    })
    .sort((left, right) => distance(left.pos, source.pos) - distance(right.pos, source.pos))
  const others = objects.filter((entry) => entry.id !== source.id && (entry.floorId ?? 1) === (source.floorId ?? 1))
  for (const target of targets) {
    const targetInputs = new Set([...occupiedCells(target), ...objectCompatiblePortCells(target, 'input')].map((cell) => cellKey(cell.x, cell.z)))
    for (let radius = 1; radius <= 10; radius += 1) {
      const candidates: Array<{ x: number; z: number }> = []
      for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === radius) candidates.push({ x: target.pos.x + dx, z: target.pos.z + dz })
      }
      candidates.sort((left, right) => distance(left, source.pos) - distance(right, source.pos))
      for (const pos of candidates) for (const rotation of [source.rotation, 0, 90, 180, 270] as Rotation[]) {
        if (!canPlace(pos, source.type, rotation, others, source.resourceId)) continue
        const moved = { ...source, pos, rotation }
        if (objectCompatiblePortCells(moved, 'output').some((cell) => targetInputs.has(cellKey(cell.x, cell.z)))) return { pos, rotation }
      }
    }
  }
  return null
}

function appendConveyorRoute(
  route: Array<{ x: number; z: number; rotation: Rotation }>,
  anchor: FactoryObject,
  finding: AgentFinding,
  operations: FactoryPatchOperation[],
  inverseOperations: FactoryPatchOperation[],
  plannedObjects: FactoryObject[],
): void {
  route.forEach((segment, index) => {
    const operationId = `op-${operations.length + 1}`
    const conveyor: FactoryObject = {
      id: `agent-route-${hash(`${anchor.id}:${finding.id}:${segment.x}:${segment.z}:${index}`).slice(-10)}`,
      type: 'conveyor', pos: { x: segment.x, z: segment.z }, rotation: segment.rotation, floorId: anchor.floorId ?? 1,
    }
    operations.push({ id: operationId, kind: 'add_object', object: conveyor, reason: `补齐 ${anchor.displayName || anchor.id} 的开放端物流连接` })
    inverseOperations.unshift({ id: `inverse-${operationId}`, kind: 'remove_object', objectId: conveyor.id, reason: `移除为 ${anchor.displayName || anchor.id} 新增的传送带` })
    plannedObjects.push(conveyor)
  })
}

function conveyorConnectionScore(conveyor: FactoryObject, objects: FactoryObject[]): number {
  const sameFloor = objects.filter((entry) => entry.id !== conveyor.id && (entry.floorId ?? 1) === (conveyor.floorId ?? 1))
  const inputCells = new Set([...occupiedCells(conveyor), ...objectCompatiblePortCells(conveyor, 'input')].map((cell) => cellKey(cell.x, cell.z)))
  const outputCells = objectCompatiblePortCells(conveyor, 'output')
  const incoming = sameFloor.filter((entry) => objectCompatiblePortCells(entry, 'output').some((cell) => inputCells.has(cellKey(cell.x, cell.z)))).length
  const outgoing = sameFloor.filter((entry) => {
    const target = new Set([...occupiedCells(entry), ...objectCompatiblePortCells(entry, 'input')].map((cell) => cellKey(cell.x, cell.z)))
    return outputCells.some((cell) => target.has(cellKey(cell.x, cell.z)))
  }).length
  return (incoming > 0 ? 4 : 0) + (outgoing > 0 ? 4 : 0) + Math.min(incoming, 3) + Math.min(outgoing, 3)
}

function findConveyorRouteFromSource(source: FactoryObject, objects: FactoryObject[], recipes: Recipe[]): Array<{ x: number; z: number; rotation: FactoryObject['rotation'] }> | null {
  const sameFloor = objects.filter((entry) => (entry.floorId ?? 1) === (source.floorId ?? 1))
  const targets = sameFloor
    .filter((entry) => objectRole(entry.type, entry.resourceId) === 'machine')
    .filter((entry) => {
      if (!source.itemId) return true
      const recipe = recipes.find((candidate) => candidate.id === entry.recipeId)
      return !recipe || recipe.inputs.some((input) => input.itemId === source.itemId)
    })
    .sort((left, right) => distance(left.pos, source.pos) - distance(right.pos, source.pos))
  if (objectCompatiblePortCells(source, 'output').length === 0 || targets.length === 0) return null
  let best: Array<{ x: number; z: number }> | null = null
  let bestTarget = targets[0]
  for (const target of targets) {
    const route = findConveyorRouteBetween(source, target, objects)
    if (route && (!best || route.length < best.length)) {
      best = route.map(({ x, z }) => ({ x, z }))
      bestTarget = target
    }
  }
  if (!best) return null
  const targetCells = occupiedCells(bestTarget)
  return best.map((cell, index) => {
    const next = best![index + 1] ?? targetCells
      .filter((candidate) => Math.abs(candidate.x - cell.x) + Math.abs(candidate.z - cell.z) === 1)[0]
    if (!next) return { ...cell, rotation: 0 as const }
    return { ...cell, rotation: dirToRotation({ dx: next.x - cell.x, dz: next.z - cell.z }) }
  })
}

function findConveyorRouteBetween(from: FactoryObject, to: FactoryObject, objects: FactoryObject[]): Array<{ x: number; z: number; rotation: Rotation }> | null {
  const sameFloor = objects.filter((entry) => (entry.floorId ?? 1) === (from.floorId ?? 1))
  const blocked = new Set(sameFloor.flatMap(occupiedCells).map((cell) => cellKey(cell.x, cell.z)))
  let best: Array<{ x: number; z: number }> | null = null
  for (const start of objectCompatiblePortCells(from, 'output')) for (const goal of objectCompatiblePortCells(to, 'input')) {
    const path = findAgentGridPath(start, goal, blocked)
    if (path && (!best || path.length < best.length)) best = path
  }
  if (!best) return null
  const targetCells = occupiedCells(to)
  return best.map((cell, index) => {
    const next = best![index + 1] ?? targetCells.find((candidate) => Math.abs(candidate.x - cell.x) + Math.abs(candidate.z - cell.z) === 1)
    return { ...cell, rotation: next ? dirToRotation({ dx: next.x - cell.x, dz: next.z - cell.z }) : 0 }
  })
}

function findAgentGridPath(start: { x: number; z: number }, goal: { x: number; z: number }, blocked: Set<string>): Array<{ x: number; z: number }> | null {
  const startKey = cellKey(start.x, start.z)
  const goalKey = cellKey(goal.x, goal.z)
  if (blocked.has(startKey) || blocked.has(goalKey)) return null
  const queue = [start]
  const parent = new Map<string, string | null>([[startKey, null]])
  const cells = new Map<string, { x: number; z: number }>([[startKey, start]])
  while (queue.length > 0) {
    const current = queue.shift()!
    const currentKey = cellKey(current.x, current.z)
    if (currentKey === goalKey) {
      const path: Array<{ x: number; z: number }> = []
      let key: string | null = currentKey
      while (key) {
        path.unshift(cells.get(key)!)
        key = parent.get(key) ?? null
      }
      return path
    }
    const directions = [...CARDINALS].sort((left, right) => {
      const leftDistance = Math.abs(current.x + left.dx - goal.x) + Math.abs(current.z + left.dz - goal.z)
      const rightDistance = Math.abs(current.x + right.dx - goal.x) + Math.abs(current.z + right.dz - goal.z)
      return leftDistance - rightDistance
    })
    for (const direction of directions) {
      const next = { x: current.x + direction.dx, z: current.z + direction.dz }
      if (next.x < -BUILD_BOUND || next.x > BUILD_BOUND || next.z < -BUILD_BOUND || next.z > BUILD_BOUND) continue
      const nextKey = cellKey(next.x, next.z)
      if (blocked.has(nextKey) || parent.has(nextKey)) continue
      parent.set(nextKey, currentKey)
      cells.set(nextKey, next)
      queue.push(next)
    }
  }
  return null
}

function findConnectedMachinePosition(machine: FactoryObject, objects: FactoryObject[], recipes: Recipe[]): { x: number; z: number } | null {
  const recipe = recipes.find((entry) => entry.id === machine.recipeId) ?? chooseRecipeForObject(machine, recipes)
  const inputIds = new Set(recipe?.inputs.map((entry) => entry.itemId) ?? [])
  const suppliers = objects
    .filter((entry) => entry.id !== machine.id
      && (entry.floorId ?? 1) === (machine.floorId ?? 1)
      && (entry.type === 'source'
        || entry.type === 'inboundWarehouse'
        || objectCompatiblePortCells(entry, 'output').length > 0)
      && (inputIds.size === 0 || !entry.itemId || inputIds.has(entry.itemId)))
    .sort((left, right) => distance(left.pos, machine.pos) - distance(right.pos, machine.pos))
  const others = objects.filter((entry) => entry.id !== machine.id && (entry.floorId ?? 1) === (machine.floorId ?? 1))
  for (const supplier of suppliers) {
    const outputs = objectCompatiblePortCells(supplier, 'output')
    const anchors = outputs.length > 0 ? outputs : [{ x: supplier.pos.x, z: supplier.pos.z }]
    for (const output of anchors) {
      let nearestLegal: { x: number; z: number } | null = null
      const candidates: Array<{ x: number; z: number }> = []
      for (let radius = 0; radius <= 8; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
          if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
          candidates.push({ x: output.x + dx, z: output.z + dz })
        }
      }
      candidates.sort((left, right) => distance(left, output) - distance(right, output) || distance(left, machine.pos) - distance(right, machine.pos))
      for (const target of candidates) {
        if (!canPlace(target, machine.type, machine.rotation, others, machine.resourceId)) continue
        nearestLegal ??= target
        const moved = { ...machine, pos: target }
        const contact = new Set([...occupiedCells(moved), ...objectCompatiblePortCells(moved, 'input')].map((cell) => `${cell.x},${cell.z}`))
        if (contact.has(`${output.x},${output.z}`)) return target
      }
      if (nearestLegal) return nearestLegal
    }
  }
  return null
}

function findFreePositionNear(source: FactoryObject, type: FactoryObject['type'], objects: FactoryObject[]): { x: number; z: number } | null {
  const sameFloor = objects.filter((entry) => (entry.floorId ?? 1) === (source.floorId ?? 1))
  for (let radius = 2; radius <= 14; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
      const pos = { x: source.pos.x + dx, z: source.pos.z + dz }
      if (canPlace(pos, type, source.rotation, sameFloor)) return pos
    }
  }
  return null
}

function distance(left: { x: number; z: number }, right: { x: number; z: number }): number {
  return Math.hypot(left.x - right.x, left.z - right.z)
}

export function validateFactoryPatch(patch: FactoryPatch, context: AgentFactoryContext): string[] {
  const errors: string[] = []
  if (patch.baseVersion !== createFactoryVersion(context)) errors.push('工厂已发生变化，请重新运行诊断后再应用补丁。')
  if (patch.operations.length === 0 || patch.operations.length > 64) errors.push('补丁操作数量必须为 1–64。')
  const working = context.objects.map((object) => ({ ...object, pos: { ...object.pos } }))
  for (const operation of patch.operations) {
    if (operation.kind === 'update_config') {
      const object = working.find((entry) => entry.id === operation.objectId)
      if (!object) errors.push(`目标对象不存在：${operation.objectId}`)
      if (operation.path === 'recipeId' && typeof operation.value === 'string' && !context.recipes.some((recipe) => recipe.id === operation.value && recipe.enabled !== false)) errors.push(`目标配方不可用：${String(operation.value)}`)
      if (object && operation.path === 'rotation') {
        if (![0, 90, 180, 270].includes(operation.value as number)) errors.push(`传送带方向非法：${operation.objectId}`)
        else object.rotation = operation.value as Rotation
      }
    } else if (operation.kind === 'move_object') {
      const object = working.find((entry) => entry.id === operation.objectId)
      if (!object) { errors.push(`目标对象不存在：${operation.objectId}`); continue }
      const others = working.filter((entry) => entry.id !== operation.objectId && (entry.floorId ?? 1) === (object.floorId ?? 1))
      if (!canPlace(operation.target, object.type, object.rotation, others, object.resourceId)) errors.push(`移动后位置碰撞或越界：${operation.objectId}`)
      else object.pos = { ...operation.target }
    } else if (operation.kind === 'add_object') {
      if (working.some((entry) => entry.id === operation.object.id)) errors.push(`新增对象 id 重复：${operation.object.id}`)
      else if (!canPlace(operation.object.pos, operation.object.type, operation.object.rotation, working.filter((entry) => (entry.floorId ?? 1) === (operation.object.floorId ?? 1)), operation.object.resourceId)) errors.push(`新增对象位置碰撞或越界：${operation.object.id}`)
      else working.push(operation.object)
    } else if (operation.kind === 'remove_object' && !working.some((entry) => entry.id === operation.objectId)) errors.push(`待删除对象不存在：${operation.objectId}`)
  }
  return errors
}

export function applyFactoryPatchToSave(save: FactorySave, patch: FactoryPatch): FactorySave {
  let objects = save.objects.map((object) => ({ ...object, pos: { ...object.pos } }))
  for (const operation of patch.operations) {
    if (operation.kind === 'update_config') objects = objects.map((object) => {
      if (object.id !== operation.objectId) return object
      const next = { ...object }
      const mutable = next as unknown as Record<string, unknown>
      if (operation.value === null) delete mutable[operation.path]
      else mutable[operation.path] = operation.value
      return next
    })
    if (operation.kind === 'move_object') objects = objects.map((object) => object.id === operation.objectId ? { ...object, pos: { ...operation.target } } : object)
    if (operation.kind === 'add_object' && !objects.some((object) => object.id === operation.object.id)) objects.push({ ...operation.object, pos: { ...operation.object.pos } })
    if (operation.kind === 'remove_object') objects = objects.filter((object) => object.id !== operation.objectId)
  }
  return { ...save, objects }
}

export function simulateFactoryBranch(patch: FactoryPatch, context: AgentFactoryContext, horizonSec = 60): BranchSimulationResult {
  const save: FactorySave = { version: 6, name: 'branch', floorCount: context.floorCount, floorNames: [], objects: context.objects, items: context.items, recipes: context.recipes, machineDefinitions: [] }
  const proposal = applyFactoryPatchToSave(save, patch)
  const targetItemId = inferTerminalItemId(context.recipes)
  const baselineSnapshot = runBranch(context.objects, context.recipes, horizonSec)
  const proposalSnapshot = runBranch(proposal.objects, proposal.recipes, horizonSec)
  const baseline = collectMetrics(context.objects, baselineSnapshot, targetItemId, null)
  const proposed = collectMetrics(proposal.objects, proposalSnapshot, targetItemId, null)
  const delta = {
    throughputPerHour: proposed.throughputPerHour - baseline.throughputPerHour,
    utilization: proposed.utilization - baseline.utilization,
    wip: proposed.wip - baseline.wip,
    blockedObjects: proposed.blockedObjects - baseline.blockedObjects,
    produced: proposed.produced - baseline.produced,
    averageTransportSec: proposed.averageTransportSec - baseline.averageTransportSec,
    inventoryTotal: proposed.inventoryTotal - baseline.inventoryTotal,
  }
  const recommendation = delta.throughputPerHour > 0.5 && delta.blockedObjects <= 0 ? 'apply' : delta.throughputPerHour >= -0.5 && delta.blockedObjects <= 0 ? 'iterate' : 'discard'
  return {
    baseline,
    proposal: proposed,
    delta,
    recommendation,
    explanation: recommendation === 'apply' ? '分支仿真显示吞吐提高且没有新增阻塞，可进入审批。' : recommendation === 'iterate' ? '分支仿真没有明显恶化，但收益不足，建议继续调整。' : '分支仿真没有带来足够收益或增加了阻塞，不建议应用。',
  }
}

function collectMetrics(objects: FactoryObject[], snapshot: SimulationSnapshot, targetItemId: string | undefined, targetThroughputPerHour: number | null): AgentMetrics {
  const machines = objects.filter((object) => objectRole(object.type, object.resourceId) === 'machine')
  const activeMachines = snapshot.machines.filter((machine) => machine.state === 'processing' || machine.state === 'output').length
  const produced = targetItemId ? snapshot.stats.produced[targetItemId] ?? 0 : sumRecord(snapshot.stats.produced)
  const consumed = sumRecord(snapshot.stats.consumed)
  return {
    timeSec: snapshot.timeSec,
    throughputPerHour: snapshot.timeSec > 0 ? produced / snapshot.timeSec * 3600 : 0,
    targetThroughputPerHour,
    utilization: machines.length > 0 && snapshot.timeSec > 0 ? Math.min(100, snapshot.machines.reduce((sum, machine) => sum + machine.processingTime, 0) / machines.length / snapshot.timeSec * 100) : 0,
    wip: snapshot.itemLots.length,
    activeMachines,
    machineCount: machines.length,
    blockedObjects: snapshot.sources.filter((source) => source.state === 'blocked').length + snapshot.agvs.filter((vehicle) => vehicle.motionStatus === 'waiting').length + snapshot.drones.filter((vehicle) => vehicle.motionStatus === 'waiting').length,
    waitingVehicles: snapshot.agvs.filter((vehicle) => vehicle.motionStatus === 'waiting').length + snapshot.drones.filter((vehicle) => vehicle.motionStatus === 'waiting').length,
    consumed,
    produced,
    averageTransportSec: 0,
    inventoryTotal: snapshot.itemLots.length,
  }
}

function runBranch(objects: FactoryObject[], recipes: Recipe[], horizonSec: number): SimulationSnapshot {
  const engine = new SimulationEngine(20260821)
  engine.init(objects, recipes)
  engine.advance(Math.max(0, horizonSec))
  return engine.getSnapshot()
}

function chooseRecipeForObject(object: FactoryObject | undefined, recipes: Recipe[]): Recipe | undefined {
  if (!object) return undefined
  const enabled = recipes.filter((recipe) => recipe.enabled !== false)
  if (enabled.length === 0) return undefined
  if (object.type === 'inspection') return enabled.find((recipe) => /检|inspect|inspection/i.test(`${recipe.id} ${recipe.name}`)) ?? enabled[0]
  if (object.type === 'assembler') return enabled.find((recipe) => recipe.inputs.length > 1) ?? enabled[0]
  return enabled.find((recipe) => recipe.inputs.length === 1) ?? enabled[0]
}

function inferTargetItem(text: string, context: AgentFactoryContext) {
  const lower = text.toLowerCase()
  return context.items.find((item) => lower.includes(item.name.toLowerCase()) || lower.includes(item.id.toLowerCase())) ?? context.items.find((item) => item.category === 'product' && context.recipes.some((recipe) => recipe.outputs.some((output) => output.itemId === item.id))) ?? context.items[context.items.length - 1]
}

function inferTerminalItemId(recipes: Recipe[]): string | undefined {
  const consumed = new Set(recipes.flatMap((recipe) => recipe.inputs.map((input) => input.itemId)))
  return recipes.flatMap((recipe) => recipe.outputs.map((output) => output.itemId)).find((itemId) => !consumed.has(itemId)) ?? recipes[recipes.length - 1]?.outputs[0]?.itemId
}

function parseThroughput(text: string): number | null {
  const perHour = text.match(/每小时[^0-9]*(\d+(?:\.\d+)?)|([0-9]+(?:\.[0-9]+)?)\s*(?:件|个)?\s*(?:\/|每|per)\s*(?:小时|h|hour)/i)
  if (perHour) return Number(perHour[1] ?? perHour[2])
  const perMinute = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:件|个)?\s*\/\s*(?:min|分钟)/i)
  return perMinute ? Number(perMinute[1]) * 60 : null
}

function parseLimit(text: string, label: string): number | null {
  const match = text.match(new RegExp(`${label}\\s*(?:最多|上限|limit)?\\s*[:：]?\\s*(\\d+)`, 'i'))
  return match ? Number(match[1]) : null
}

function parseHorizon(text: string): number | null {
  const match = text.match(/(?:窗口|horizon|采样)[^0-9]*(\d+(?:\.\d+)?)\s*(秒|s|min|分钟)/i)
  if (!match) return null
  return Number(match[1]) * (/min|分钟/i.test(match[2]) ? 60 : 1)
}

function sumRecord(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0)
}

function toolSummary(name: string, metrics: AgentMetrics, graph: FactoryGraph, findings: AgentFinding[]): string {
  if (name === 'get_factory_graph') return `${graph.nodes.length} nodes / ${graph.edges.length} edges`
  if (name === 'get_simulation_metrics') return `${metrics.throughputPerHour.toFixed(1)}/h, ${metrics.utilization.toFixed(1)}% utilization`
  if (name === 'inspect_bottlenecks') return `${findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'warning').length} actionable findings`
  return 'deterministic read-only inspection completed'
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}
