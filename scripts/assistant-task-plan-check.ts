import { mergeAssistantAnalyses, planAssistantSubtasks } from '../src/game/assistantTaskPlan'
import type { AgentAnalysisResult } from '../src/game/agentTypes'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const objective = '检查生产、库存和物流瓶颈'
const plan = planAssistantSubtasks(objective, 'diagnose')
assert(plan.length === 3, '复杂目标没有拆出生产、库存、物流三个子任务')
assert(plan.every((item) => item.objective.includes('当前只读子任务')), '子任务没有携带领域约束')
const planDesign = planAssistantSubtasks(objective, 'plan_design')
assert(planDesign.length === 4, '方案设计没有形成四阶段可追踪链')
assert(planDesign[0].phase === 'observe' && planDesign[3].phase === 'proposal' && planDesign[3].buildPatch === true, '方案阶段或 Patch 审批边界错误')
assert(planDesign.slice(0, 3).every((item) => item.buildPatch !== true), '前置方案阶段不应生成 Patch')

const base = {
  runId: 'run-base', createdAt: new Date().toISOString(), status: 'completed' as const, mode: 'diagnose' as const,
  goal: { schemaVersion: 1 as const, objective, intent: 'diagnose' as const, mode: 'diagnose' as const, status: 'compiled' as const, baselineVersion: 'local-test', metrics: {}, hardConstraints: {}, softConstraints: [], timeHorizonSec: 60, allowedActions: [], assumptions: [], missingConstraints: [], conflicts: [] },
  graph: { schemaVersion: 1 as const, baselineVersion: 'local-test', nodes: [], edges: [], invalidReferences: [] },
  metrics: { timeSec: 1, throughputPerHour: 2, targetThroughputPerHour: null, utilization: 0.5, wip: 1, activeMachines: 1, machineCount: 1, blockedObjects: 0, waitingVehicles: 0, consumed: 1, produced: 1, averageTransportSec: 0, inventoryTotal: 1 },
  findings: [{ id: 'finding-1', severity: 'warning' as const, code: 'blocked', title: '等待', detail: '证据', impact: '影响', recommendation: '检查', objectIds: ['machine-1'], evidence: [] }],
  toolCalls: [{ name: 'inspect_bottlenecks', status: 'completed' as const, summary: '已检查' }],
  headline: '诊断', confidence: 80, summary: '摘要',
}
const merged = mergeAssistantAnalyses([{ ...base, runId: 'run-1' }, { ...base, runId: 'run-2' }], objective, 'diagnose')
assert(merged.findings.length === 1, '合并结果没有去重重复 Finding')
assert(merged.summary.includes('2 个只读子任务'), '合并结果没有保留子任务摘要')
console.log('✅ Agent 子任务拆解与结果合并通过')
