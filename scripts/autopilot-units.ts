/**
 * 自动巡检单元回归：时序纯函数 + 真实引擎端到端循环。
 *
 * 覆盖：
 * - MetricsHistory 环形淘汰
 * - linearSlope 最小二乘
 * - forecastBottleneck 四种趋势与 ETA 折算
 * - runAutopilotCycle：基线建立 → 稳定监测 → 结构劣化检测 → 版本重置
 *
 * 运行：npm run autopilot:units
 */
import { MetricsHistory, forecastBottleneck, linearSlope, type MetricsSample } from '../src/game/metricsHistory'
import { runAutopilotCycle, type AutopilotBaseline } from '../src/game/factoryAutopilot'
import { analyzeBottlenecks } from '../src/game/bottleneckAnalysis'
import { buildPatrolReport, narratePatrolReport } from '../src/game/patrolNarrative'
import { SimulationEngine } from '../src/game/simulation'
import type { AgentFactoryContext } from '../src/game/agentTypes'
import type { FactoryObject } from '../src/game/types'
import type { Item, Recipe } from '../src/game/item'

let passed = 0
let failed = 0

const cases: Array<{ name: string; fn: () => void | Promise<void> }> = []

function test(name: string, fn: () => void | Promise<void>): void {
  cases.push({ name, fn })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function eq(actual: unknown, expected: unknown, label: string): void {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  assert(left === right, `${label}: 期望 ${right}，实际 ${left}`)
}

const sample = (deliveredPerMin: number, blockedObjects = 0): MetricsSample => ({
  timeSec: 60,
  deliveredPerMin,
  utilizationPct: 50,
  blockedObjects,
  inTransitLots: 0,
})

// —— 环形缓冲 ——
test('MetricsHistory 固定容量淘汰最旧样本', () => {
  const history = new MetricsHistory(3)
  for (const value of [1, 2, 3, 4, 5]) history.record(sample(value))
  eq(history.toArray().map((entry) => entry.deliveredPerMin), [3, 4, 5], '保留最新三个')
})

// —— 斜率 ——
test('linearSlope 常值/线性/两点/单点', () => {
  eq(linearSlope([7, 7, 7]), 0, '常值')
  eq(linearSlope([0, 1, 2]), 1, '线性递增')
  eq(linearSlope([3, 0]), -3, '两点')
  eq(linearSlope([]), 0, '空')
})

test('forecastBottleneck 样本不足时保持 stable', () => {
  eq(forecastBottleneck([sample(10)]).trend, 'stable', '1 个样本')
  eq(forecastBottleneck([sample(10), sample(1)]).trend, 'stable', '2 个样本')
})

test('forecastBottleneck declining 给出归零 ETA', () => {
  const result = forecastBottleneck([sample(12), sample(9), sample(6)], 60)
  eq(result.trend, 'declining', '趋势')
  assert(result.slopePerCycle < 0, '斜率为负')
  eq(result.etaZeroSec, 120, 'ceil(6/3)=2 周期 × 60s')
})

test('forecastBottleneck rising / stable', () => {
  eq(forecastBottleneck([sample(1), sample(2), sample(4)]).trend, 'rising', '递增')
  eq(forecastBottleneck([sample(10), sample(10), sample(10)]).trend, 'stable', '平稳')
})

test('forecastBottleneck 零交付且阻塞增长进入 critical', () => {
  const result = forecastBottleneck([sample(0, 1), sample(0, 3), sample(0, 5)])
  eq(result.trend, 'critical', '趋势')
  eq(result.etaZeroSec, null, 'critical 无 ETA')
})

// —— 端到端循环（真实仿真引擎）——
const iron = 'item_iron'
const gear = 'item_gear'
const shell = 'item_shell'

const testItems: Item[] = [
  { id: iron, name: '钢制毛坯', category: 'raw', color: '#888888', size: 1 },
  { id: shell, name: '机加工壳体', category: 'intermediate', color: '#999999', size: 1 },
  { id: gear, name: '齿轮', category: 'product', color: '#c0a040', size: 1 },
]

function recipe(id: string): Recipe {
  return { id, name: id, inputs: [{ itemId: iron, qty: 1 }], outputs: [{ itemId: gear, qty: 1 }], durationSec: 1 }
}

function buildObjects(withRecipe: boolean): FactoryObject[] {
  return [
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'in', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
    { id: 'machine', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0, recipeId: withRecipe ? 'r1' : undefined },
    { id: 'out', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 0 },
    { id: 'sink', type: 'outboundWarehouse', pos: { x: 2, z: -1 }, rotation: 0 },
  ]
}

function contextFor(objects: FactoryObject[], recipes: Recipe[]): AgentFactoryContext {
  const engine = new SimulationEngine(20260824)
  engine.init(objects, recipes)
  engine.advance(5)
  return { objects, recipes, items: testItems, snapshot: engine.getSnapshot(), floorCount: 1 }
}

test('runAutopilotCycle 三轮稳定运行不误报', () => {
  const recipes = [recipe('r1')]
  const context = contextFor(buildObjects(true), recipes)
  let baseline: AutopilotBaseline | null = null
  let samples: MetricsSample[] = []
  let last
  for (let cycle = 0; cycle < 3; cycle++) {
    last = runAutopilotCycle({ context, baseline, previousSamples: samples })
    baseline = last.baseline
    samples = last.samples
    assert(!last.degraded, `第 ${cycle + 1} 轮不应误报劣化`)
    assert(last.metrics.produced > 0, `第 ${cycle + 1} 轮应有真实交付`)
  }
  assert(last!, '应完成三轮')
  eq(last.samples.length, 3, '样本累积')
  eq(last.forecast.trend, 'stable', '确定性引擎下趋势平稳')
  assert(last.analysis.findings.some((finding) => finding.code === 'no_blocking_findings'), '健康工厂应有无阻塞结论')
})

test('runAutopilotCycle 检测吞吐坍塌并注入 Finding', () => {
  const recipes = [recipe('r1')]
  const healthy = contextFor(buildObjects(true), recipes)
  const first = runAutopilotCycle({ context: healthy, baseline: null, previousSamples: [] })
  assert(first.metrics.throughputPerHour > 0, '健康基线应有吞吐')

  const broken = contextFor(buildObjects(false), recipes)
  const second = runAutopilotCycle({ context: broken, baseline: first.baseline, previousSamples: first.samples })
  assert(second.degraded, '失去配方后应判定劣化')
  assert(second.findings.some((text) => text.includes('下降')), '预警文案应包含吞吐下降')
  assert(second.analysis.findings.some((finding) => finding.code === 'autopilot_throughput_degradation'), '应注入标准 Finding')
  assert(second.analysis.headline.startsWith('自动巡检'), 'headline 应带巡检前缀')
})

test('runAutopilotCycle 工厂结构变化时重置基线而不误报', () => {
  const recipes = [recipe('r1')]
  const healthy = contextFor(buildObjects(true), recipes)
  const first = runAutopilotCycle({ context: healthy, baseline: null, previousSamples: [] })
  const expanded = contextFor(
    [...buildObjects(true), { id: 'rack', type: 'oreMiner', pos: { x: -4, z: 3 }, rotation: 0, itemId: iron }],
    recipes,
  )
  const second = runAutopilotCycle({ context: expanded, baseline: first.baseline, previousSamples: first.samples })
  assert(second.baselineReset, '结构版本变化应重置基线')
  assert(!second.degraded, '重置轮不应判劣化')
})

// —— 叙述层 ——
test('buildPatrolReport 确定性模板包含关键数字且逐字节可复现', () => {
  const recipes = [recipe('r1')]
  const context = contextFor(buildObjects(true), recipes)
  const result = runAutopilotCycle({ context, baseline: null, previousSamples: [] })
  const reportA = buildPatrolReport(result)
  const reportB = buildPatrolReport(runAutopilotCycle({ context, baseline: null, previousSamples: [] }))
  eq(reportA, reportB, '同输入应得到同报告')
  for (const fragment of ['【自动巡检报告】', `吞吐 ${result.metrics.throughputPerHour.toFixed(1)}`, '趋势：']) {
    assert(reportA.includes(fragment), `报告缺少片段「${fragment}」`)
  }
  assert(reportA.includes('维持监测'), '健康轮结论应是维持监测')
})

test('buildPatrolReport 劣化轮列出发现与审批提示', () => {
  const recipes = [recipe('r1')]
  const healthy = contextFor(buildObjects(true), recipes)
  const first = runAutopilotCycle({ context: healthy, baseline: null, previousSamples: [] })
  const broken = contextFor(buildObjects(false), recipes)
  const result = runAutopilotCycle({ context: broken, baseline: first.baseline, previousSamples: first.samples })
  const report = buildPatrolReport(result)
  for (const fragment of ['发现：', '吞吐劣化', '需人工审批']) {
    assert(report.includes(fragment), `劣化报告缺少片段「${fragment}」`)
  }
})

test('narratePatrolReport 无 narrator / 失败回退模板，成功用 AI 文本', async () => {
  const recipes = [recipe('r1')]
  const context = contextFor(buildObjects(true), recipes)
  const result = runAutopilotCycle({ context, baseline: null, previousSamples: [] })
  const rule = await narratePatrolReport(result)
  eq(rule.source, 'rule', '无 narrator 应回退规则')
  eq(rule.text, buildPatrolReport(result), '规则文本等于模板')

  const failed = await narratePatrolReport(result, async () => { throw new Error('服务不可用') })
  eq(failed.source, 'rule', '失败应回退规则')
  eq(failed.text, buildPatrolReport(result), '回退文本等于模板')

  const ai = await narratePatrolReport(result, async () => '  AI 润色后的简报  ')
  eq(ai.source, 'ai', '成功应标记 AI')
  eq(ai.text, 'AI 润色后的简报', 'AI 文本应去除首尾空白')

  const empty = await narratePatrolReport(result, async () => '   ')
  eq(empty.source, 'rule', '空文本应回退规则')
})

// —— 瓶颈归因层 ——
function buildTwoMachineObjects(slowDurationSec: number): { objects: FactoryObject[]; recipes: Recipe[] } {
  const fast: Recipe = { id: 'r_fast', name: 'r_fast', inputs: [{ itemId: iron, qty: 1 }], outputs: [{ itemId: shell, qty: 1 }], durationSec: 1 }
  const slow: Recipe = { id: 'r_slow', name: 'r_slow', inputs: [{ itemId: shell, qty: 1 }], outputs: [{ itemId: gear, qty: 1 }], durationSec: slowDurationSec }
  const objects: FactoryObject[] = [
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -7, z: -1 }, rotation: 0, itemId: iron },
    { id: 'belt_a', type: 'conveyor', pos: { x: -4, z: 0 }, rotation: 0 },
    { id: 'm_fast', type: 'machine', pos: { x: -3, z: 0 }, rotation: 0, recipeId: 'r_fast' },
    { id: 'belt_b', type: 'conveyor', pos: { x: -2, z: 0 }, rotation: 0 },
    { id: 'm_slow', type: 'machine', pos: { x: -1, z: 0 }, rotation: 0, recipeId: 'r_slow' },
    { id: 'belt_c', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
    { id: 'sink', type: 'outboundWarehouse', pos: { x: 1, z: -1 }, rotation: 0 },
  ]
  return { objects, recipes: [fast, slow] }
}

