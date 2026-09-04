import { executeAssistantToolCall, getCurrentFactoryAssistantContext } from '../src/game/assistantExecutor'
import {
  ASSISTANT_PROTOCOL_VERSION,
  ASSISTANT_TOOL_CATALOG,
  ASSISTANT_TOOL_NAMES,
  validateAssistantToolCall,
} from '../src/game/assistantProtocol'
import { DEFAULT_ITEMS, DEFAULT_RECIPES, type Item } from '../src/game/item'
import type { FactoryObject } from '../src/game/types'
import { useForgeMindStore } from '../src/store/forgeMind'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function call(name: string, args: Record<string, unknown> = {}) {
  return { protocolVersion: ASSISTANT_PROTOCOL_VERSION, name, arguments: args }
}

// A blank factory is intentionally empty in the current product contract.
// Build a small valid fixture here so protocol coverage does not depend on a
// starter layout or starter catalog being injected into the store.
const inputItem: Item = { ...DEFAULT_ITEMS[0] }
const outputItem: Item = { ...DEFAULT_ITEMS.find((item) => item.category === 'intermediate')! }
const recipe = { ...DEFAULT_RECIPES[0], inputs: [{ ...DEFAULT_RECIPES[0].inputs[0] }], outputs: [{ itemId: outputItem.id, qty: 1 }] }
const fixtureMachine: FactoryObject = { id: 'assistant-machine', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0, recipeId: recipe.id }
const fixtureSource: FactoryObject = { id: 'assistant-source', type: 'source', pos: { x: -4, z: 0 }, rotation: 0, itemId: inputItem.id }
useForgeMindStore.setState({ objects: [fixtureMachine, fixtureSource], items: [inputItem, outputItem], recipes: [recipe] })

const context = {
  ...getCurrentFactoryAssistantContext(),
  taskIds: ['task-check'],
  vision: {
    source: 'yolo' as const,
    partId: 'pcb-replay',
    status: 'ready' as const,
    verdict: 'pass' as const,
    detections: [],
    confidence: 1,
    inferenceMs: 18,
    capturedAt: '2026-09-03T00:00:00Z',
  },
  proactiveEvents: [{
    fingerprint: 'inventory:steel',
    source: 'inventory',
    severity: 'warning' as const,
    message: '原料库存接近安全线。',
    sources: ['inventory', 'autopilot'],
    count: 3,
    firstObservedAt: Date.parse('2026-09-03T00:00:00Z'),
    lastObservedAt: Date.parse('2026-09-03T00:05:00Z'),
    status: 'open' as const,
  }],
}
const machine = context.objects.find((object) => object.role === 'machine')
const source = context.objects.find((object) => object.role === 'source')
const recipeInContext = context.recipes[0]
const item = context.items[0]

assert(machine, '协议夹具应至少包含一台加工设备')
assert(source, '协议夹具应至少包含一个来料站')
assert(recipeInContext, '协议夹具应至少包含一个配方')
assert(item, '协议夹具应至少包含一个物品')
assert(ASSISTANT_TOOL_CATALOG.protocolVersion === ASSISTANT_PROTOCOL_VERSION, '工具目录版本不一致')
assert(ASSISTANT_TOOL_CATALOG.tools.length === ASSISTANT_TOOL_NAMES.length, '工具目录数量不一致')

const validCases = [
  call('query_factory_status'),
  call('inspect_object', { objectId: machine.id }),
  call('select_object', { objectId: machine.id }),
  call('set_simulation_running', { running: true }),
  call('set_simulation_speed', { speed: 2 }),
  call('reset_simulation'),
  call('change_machine_recipe', { objectId: machine.id, recipeId: recipeInContext.id }),
  call('bind_source_item', { objectId: source.id, itemId: item.id }),
  call('open_panel', { panelId: 'agent-diagnosis' }),
  call('focus_panel', { panelId: 'simulation' }),
  call('select_floor', { floorId: 1 }),
  call('locate_object', { objectId: machine.id }),
  call('compare_panels', { leftPanelId: 'simulation', rightPanelId: 'agent-diagnosis' }),
  call('show_task', { taskId: context.taskIds[0] ?? 'missing-task' }),
  call('open_product', { productId: 'forgelab' }),
  call('inspect_vision_result'),
  call('start_agent_task', { objective: '诊断当前工厂的物流瓶颈', mode: 'diagnose' }),
  call('run_autopilot'),
  call('retry_agent_task'),
  call('cancel_agent_task'),
  call('list_agent_task_history'),
  call('list_active_reminders'),
  call('explain_reminder', { dedupeKey: 'inventory:steel' }),
  call('dismiss_reminder_group', { dedupeKey: 'inventory:steel' }),
  call('list_user_memory'),
  call('get_reminder_policy'),
  call('set_reminder_policy', { enabled: true, minSeverity: 'warning', cooldownMinutes: 10, quietStart: null, quietEnd: null }),
  call('remember_user_preference', { key: 'preferredMetrics', value: '产能、堵塞和能耗' }),
  call('forget_user_preference', { key: 'preferredMetrics' }),
]

