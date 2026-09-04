import toolCatalogJson from '../../contracts/forgemind-assistant-tools.json'
import { getObjectDef, objectRole, type BuildType, type FactoryObject, type GridPos, type Rotation } from './types'
import type { Item, Recipe } from './item'
import type { SimulationSnapshot } from './simulation'
import type { AssistantVisionSnapshot } from './assistantVision'
import type { AssistantProactiveAggregate } from './assistantProactiveEvents'

export const ASSISTANT_PROTOCOL_VERSION = '1.0.0' as const

export const ASSISTANT_TOOL_NAMES = [
  'query_factory_status',
  'inspect_object',
  'select_object',
  'set_simulation_running',
  'set_simulation_speed',
  'reset_simulation',
  'change_machine_recipe',
  'bind_source_item',
  'open_panel',
  'close_panel',
  'focus_panel',
  'select_floor',
  'locate_object',
  'compare_panels',
  'show_task',
  'inspect_vision_result',
  'open_product',
  'start_agent_task',
  'run_autopilot',
  'retry_agent_task',
  'cancel_agent_task',
  'list_agent_task_history',
  'list_active_reminders',
  'explain_reminder',
  'dismiss_reminder_group',
  'list_user_memory',
  'get_reminder_policy',
  'set_reminder_policy',
  'remember_user_preference',
  'forget_user_preference',
] as const

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number]
export const ASSISTANT_PANEL_IDS = [
  'factory-overview',
  'simulation',
  'object-detail',
  'production',
  'logistics',
  'warehouse',
  'agent-diagnosis',
  'generative-planner',
  'inspection',
  'cloud-runtime',
  'activity-history',
] as const
export type AssistantPanelId = (typeof ASSISTANT_PANEL_IDS)[number]
export type AssistantRisk = 'read_only' | 'reversible' | 'configuration_change' | 'destructive_runtime'

export interface AssistantToolDefinition {
  name: AssistantToolName
  description: string
  risk: AssistantRisk
  requiresConfirmation: boolean
  parameters: Record<string, unknown>
}

export interface AssistantToolCatalog {
  protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION
  assistant: string
  tools: AssistantToolDefinition[]
}

