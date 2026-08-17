import { executeAssistantToolCall, getCurrentFactoryAssistantContext } from '../src/game/assistantExecutor'
import {
  ASSISTANT_PROTOCOL_VERSION,
  ASSISTANT_TOOL_CATALOG,
  ASSISTANT_TOOL_NAMES,
  validateAssistantToolCall,
} from '../src/game/assistantProtocol'
import { useForgeMindStore } from '../src/store/forgeMind'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function call(name: string, args: Record<string, unknown> = {}) {
  return { protocolVersion: ASSISTANT_PROTOCOL_VERSION, name, arguments: args }
}

const context = getCurrentFactoryAssistantContext()
const machine = context.objects.find((object) => object.role === 'machine')
const source = context.objects.find((object) => object.role === 'source')
const recipe = context.recipes[0]
const item = context.items[0]

assert(machine, 'A-01 基地应至少包含一台加工设备')
assert(source, 'A-01 基地应至少包含一个来料站')
assert(recipe, '默认数据应至少包含一个配方')
assert(item, '默认数据应至少包含一个物品')
assert(ASSISTANT_TOOL_CATALOG.protocolVersion === ASSISTANT_PROTOCOL_VERSION, '工具目录版本不一致')
assert(ASSISTANT_TOOL_CATALOG.tools.length === ASSISTANT_TOOL_NAMES.length, '工具目录数量不一致')

const validCases = [
  call('query_factory_status'),
  call('inspect_object', { objectId: machine.id }),
  call('select_object', { objectId: machine.id }),
  call('set_simulation_running', { running: true }),
  call('set_simulation_speed', { speed: 2 }),
  call('reset_simulation'),
  call('change_machine_recipe', { objectId: machine.id, recipeId: recipe.id }),
  call('bind_source_item', { objectId: source.id, itemId: item.id }),
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
  call('query_factory_status', { injected: true }),
]

for (const candidate of invalidCases) {
  const result = validateAssistantToolCall(candidate, context)
  assert(!result.ok, `${String(candidate.name)} 应被拒绝`)
}

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

console.log(`✅ 智能管家协议 ${ASSISTANT_PROTOCOL_VERSION}`)
console.log(`✅ ${ASSISTANT_TOOL_NAMES.length} 个白名单工具全部通过合法调用校验`)
console.log(`✅ 非法工具、越界参数、错误对象角色和额外字段均被拒绝`)
console.log('✅ 确认门控和受控 store 执行通过')
