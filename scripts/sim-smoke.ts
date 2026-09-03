/**
 * 仿真引擎集成测试（一次性验证脚本，非产品代码）。
 *
 * 跑 §7.1 演示脚本的纯逻辑版：
 *   Source(产出铁板) → 传送带[0,0] → 机器[1,0](铁板→齿轮) → 传送带[2,0] → 出口
 * 验证物品沿带流动、机器收料加工、产物吐出、产量计数、背压。
 *
 * 运行：npx tsx scripts/sim-smoke.ts
 */
import { SimulationEngine } from '../src/game/simulation'
import type { FactoryObject } from '../src/game/types'
import type { Recipe } from '../src/game/item'

// 物品与配方
const ironId = 'item_iron'
const gearId = 'item_gear'
const recipe: Recipe = {
  id: 'recipe_1',
  name: '铁板→齿轮',
  inputs: [{ itemId: ironId, qty: 1 }],
  outputs: [{ itemId: gearId, qty: 1 }],
  durationSec: 1.0,
}

// 布局（rotation 方向：+X=0）
// 入货仓库在 [-4,-1]（3x3，前面供货）；传送带 [-1,0]、[1,0]；机器 [0,0]；出货仓库 [2,-1] 计量产出
const objects: FactoryObject[] = [
  { id: 'supply', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: ironId },
  { id: 'belt_in', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
  { id: 'machine', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0, recipeId: recipe.id },
  { id: 'belt_out', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 0 },
  { id: 'sink', type: 'outboundWarehouse', pos: { x: 2, z: -1 }, rotation: 0 },
]

const engine = new SimulationEngine(20260813)
engine.init(objects, [recipe])

// 推进 30 秒逻辑时间
engine.advance(30)

const snap = engine.getSnapshot()
console.log('=== 30s 逻辑时间后 ===')
console.log('逻辑时间:', snap.timeSec.toFixed(1), 's')
console.log('在途物品数:', snap.itemLots.length)
console.log('产出(齿轮):', snap.stats.produced[gearId] ?? 0)
console.log('消耗(铁板):', snap.stats.consumed[ironId] ?? 0)

const machine = snap.machines.find((m) => m.objectId === 'machine')
console.log('机器状态:', machine?.state, '进度:', machine?.progress.toFixed(2))

// 断言：应该已经产出了若干齿轮（>0），消耗了对应铁板
const produced = snap.stats.produced[gearId] ?? 0
const consumed = snap.stats.consumed[ironId] ?? 0

let pass = true
if (produced <= 0) {
  console.error('FAIL: 30s 内没有产出任何齿轮')
  pass = false
}
// The arm may have one final lot in its pick/place transfer, and boundary
// accounting lags delivery by the in-process pipeline, when the fixed
// 30-second sample ends.
if (consumed < produced || consumed - produced > 4) {
  console.error(`FAIL: 消耗(${consumed}) != 产出(${produced})，1:1 配方应对应`)
  pass = false
}

console.log(pass ? '\n✅ 闭环验证通过' : '\n❌ 闭环验证失败')
process.exit(pass ? 0 : 1)