export type AssistantToolCall =
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'query_factory_status'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'inspect_object'; arguments: { objectId: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'select_object'; arguments: { objectId: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'set_simulation_running'; arguments: { running: boolean } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'set_simulation_speed'; arguments: { speed: number } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'reset_simulation'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'change_machine_recipe'; arguments: { objectId: string; recipeId: string | null } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'bind_source_item'; arguments: { objectId: string; itemId: string | null } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'open_panel'; arguments: { panelId: AssistantPanelId } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'close_panel'; arguments: { panelId: AssistantPanelId } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'focus_panel'; arguments: { panelId: AssistantPanelId } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'select_floor'; arguments: { floorId: number } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'locate_object'; arguments: { objectId: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'compare_panels'; arguments: { leftPanelId: AssistantPanelId; rightPanelId: AssistantPanelId } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'show_task'; arguments: { taskId: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'inspect_vision_result'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'open_product'; arguments: { productId: 'forgemind' | 'forgehub' | 'forgelab' | 'forgecloud' } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'start_agent_task'; arguments: { objective: string; mode: 'diagnose' | 'plan_design' } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'run_autopilot'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'retry_agent_task'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'cancel_agent_task'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'list_agent_task_history'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'list_active_reminders'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'explain_reminder'; arguments: { dedupeKey: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'dismiss_reminder_group'; arguments: { dedupeKey: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'list_user_memory'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'get_reminder_policy'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'set_reminder_policy'; arguments: { enabled: boolean; minSeverity: 'info' | 'warning' | 'critical'; cooldownMinutes: number; quietStart: string | null; quietEnd: string | null } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'remember_user_preference'; arguments: { key: string; value: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'forget_user_preference'; arguments: { key: string } }

export interface FactoryAssistantObject {
  id: string
  type: BuildType
  label: string
  role: ReturnType<typeof objectRole>
  pos: GridPos
  rotation: Rotation
  recipeId: string | null
  itemId: string | null
  runtime: Record<string, unknown> | null
}

export interface FactoryAssistantContext {
  protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION
  generatedAt: string
  simulation: {
    running: boolean
    speed: number
    timeSec: number
    inTransit: number
    consumed: Record<string, number>
    produced: Record<string, number>
  }
  objects: FactoryAssistantObject[]
  items: Array<Pick<Item, 'id' | 'name' | 'category'>>
  recipes: Array<Pick<Recipe, 'id' | 'name' | 'inputs' | 'outputs' | 'durationSec'>>
  floorCount: number
  taskIds: string[]
  vision: AssistantVisionSnapshot | null
  proactiveEvents: AssistantProactiveAggregate[]
}

export type AssistantValidationCode =
  | 'INVALID_ENVELOPE'
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN_TOOL'
  | 'INVALID_ARGUMENTS'
  | 'OBJECT_NOT_FOUND'
  | 'WRONG_OBJECT_ROLE'
  | 'RECIPE_NOT_FOUND'
  | 'ITEM_NOT_FOUND'

export type AssistantValidationResult =
  | {
      ok: true
      call: AssistantToolCall
      risk: AssistantRisk
      requiresConfirmation: boolean
      summary: string
    }
  | {
      ok: false
      code: AssistantValidationCode
      message: string
    }

const toolNames = new Set<string>(ASSISTANT_TOOL_NAMES)
const toolDefinitions = new Map<string, AssistantToolDefinition>()

export const ASSISTANT_TOOL_CATALOG = toolCatalogJson as AssistantToolCatalog

if (ASSISTANT_TOOL_CATALOG.protocolVersion !== ASSISTANT_PROTOCOL_VERSION) {
  throw new Error(`智能管家协议版本不一致：${ASSISTANT_TOOL_CATALOG.protocolVersion}`)
}
for (const definition of ASSISTANT_TOOL_CATALOG.tools) toolDefinitions.set(definition.name, definition)
for (const name of ASSISTANT_TOOL_NAMES) {
  if (!toolDefinitions.has(name)) throw new Error(`智能管家工具目录缺少 ${name}`)
}

export function createFactoryAssistantContext(input: {
  objects: FactoryObject[]
  items: Item[]
  recipes: Recipe[]
  snapshot: SimulationSnapshot
  running: boolean
  speed: number
  floorCount: number
  taskIds?: string[]
  vision?: AssistantVisionSnapshot | null
  proactiveEvents?: AssistantProactiveAggregate[]
  generatedAt?: string
}): FactoryAssistantContext {
  const machineRuntime = new Map(input.snapshot.machines.map((runtime) => [runtime.objectId, runtime]))
  const sourceRuntime = new Map(input.snapshot.sources.map((runtime) => [runtime.objectId, runtime]))

  return {
    protocolVersion: ASSISTANT_PROTOCOL_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    simulation: {
      running: input.running,
      speed: input.speed,
      timeSec: input.snapshot.timeSec,
      inTransit: input.snapshot.itemLots.length,
      consumed: { ...input.snapshot.stats.consumed },
      produced: { ...input.snapshot.stats.produced },
    },
    objects: input.objects.map((object) => ({
      id: object.id,
      type: object.type,
      label: getObjectDef(object.type, object.resourceId).label,
      role: objectRole(object.type, object.resourceId),
      pos: { ...object.pos },
      rotation: object.rotation,
      recipeId: object.recipeId ?? null,
      itemId: object.itemId ?? null,
      runtime: toRuntimeRecord(machineRuntime.get(object.id) ?? sourceRuntime.get(object.id)),
    })),
    items: input.items.map(({ id, name, category }) => ({ id, name, category })),
    recipes: input.recipes.map(({ id, name, inputs, outputs, durationSec }) => ({
      id,
      name,
      inputs: inputs.map((port) => ({ ...port })),
      outputs: outputs.map((port) => ({ ...port })),
      durationSec,
    })),
    floorCount: input.floorCount,
    taskIds: input.taskIds ?? [],
    vision: input.vision ?? null,
    proactiveEvents: input.proactiveEvents ?? [],
  }
}

export function validateAssistantToolCall(raw: unknown, context: FactoryAssistantContext): AssistantValidationResult {
  if (!isPlainRecord(raw)) return failure('INVALID_ENVELOPE', '工具调用必须是 JSON 对象。')
  if (raw.protocolVersion !== ASSISTANT_PROTOCOL_VERSION) {
    return failure('UNSUPPORTED_VERSION', `仅支持协议 ${ASSISTANT_PROTOCOL_VERSION}。`)
  }
  if (typeof raw.name !== 'string' || !toolNames.has(raw.name)) {
    return failure('UNKNOWN_TOOL', '请求的工具不在 ForgeMind 动作白名单中。')
  }
  if (!isPlainRecord(raw.arguments)) return failure('INVALID_ARGUMENTS', 'arguments 必须是 JSON 对象。')

  const name = raw.name as AssistantToolName
  const args = raw.arguments
  const definition = toolDefinitions.get(name)!
  const valid = validateArguments(name, args, context)
  if (!valid.ok) return valid

  const call = { protocolVersion: ASSISTANT_PROTOCOL_VERSION, name, arguments: args } as AssistantToolCall
  return {
    ok: true,
    call,
    risk: definition.risk,
    requiresConfirmation: definition.requiresConfirmation,
    summary: summarizeCall(call, context),
  }
}

function validateArguments(
  name: AssistantToolName,
  args: Record<string, unknown>,
  context: FactoryAssistantContext,
): { ok: true } | Extract<AssistantValidationResult, { ok: false }> {
  const allowedKeys: Record<AssistantToolName, string[]> = {
    query_factory_status: [],
    inspect_object: ['objectId'],
    select_object: ['objectId'],
    set_simulation_running: ['running'],
    set_simulation_speed: ['speed'],
    reset_simulation: [],
    change_machine_recipe: ['objectId', 'recipeId'],
    bind_source_item: ['objectId', 'itemId'],
    open_panel: ['panelId'],
    close_panel: ['panelId'],
    focus_panel: ['panelId'],
    select_floor: ['floorId'],
    locate_object: ['objectId'],
    compare_panels: ['leftPanelId', 'rightPanelId'],
    show_task: ['taskId'],
    open_product: ['productId'],
    inspect_vision_result: [],
    start_agent_task: ['objective', 'mode'],
    run_autopilot: [],
    retry_agent_task: [],
    cancel_agent_task: [],
    list_agent_task_history: [],
    list_active_reminders: [],
    explain_reminder: ['dedupeKey'],
    dismiss_reminder_group: ['dedupeKey'],
    list_user_memory: [],
    get_reminder_policy: [],
    set_reminder_policy: ['enabled', 'minSeverity', 'cooldownMinutes', 'quietStart', 'quietEnd'],
    remember_user_preference: ['key', 'value'],
    forget_user_preference: ['key'],
  }
  if (!hasExactKeys(args, allowedKeys[name])) {
    return failure('INVALID_ARGUMENTS', `${name} 的参数字段不完整或包含未知字段。`)
  }

  if (name === 'query_factory_status' || name === 'reset_simulation') return { ok: true }
  if (name === 'run_autopilot' || name === 'retry_agent_task' || name === 'cancel_agent_task' || name === 'list_agent_task_history' || name === 'list_active_reminders' || name === 'list_user_memory' || name === 'get_reminder_policy') return { ok: true }
  if (name === 'explain_reminder' || name === 'dismiss_reminder_group') {
    const key = args.dedupeKey
    return typeof key === 'string' && key.trim().length > 0 && key.length <= 180 && context.proactiveEvents.some((event) => event.fingerprint === key)
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '提醒不存在、已超出当前用户范围或去重键无效。')
  }
  if (name === 'set_reminder_policy') {
    const clock = (value: unknown) => value === null || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value))
    return typeof args.enabled === 'boolean'
      && (args.minSeverity === 'info' || args.minSeverity === 'warning' || args.minSeverity === 'critical')
      && typeof args.cooldownMinutes === 'number' && Number.isInteger(args.cooldownMinutes) && args.cooldownMinutes >= 1 && args.cooldownMinutes <= 1440
      && clock(args.quietStart) && clock(args.quietEnd)
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '提醒策略必须包含布尔开关、合法严重度、1–1440 分钟冷却时间和 HH:mm 或 null 免打扰时段。')
  }
  if (name === 'start_agent_task') {
    return typeof args.objective === 'string' && args.objective.trim().length > 0 && args.objective.length <= 2000
      && (args.mode === 'diagnose' || args.mode === 'plan_design')
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', 'Agent 任务必须包含不超过 2000 字的目标和合法模式。')
  }
  if (name === 'remember_user_preference') {
    const text = `${args.key ?? ''} ${args.value ?? ''}`
    const liveFact = /(库存|产量|产出|坐标|位置|仿真|在途|吞吐|利用率|inventory|output|coordinate|simulation|throughput)/iu.test(text)
    return !liveFact && typeof args.key === 'string' && args.key.trim().length > 0 && args.key.length <= 80
      && typeof args.value === 'string' && args.value.trim().length > 0 && args.value.length <= 400
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', liveFact ? '实时库存、产量、坐标和仿真事实不能写入长期记忆。' : '记忆键和值必须是非空字符串，长度分别不超过 80 和 400。')
  }
  if (name === 'forget_user_preference') {
    return typeof args.key === 'string' && args.key.trim().length > 0 && args.key.length <= 80
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '要删除的记忆键必须是非空字符串，长度不超过 80。')
  }
  if (name === 'set_simulation_running') {
    return typeof args.running === 'boolean'
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', 'running 必须是布尔值。')
  }
  if (name === 'set_simulation_speed') {
    return typeof args.speed === 'number' && Number.isFinite(args.speed) && args.speed >= 0.1 && args.speed <= 4
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', 'speed 必须是 0.1 到 4 之间的有限数字。')
  }

  if (name === 'open_panel' || name === 'close_panel' || name === 'focus_panel') {
    return typeof args.panelId === 'string' && (ASSISTANT_PANEL_IDS as readonly string[]).includes(args.panelId)
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '面板不在 ForgeMind 已注册的面板白名单中。')
  }
  if (name === 'select_floor') {
    return typeof args.floorId === 'number' && Number.isInteger(args.floorId) && args.floorId >= 1 && args.floorId <= context.floorCount
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', `楼层必须是当前工厂存在的 1 到 ${context.floorCount} 层。`)
  }
  if (name === 'compare_panels') {
    const validPanel = (value: unknown) => typeof value === 'string' && (ASSISTANT_PANEL_IDS as readonly string[]).includes(value)
    return validPanel(args.leftPanelId) && validPanel(args.rightPanelId) && args.leftPanelId !== args.rightPanelId
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '比较面板必须是两个不同的已注册面板。')
  }
  if (name === 'show_task') {
    return typeof args.taskId === 'string' && args.taskId.trim().length > 0 && args.taskId.length <= 120 && context.taskIds.includes(args.taskId)
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '任务不存在或不属于当前用户。')
  }
  if (name === 'inspect_vision_result') {
    return context.vision?.status === 'ready'
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '当前没有可供解释的有效视觉检测结果，请先打开视觉检测面板并完成一帧检测。')
  }
  if (name === 'open_product') {
    return ['forgemind', 'forgehub', 'forgelab', 'forgecloud'].includes(String(args.productId))
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', '产品入口不在 ForgeMind 生态白名单中。')
  }

  if (typeof args.objectId !== 'string' || args.objectId.length === 0) {
    return failure('INVALID_ARGUMENTS', 'objectId 必须是非空字符串。')
  }
  const object = context.objects.find((candidate) => candidate.id === args.objectId)
  if (!object) return failure('OBJECT_NOT_FOUND', `找不到对象 ${args.objectId}。`)
  if (name === 'inspect_object' || name === 'select_object' || name === 'locate_object') return { ok: true }

  if (name === 'change_machine_recipe') {
    if (object.role !== 'machine') return failure('WRONG_OBJECT_ROLE', `${object.label} 不是可绑定配方的加工设备。`)
    if (args.recipeId !== null && typeof args.recipeId !== 'string') {
      return failure('INVALID_ARGUMENTS', 'recipeId 必须是字符串或 null。')
    }
    if (typeof args.recipeId === 'string' && !context.recipes.some((recipe) => recipe.id === args.recipeId)) {
      return failure('RECIPE_NOT_FOUND', `找不到配方 ${args.recipeId}。`)
    }
    return { ok: true }
  }

  if (object.role !== 'source') return failure('WRONG_OBJECT_ROLE', `${object.label} 不是来料站。`)
  if (args.itemId !== null && typeof args.itemId !== 'string') {
    return failure('INVALID_ARGUMENTS', 'itemId 必须是字符串或 null。')
  }
  if (typeof args.itemId === 'string' && !context.items.some((item) => item.id === args.itemId)) {
    return failure('ITEM_NOT_FOUND', `找不到物品 ${args.itemId}。`)
  }
  return { ok: true }
}

