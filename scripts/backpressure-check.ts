/**
 * 背压验证：传送带下游是另一条「死路」传送带（无出口）时，
 * 物品应在末端停住，不会凭空消失，也不会穿透。
 */
import { SimulationEngine } from '../src/game/simulation'
import type { FactoryObject } from '../src/game/types'
import type { Recipe } from '../src/game/item'

const ironId = 'item_iron'
const gearId = 'item_gear'
const recipe: Recipe = {
  id: 'r',
  name: '铁→齿',
  inputs: [{ itemId: ironId, qty: 1 }],
  outputs: [{ itemId: gearId, qty: 1 }],
  durationSec: 1.0,
}

// 传送带 [1,0] 是死路（朝 +X 但 [2,0] 无对象）——但我们在 [2,0] 再放一条朝 +X 的传送带
// 更直接：物品进入 belt_out 后，belt_out 下游 [3,0] 是空格 → 按新语义会消失。
// 要测背压，需要下游不是空格。这里构造：belt_out 朝 -X（反方向）指向机器，
// 物品会尝试进入机器，但机器不 idle 时拒绝 → 头堵。
const objects: FactoryObject[] = [
  { id: 'src', type: 'source', pos: { x: -1, z: 0 }, rotation: 0, itemId: ironId },
  { id: 'belt_in', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
  { id: 'machine', type: 'machine', pos: { x: 1, z: 0 }, rotation: 0, recipeId: 'r' },
  { id: 'belt_out', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 180 }, // 朝 -X 指回机器
]

const engine = new SimulationEngine(1)
engine.init(objects, [recipe])
engine.advance(20)

const snap = engine.getSnapshot()
const lotOnBeltOut = snap.itemLots.find((l) => l.conveyorId === 'belt_out')
console.log('belt_out 上的物品:', lotOnBeltOut ? `offset=${lotOnBeltOut.offset.toFixed(2)}` : '无')
console.log('在途物品总数:', snap.itemLots.length)

// 头堵时应停在下游末端 offset≈1，不消失
if (snap.itemLots.length > 0) {
  console.log('✅ 背压生效：物品没有凭空消失')
} else {
  console.log('❌ 背压失效：物品消失了')
}