for (const candidate of validCases) {
  const result = validateAssistantToolCall(candidate, context)
  assert(result.ok, `${candidate.name} 应通过校验`)
}

const invalidCases = [
  call('delete_factory'),
  { ...call('query_factory_status'), protocolVersion: '9.0.0' },
  call('set_simulation_speed', { speed: 8 }),
  call('set_simulation_running', { running: 'yes' }),
  call('inspect_object', { objectId: 'missing-object' }),
  call('change_machine_recipe', { objectId: source.id, recipeId: recipe.id }),
  call('bind_source_item', { objectId: machine.id, itemId: item.id }),
  call('open_panel', { panelId: 'not-registered' }),
  call('remember_user_preference', { key: 'current_inventory', value: '库存 12 件' }),
  call('select_floor', { floorId: 4 }),
  call('locate_object', { objectId: 'missing-object' }),
  call('compare_panels', { leftPanelId: 'simulation', rightPanelId: 'simulation' }),
  call('show_task', { taskId: 'missing-task' }),
  call('explain_reminder', { dedupeKey: 'missing-reminder' }),
  call('dismiss_reminder_group', { dedupeKey: 'missing-reminder' }),
  call('open_product', { productId: 'unknown-product' }),
  call('start_agent_task', { objective: '', mode: 'diagnose' }),
  call('start_agent_task', { objective: '生成方案', mode: 'unknown' }),
  call('remember_user_preference', { key: '', value: 'x' }),
  call('forget_user_preference', { key: '' }),
  call('set_reminder_policy', { enabled: true, minSeverity: 'warning', cooldownMinutes: 0, quietStart: null, quietEnd: null }),
  call('query_factory_status', { injected: true }),
]

for (const candidate of invalidCases) {
  const result = validateAssistantToolCall(candidate, context)
  assert(!result.ok, `${String(candidate.name)} 应被拒绝`)
}

const policyValidation = validateAssistantToolCall(call('set_reminder_policy', { enabled: true, minSeverity: 'warning', cooldownMinutes: 10, quietStart: null, quietEnd: null }), context)
assert(policyValidation.ok && policyValidation.requiresConfirmation, '提醒策略修改必须等待确认')
const dismissalValidation = validateAssistantToolCall(call('dismiss_reminder_group', { dedupeKey: 'inventory:steel' }), context)
assert(dismissalValidation.ok && dismissalValidation.requiresConfirmation, '关闭同类提醒必须等待确认')
const reminderList = executeAssistantToolCall(call('list_active_reminders'))
assert(reminderList.status === 'executed' && Array.isArray(reminderList.data), '主动提醒列表应可读取')
const visionWithoutResult = validateAssistantToolCall(call('inspect_vision_result'), { ...context, vision: null })
assert(!visionWithoutResult.ok, '没有视觉结果时不应执行视觉解释工具')

const oldSpeed = useForgeMindStore.getState().simSpeed
const speedResult = executeAssistantToolCall(call('set_simulation_speed', { speed: 1.5 }))
assert(speedResult.status === 'executed', '可逆倍率动作应直接执行')
assert(useForgeMindStore.getState().simSpeed === 1.5, '倍率动作没有真实写入 store')
useForgeMindStore.getState().setSimSpeed(oldSpeed)

const oldResetTick = useForgeMindStore.getState().simResetTick
const pendingReset = executeAssistantToolCall(call('reset_simulation'))
assert(pendingReset.status === 'awaiting_confirmation', '重置操作必须等待确认')
assert(useForgeMindStore.getState().simResetTick === oldResetTick, '未确认的重置不应执行')
const confirmedReset = executeAssistantToolCall(call('reset_simulation'), { confirmed: true })
assert(confirmedReset.status === 'executed', '确认后的重置应执行')
assert(useForgeMindStore.getState().simResetTick === oldResetTick + 1, '确认后的重置没有真实写入 store')
useForgeMindStore.setState({ simResetTick: oldResetTick })

const rejectedRetry = executeAssistantToolCall(call('retry_agent_task'))
assert(rejectedRetry.status === 'rejected', '没有失败任务时重试应被拒绝')
const rejectedCancel = executeAssistantToolCall(call('cancel_agent_task'))
assert(rejectedCancel.status === 'rejected', '没有运行任务时取消应被拒绝')

console.log(`✅ 智能管家协议 ${ASSISTANT_PROTOCOL_VERSION}`)
console.log(`✅ ${ASSISTANT_TOOL_NAMES.length} 个白名单工具全部通过合法调用校验`)
console.log(`✅ 非法工具、越界参数、错误对象角色和额外字段均被拒绝`)
console.log('✅ 确认门控和受控 store 执行通过')