function summarizeCall(call: AssistantToolCall, context: FactoryAssistantContext): string {
  switch (call.name) {
    case 'query_factory_status': return '读取当前工厂运行状态'
    case 'inspect_object': return `读取 ${objectLabel(context, call.arguments.objectId)} 的状态`
    case 'select_object': return `在界面中定位 ${objectLabel(context, call.arguments.objectId)}`
    case 'set_simulation_running': return call.arguments.running ? '启动工厂仿真' : '暂停工厂仿真'
    case 'set_simulation_speed': return `将全局仿真倍率设为 ×${call.arguments.speed}`
    case 'reset_simulation': return '重置仿真时间、在途物料和设备运行进度'
    case 'change_machine_recipe': {
      const recipe = context.recipes.find((candidate) => candidate.id === call.arguments.recipeId)
      return `将 ${objectLabel(context, call.arguments.objectId)} 的配方设为 ${recipe?.name ?? '未绑定'}`
    }
    case 'bind_source_item': {
      const item = context.items.find((candidate) => candidate.id === call.arguments.itemId)
      return `将 ${objectLabel(context, call.arguments.objectId)} 的来料设为 ${item?.name ?? '未绑定'}`
    }
    case 'open_panel': return `打开${panelLabel(call.arguments.panelId)}面板`
    case 'close_panel': return `关闭${panelLabel(call.arguments.panelId)}面板`
    case 'focus_panel': return `聚焦${panelLabel(call.arguments.panelId)}面板`
    case 'select_floor': return `切换到 ${call.arguments.floorId}F`
    case 'locate_object': return `在三维视图中定位 ${objectLabel(context, call.arguments.objectId)}`
    case 'compare_panels': return `并排比较${panelLabel(call.arguments.leftPanelId)}与${panelLabel(call.arguments.rightPanelId)}面板`
    case 'show_task': return `查看 Agent 任务 ${call.arguments.taskId}`
    case 'inspect_vision_result': return '读取最近一帧视觉检测结果'
    case 'open_product': return `打开${call.arguments.productId}产品入口`
    case 'start_agent_task': return call.arguments.mode === 'plan_design' ? `启动方案设计：${call.arguments.objective}` : `启动只读诊断：${call.arguments.objective}`
    case 'run_autopilot': return '启动一轮只读自动巡检'
    case 'retry_agent_task': return '重试最近一次失败或取消的 Agent 任务'
    case 'cancel_agent_task': return '取消当前 Agent 任务'
    case 'list_agent_task_history': return '查看最近 Agent 任务历史'
    case 'list_active_reminders': return '查看当前仍开放的主动提醒'
    case 'explain_reminder': return `解释主动提醒 ${call.arguments.dedupeKey}`
    case 'dismiss_reminder_group': return `关闭主动提醒 ${call.arguments.dedupeKey} 的同类事件`
    case 'list_user_memory': return '查看 BT 当前保存的用户偏好'
    case 'get_reminder_policy': return '查看主动提醒策略'
    case 'set_reminder_policy': return `修改主动提醒策略（${call.arguments.enabled ? '启用' : '停用'}，最低${call.arguments.minSeverity}）`
    case 'remember_user_preference': return `保存用户偏好“${call.arguments.key}”`
    case 'forget_user_preference': return `删除用户偏好“${call.arguments.key}”`
  }
}

function panelLabel(panelId: AssistantPanelId): string {
  return {
    'factory-overview': '工厂总览',
    simulation: '仿真',
    'object-detail': '对象详情',
    production: '生产',
    logistics: '物流',
    warehouse: '仓储',
    'agent-diagnosis': 'Agent 诊断',
    'generative-planner': '生成式工厂',
    inspection: '视觉检测',
    'cloud-runtime': '云端运行',
    'activity-history': '活动历史',
  }[panelId]
}

function objectLabel(context: FactoryAssistantContext, objectId: string): string {
  const object = context.objects.find((candidate) => candidate.id === objectId)
  return object ? `${object.label}（${object.id}）` : objectId
}

function toRuntimeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return { ...(value as unknown as Record<string, unknown>) }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function failure(code: AssistantValidationCode, message: string): Extract<AssistantValidationResult, { ok: false }> {
  return { ok: false, code, message }
}
