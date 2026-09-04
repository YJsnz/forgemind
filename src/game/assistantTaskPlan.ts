import type { AgentAnalysisResult, AgentMode, AgentToolCall } from './agentTypes'

export interface AssistantSubtask {
  id: string
  label: string
  objective: string
  phase: 'observe' | 'retrieve' | 'diagnose' | 'proposal'
  buildPatch?: boolean
}

const SUBTASK_DEFINITIONS: Array<{ id: string; label: string; pattern: RegExp; instruction: string }> = [
  { id: 'production', label: '生产与产能', pattern: /生产|产能|产出|配方|机器|加工|throughput|production|recipe|machine/iu, instruction: '聚焦生产链、配方绑定、设备利用率、产能和产出瓶颈' },
  { id: 'inventory', label: '库存与仓储', pattern: /库存|仓储|货架|入货|出货|物料|inventory|warehouse|storage/iu, instruction: '聚焦库存守恒、仓储容量、供货边界、缺货和物料等待' },
  { id: 'logistics', label: '物流与运输', pattern: /物流|传送带|输送|AGV|无人机|运输|端口|logistics|conveyor|transport/iu, instruction: '聚焦传送带端口、物流连通性、载具路径、背压和运输等待' },
  { id: 'energy', label: '能耗与运行', pattern: /能耗|功率|能源|电费|energy|power/iu, instruction: '聚焦设备运行状态、额定功率、待机和能耗归因' },
  { id: 'structure', label: '结构与约束', pattern: /结构|连接|碰撞|布局|楼层|对象|约束|structure|collision|layout|floor/iu, instruction: '聚焦对象引用、端口拓扑、楼层、碰撞和结构约束' },
]

/** 诊断按领域拆分；方案设计按 Observe→Retrieve→Diagnose→Proposal 跨阶段推进。 */
export function planAssistantSubtasks(objective: string, mode: AgentMode): AssistantSubtask[] {
  const text = objective.trim()
  if (mode === 'plan_design') {
    return [
      { id: 'plan-observe', label: '读取现状基线', phase: 'observe', objective: `${text}\n方案阶段 1/4：只读取当前工厂结构、实时指标和对象关系，建立不可变基线。` },
      { id: 'plan-retrieve', label: '整理目标与约束', phase: 'retrieve', objective: `${text}\n方案阶段 2/4：核对目标、硬约束、软约束、权限和可用资源，只报告约束冲突与缺失信息。` },
      { id: 'plan-diagnose', label: '评估候选方向', phase: 'diagnose', objective: `${text}\n方案阶段 3/4：基于同一确定性上下文评估候选调整方向、影响面和风险，不执行修改。` },
      { id: 'plan-proposal', label: '生成受控方案草案', phase: 'proposal', buildPatch: true, objective: `${text}\n方案阶段 4/4：综合前序基线、约束和候选方向，生成一份待人工审批的 Patch 草案；不得自动应用。` },
    ]
  }
  const selected = SUBTASK_DEFINITIONS.filter((definition) => definition.pattern.test(text))
  if (selected.length <= 1) return [{ id: 'primary', label: '综合诊断', phase: 'diagnose', objective: text }]
  return selected.slice(0, 4).map((definition) => ({
    id: `subtask-${definition.id}`,
    label: definition.label,
    phase: 'diagnose' as const,
    objective: `${text}\n当前只读子任务：${definition.instruction}。只报告该领域证据，并保留与其他领域相关的对象 ID。`,
  }))
}

export function mergeAssistantAnalyses(results: AgentAnalysisResult[], objective: string, mode: AgentMode): AgentAnalysisResult {
  if (results.length === 0) throw new Error('没有可合并的 Agent 子任务结果')
  if (results.length === 1) return { ...results[0], goal: { ...results[0].goal, objective, mode } }
  const first = results[0]
  const seenFindings = new Set<string>()
  const findings = results.flatMap((result, index) => result.findings.map((finding) => {
    const key = `${finding.code}|${finding.objectIds.join(',')}|${finding.title}`
    if (seenFindings.has(key)) return null
    seenFindings.add(key)
    return { ...finding, id: `${finding.id}-sub${index + 1}` }
  }).filter((finding): finding is AgentAnalysisResult['findings'][number] => Boolean(finding)))
  const seenTools = new Set<string>()
  const toolCalls: AgentToolCall[] = results.flatMap((result) => result.toolCalls).filter((tool) => {
    const key = `${tool.name}|${tool.summary}`
    if (seenTools.has(key)) return false
    seenTools.add(key)
    return true
  })
  const severityRank = { critical: 4, warning: 3, info: 2, success: 1 } as const
  const highest = findings.reduce((current, finding) => severityRank[finding.severity] > severityRank[current] ? finding.severity : current, 'success' as AgentAnalysisResult['findings'][number]['severity'])
  const isPlan = mode === 'plan_design'
  const headline = findings.length
    ? `${isPlan ? '跨阶段方案分析完成' : '多域诊断完成'}：${findings.length} 条 Finding，最高严重度 ${highest}`
    : `${isPlan ? '跨阶段方案分析完成' : '多域诊断完成'}：${results.length} 个子任务未发现异常`
  const metrics = first.metrics
  return {
    ...first,
    runId: `run-${Date.now().toString(36)}-merged`,
    mode,
    goal: { ...first.goal, objective, mode },
    findings,
    toolCalls,
    headline,
    confidence: Math.round(results.reduce((sum, result) => sum + result.confidence, 0) / results.length),
    summary: `已完成 ${results.length} 个${isPlan ? '方案阶段' : '只读子任务'}并合并结果；实时指标仍以当前确定性工厂上下文为准。${metrics.timeSec.toFixed(1)} 秒证据窗口、${findings.length} 条去重 Finding。${isPlan ? '方案 Patch 仍需人工审批。' : ''}`,
  }
}
