import { mergeAssistantProactiveEvent } from '../src/game/assistantProactiveEvents'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const first = mergeAssistantProactiveEvent([], { fingerprint: 'line-degraded', source: 'throughput', severity: 'warning', message: '吞吐下降' }, 100)
const merged = mergeAssistantProactiveEvent(first, { fingerprint: 'line-degraded', source: 'inventory', severity: 'critical', message: '库存耗尽' }, 200)
assert(merged.length === 1, '同一主动事件未合并')
assert(merged[0].sources.length === 2 && merged[0].sources.includes('throughput') && merged[0].sources.includes('inventory'), '主动事件来源没有合并')
assert(merged[0].count === 2 && merged[0].severity === 'critical' && merged[0].status === 'open', '主动事件严重度或计数错误')
console.log('✅ 主动事件多来源聚合、严重度升级和恢复状态基础逻辑通过')