test('analyzeBottlenecks 把慢设备排在首位且给出供料链', () => {
  const { objects, recipes } = buildTwoMachineObjects(4)
  const report = analyzeBottlenecks(objects, recipes, 60)
  assert(report.machines.length === 2, `应有两台机器，实际 ${report.machines.length}`)
  eq(report.primary, 'm_slow', '慢设备应是首要约束')
  assert(report.chain[0].includes('→') && report.chain[0].includes('m_fast') && report.chain[0].includes('m_slow'), `因果链应含供料者与约束设备 ID：${report.chain[0]}`)
  const slowStats = report.machines.find((entry) => entry.objectId === 'm_slow')!
  const fastStats = report.machines.find((entry) => entry.objectId === 'm_fast')!
  assert(slowStats.score > fastStats.score, '慢设备得分应更高')
})

test('analyzeBottlenecks 同输入逐字节确定', () => {
  const { objects, recipes } = buildTwoMachineObjects(3)
  const a = analyzeBottlenecks(objects, recipes, 60)
  const b = analyzeBottlenecks(objects, recipes, 60)
  eq(a, b, '两次运行应完全一致')
})

test('runAutopilotCycle 注入约束链 Finding 并写入摘要', () => {
  const recipes = [recipe('r1')]
  const context = contextFor(buildObjects(true), recipes)
  const result = runAutopilotCycle({ context, baseline: null, previousSamples: [] })
  // 单机小厂不构成约束链，但报告字段必须存在。
  assert(result.bottleneck !== null, '默认应产出瓶颈报告')
  assert(!result.analysis.findings.some((finding) => finding.code === 'autopilot_constraint_chain'), '单机厂不应有主约束')

  const pair = buildTwoMachineObjects(4)
  const engine = new SimulationEngine(20260824)
  engine.init(pair.objects, pair.recipes)
  engine.advance(5)
  const pairContext = { objects: pair.objects, recipes: pair.recipes, items: testItems, snapshot: engine.getSnapshot(), floorCount: 1 }
  const pairedResult = runAutopilotCycle({ context: pairContext, baseline: null, previousSamples: [] })
  const chainFinding = pairedResult.analysis.findings.find((finding) => finding.code === 'autopilot_constraint_chain')
  assert(chainFinding, '双机产线应注入约束链 Finding')
  assert(pairedResult.summaryText.includes('首要瓶颈'), '摘要应包含首要瓶颈')
})

;(async () => {
  for (const entry of cases) {
    try {
      await entry.fn()
      passed += 1
      console.log(`✅ ${entry.name}`)
    } catch (error) {
      failed += 1
      console.error(`❌ ${entry.name}: ${(error as Error).message}`)
    }
  }
  console.log(`\n自动巡检单元回归：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
})()
