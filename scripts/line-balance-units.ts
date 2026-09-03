/**
 * 产线平衡单元回归：节拍/产能纯函数 + 对象工序模型 + 确定性报告。
 *
 * 覆盖：
 * - taktSec / requiredCount / capacityGap 计算
 * - 两工序不均线的瓶颈识别与平衡损失
 * - 过剩工序识别（富余 ≥2 台）
 * - 完全均衡线的 feasible
 * - 无目标节拍时的安全降级
 * - stageModelFromObjects 对象→工序分组
 * - 同输入逐字节确定性
 * - formatBalanceReport 模板复现
 *
 * 运行：npm run line-balance:units
 */
import { computeLineBalance, formatBalanceReport, stageModelFromObjects } from '../src/game/lineBalancing'
import type { FactoryObject } from '../src/game/types'
import type { Recipe } from '../src/game/item'

let passed = 0
let failed = 0

const cases: Array<{ name: string; fn: () => void }> = []

function test(name: string, fn: () => void): void {
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

function close(actual: number, expected: number, label: string, epsilon = 1e-9): void {
  assert(Math.abs(actual - expected) < epsilon, `${label}: 期望 ${expected}，实际 ${actual}`)
}

const stages = (): Array<{ nodeId: string; name: string; recipeId: string; durationSec: number; machineCount: number }> => [
  { nodeId: 'machining', name: '机加工', recipeId: 'r_mach', durationSec: 2, machineCount: 2 },
  { nodeId: 'washing', name: '清洗', recipeId: 'r_wash', durationSec: 4, machineCount: 1 },
]

test('节拍与所需设备数计算', () => {
  const report = computeLineBalance(1200, [{ nodeId: 'm', name: 'M', recipeId: 'r', durationSec: 6, machineCount: 2 }])
  close(report.taktSec!, 3, 'taktSec=3600/1200')
  close(report.stages[0].perMachineCapacityPerHour, 600, '单机能力=3600/6')
  close(report.stages[0].capacityPerHour, 1200, '整工序能力=2×600')
  eq(report.stages[0].requiredCount, 2, 'requiredCount=ceil(1200/600)')
  eq(report.stages[0].capacityGap, 0, '恰好配置无缺口')
})

test('欠配工序识别为瓶颈并给出平衡损失', () => {
  const report = computeLineBalance(1200, stages())
  eq(report.bottleneckNodeId, 'washing', '清洗单机 900/h 低于目标 1200/h')
  const washing = report.stages.find((stage) => stage.nodeId === 'washing')!
  eq(washing.requiredCount, 2, '清洗需 2 台')
  eq(washing.capacityGap, 1, '缺口 1 台')
  close(washing.loadRatio, 0.75, '清洗 loadRatio=900/1200')
  close(report.balanceLoss, 0.75, '1 − 0.75/3.0')
  eq(report.feasible, false, '存在欠配工序时不可行')
})

test('完全均衡线为可行且零平衡损失', () => {
  const balanced = [
    { nodeId: 'a', name: 'A', recipeId: 'ra', durationSec: 3, machineCount: 1 },
    { nodeId: 'b', name: 'B', recipeId: 'rb', durationSec: 3, machineCount: 1 },
  ]
  const report = computeLineBalance(1200, balanced)
  eq(report.bottleneckNodeId, null, '无瓶颈')
  close(report.balanceLoss, 0, '完全均衡损失为 0')
  eq(report.feasible, true, '每工序 1200/h 达到目标')
})

test('富余 ≥2 台识别为过剩工序', () => {
  const line = [
    { nodeId: 'machining', name: '机加工', recipeId: 'r_mach', durationSec: 2, machineCount: 3 },
    { nodeId: 'washing', name: '清洗', recipeId: 'r_wash', durationSec: 4, machineCount: 1 },
  ]
  const report = computeLineBalance(1000, line)
  assert(report.overprovisionedNodeIds.includes('machining'), '机加工 3 台富余 2 台应标记过剩')
  assert(!report.overprovisionedNodeIds.includes('washing'), '清洗欠配不是过剩')
})

test('无目标节拍时安全降级', () => {
  const report = computeLineBalance(null, stages())
  eq(report.taktSec, null, 'takt 为空')
  eq(report.feasible, false, '无目标时不可评估')
  eq(report.bottleneckNodeId, null, '无瓶颈判定')
  close(report.balanceLoss, 0, '无平衡损失')
  assert(report.summary.includes('未设定目标节拍'), '摘要说明缺少目标')
})

test('同输入逐字节确定', () => {
  const a = computeLineBalance(1200, stages())
  const b = computeLineBalance(1200, stages())
  eq(a, b, '两次运行完全一致')
})

test('stageModelFromObjects 按配方分组为工序', () => {
  const objects: FactoryObject[] = [
    { id: 'm1', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0, recipeId: 'r_mach' },
    { id: 'm2', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0, recipeId: 'r_mach' },
    { id: 'w1', type: 'washing', pos: { x: 0, z: 0 }, rotation: 0, recipeId: 'r_wash' },
    { id: 'belt', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
    { id: 'unbound', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0 },
  ]
  const recipes: Recipe[] = [
    { id: 'r_mach', name: '机加工', inputs: [{ itemId: 'i_shell', qty: 1 }], outputs: [{ itemId: 'i_gear', qty: 1 }], durationSec: 2 },
    { id: 'r_wash', name: '清洗', inputs: [{ itemId: 'i_blank', qty: 1 }], outputs: [{ itemId: 'i_shell', qty: 1 }], durationSec: 4 },
  ]
  const model = stageModelFromObjects(objects, recipes)
  eq(model.length, 2, '只统计绑定有效配方的机器')
  const machining = model.find((stage) => stage.nodeId === 'r_mach')!
  eq(machining.machineCount, 2, '机加工 2 台')
  eq(machining.durationSec, 2, '机加工时长')
  const report = computeLineBalance(1200, model)
  eq(report.bottleneckNodeId, 'r_wash', '对象模型也能识别清洗瓶颈')
})

test('formatBalanceReport 确定性模板可逐字节复现', () => {
  const report = computeLineBalance(1200, stages())
  const textA = formatBalanceReport(report)
  const textB = formatBalanceReport(computeLineBalance(1200, stages()))
  eq(textA, textB, '同输入同报告')
  assert(textA.includes('【线平衡报告】'), '含标题')
  assert(textA.includes('瓶颈：清洗'), '含瓶颈行')
  assert(textA.includes('缺口 1 台'), '含缺口信息')
  assert(textA.includes('目标节拍 1200 件/h'), '含目标节拍')
})

;(() => {
  for (const entry of cases) {
    try {
      entry.fn()
      passed += 1
      console.log(`✅ ${entry.name}`)
    } catch (error) {
      failed += 1
      console.error(`❌ ${entry.name}: ${(error as Error).message}`)
    }
  }
  console.log(`\n产线平衡单元回归：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
})()
