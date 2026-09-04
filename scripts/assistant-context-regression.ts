import { buildAssistantConversationSummary } from '../src/game/assistantConversation'

const turns = Array.from({ length: 10 }, (_, index) => ({
  role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
  content: index === 0
    ? '请围绕 CNC-02 诊断二楼物流瓶颈，保留所有现有设备，任何修改都要先确认。'
    : `第 ${index} 轮补充：继续处理当前任务并保留审批门禁。${' 记录现场观察但不要把它当作实时工厂事实。'.repeat(24)}`,
}))

const summary = buildAssistantConversationSummary(turns, '早期目标：优先检查产能和堵塞。')
if (!summary.includes('CNC-02') || !summary.includes('审批门禁')) throw new Error('会话摘要丢失对象或安全约束')
if (summary.length > 1600) throw new Error('会话摘要超过模型上下文预算')
if (!summary.includes('动态工厂事实需重新读取')) throw new Error('摘要缺少动态事实重新读取提示')

console.log('✅ 助手多轮上下文压缩：目标、对象、安全约束保留且动态事实重新读取提示存在')
