/**
 * 仿真引擎回归脚本。
 *
 * 覆盖演示闭环之外最容易回归的路径：
 * - 基础闭环：入货仓库供料 → 传送带 → 机器 → 产出
 * - 90° 转弯传送带可以把物料送到下游机器
 * - 分流器能够轮询三条支路
 * - 汇流器能够收集两条输入并满足多输入配方
 * - 下游拒收时传送带头堵，物料不会凭空消失
 * - 大尺寸设备通过选中端口收料并从出口通道排出
 * - 货物存取站在连接真实货架后完成 picking/placing 生命周期
 * - 长时推进不被截断
 *
 * 布局约定（2026-08 端口语义）：上游本体必须压住下游的外部输入端口格；
 * 无限供货边界是入货仓库（3x3），货物存取站（4x4）只在有真实货架泊位时转运。
 * 所有用例在运行前先做足迹重叠守卫，避免对象定义尺寸变化时静默断链。
 *
 * 运行：npm run sim:regression
 */
import { SimulationEngine } from '../src/game/simulation'
import { occupiedCells } from '../src/game/grid'
import type { FactoryObject } from '../src/game/types'
import type { Recipe } from '../src/game/item'

const iron = 'item_iron'
const gear = 'item_gear'

function recipe(id: string, qty = 1): Recipe {
  return {
    id,
    name: id,
    inputs: [{ itemId: iron, qty }],
    outputs: [{ itemId: gear, qty: 1 }],
    durationSec: 1,
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** 足迹重叠守卫：对象定义尺寸变化时立刻失败，而不是静默断链。 */
function assertNoOverlap(objects: FactoryObject[]): void {
  const owner = new Map<string, string>()
  for (const obj of objects) {
    for (const cell of occupiedCells(obj)) {
      const key = `${cell.x},${cell.z}`
      const previous = owner.get(key)
      assert(!previous, `${obj.id} 与 ${previous} 在格 (${key}) 重叠，fixture 布局已过期`)
      owner.set(key, obj.id)
    }
  }
}

function runCase(name: string, fn: () => void): boolean {
  try {
    fn()
    console.log(`✅ ${name}`)
    return true
  } catch (error) {
    console.error(`❌ ${name}: ${(error as Error).message}`)
    return false
  }
}

function initAndAdvance(objects: FactoryObject[], recipes: Recipe[], seconds: number, seed: number): SimulationEngine {
  assertNoOverlap(objects)
  const engine = new SimulationEngine(seed)
  engine.init(objects, recipes)
  engine.advance(seconds)
  return engine
}

function closedLoop(): void {
  const r = recipe('closed-loop')
  const objects: FactoryObject[] = [
    // 入货仓库 3x3，前面（+X）外部列是它的供货端口。
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'in', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
    { id: 'machine', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0, recipeId: r.id },
    { id: 'out', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 0 },
    // 产出只在货物进入出货仓库时计入边界账本。
    { id: 'sink', type: 'outboundWarehouse', pos: { x: 2, z: -1 }, rotation: 0 },
  ]
  const snap = initAndAdvance(objects, [r], 30, 20260813).getSnapshot()
  const produced = snap.stats.produced[gear] ?? 0
  const consumed = snap.stats.consumed[iron] ?? 0
  assert(Math.abs(snap.timeSec - 30) < 0.05, `逻辑时间应接近 30s，实际为 ${snap.timeSec}`)
  assert(produced > 0, '闭环没有产出')
  // Boundary accounting counts consumption on warehouse withdrawal and
  // production on physical delivery, so the pipeline holds a small lag.
  assert(consumed >= produced && consumed - produced <= 4, `1:1 配方消耗 ${consumed}，产出 ${produced}`)
}

function turningRoute(): void {
  const r = recipe('turning-route')
  const objects: FactoryObject[] = [
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -5, z: -5 }, rotation: 0, itemId: iron },
    { id: 'vertical', type: 'conveyor', pos: { x: -2, z: -4 }, rotation: 90 },
    { id: 'corner', type: 'conveyor', pos: { x: -2, z: -3 }, rotation: 0 },
    { id: 'horizontal', type: 'conveyor', pos: { x: -1, z: -3 }, rotation: 0 },
    { id: 'machine', type: 'machine', pos: { x: 0, z: -3 }, rotation: 0, recipeId: r.id },
    { id: 'out', type: 'conveyor', pos: { x: 1, z: -3 }, rotation: 0 },
    { id: 'sink', type: 'outboundWarehouse', pos: { x: 2, z: -4 }, rotation: 0 },
  ]
  const snap = initAndAdvance(objects, [r], 24, 11).getSnapshot()
  const produced = snap.stats.produced[gear] ?? 0
  const consumed = snap.stats.consumed[iron] ?? 0
  assert(produced > 0, '转弯线路没有把物料送到机器')
  assert(consumed >= produced, `转弯线路消耗 ${consumed}，产出 ${produced}`)
}

function splitterRoute(): void {
  const r = recipe('splitter-route')
  const objects: FactoryObject[] = [
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'feed', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
    { id: 'split', type: 'splitter', pos: { x: 0, z: 0 }, rotation: 0 },
    { id: 'east-belt', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 0 },
    { id: 'east-machine', type: 'machine', pos: { x: 2, z: 0 }, rotation: 0, recipeId: r.id },
    { id: 'north-belt', type: 'conveyor', pos: { x: 0, z: 1 }, rotation: 90 },
    { id: 'north-machine', type: 'machine', pos: { x: 0, z: 2 }, rotation: 90, recipeId: r.id },
    { id: 'south-belt', type: 'conveyor', pos: { x: 0, z: -1 }, rotation: 270 },
    { id: 'south-machine', type: 'machine', pos: { x: 0, z: -2 }, rotation: 270, recipeId: r.id },
  ]
  const snap = initAndAdvance(objects, [r], 36, 12).getSnapshot()
  for (const id of ['east-machine', 'north-machine', 'south-machine']) {
    const runtime = snap.machines.find((machine) => machine.objectId === id)
    assert(runtime && runtime.processingTime > 0, `分流支路 ${id} 没有处理物料`)
  }
}

function mergerRoute(): void {
  const r = recipe('merger-route', 2)
  const objects: FactoryObject[] = [
    { id: 'supply-a', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'belt-a', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
    { id: 'supply-b', type: 'inboundWarehouse', pos: { x: -1, z: 2 }, rotation: 0, itemId: iron },
    { id: 'belt-b', type: 'conveyor', pos: { x: 0, z: 1 }, rotation: 270 },
    { id: 'merge', type: 'merger', pos: { x: 0, z: 0 }, rotation: 0 },
    { id: 'out', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 0 },
    { id: 'machine', type: 'machine', pos: { x: 2, z: 0 }, rotation: 0, recipeId: r.id },
    { id: 'out-belt', type: 'conveyor', pos: { x: 3, z: 0 }, rotation: 0 },
    { id: 'sink', type: 'outboundWarehouse', pos: { x: 4, z: -1 }, rotation: 0 },
  ]
  const snap = initAndAdvance(objects, [r], 36, 13).getSnapshot()
  const consumed = snap.stats.consumed[iron] ?? 0
  const produced = snap.stats.produced[gear] ?? 0
  assert(produced > 0, '汇流线路没有产出')
  assert(consumed >= produced * 2, `双输入配方消耗 ${consumed}，产出 ${produced}`)
}

function blockedHead(): void {
  const r = recipe('blocked-head')
  const objects: FactoryObject[] = [
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'belt', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
    // 没有绑定配方的机器会拒收物料，模拟下游停机造成的头堵。
    { id: 'blocked-machine', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0 },
  ]
  const snap = initAndAdvance(objects, [r], 8, 14).getSnapshot()
  const lot = snap.itemLots.find((item) => item.conveyorId === 'belt')
  assert(lot, '头堵时物料不应消失')
  assert(lot.offset === 1, `头堵物料应停在末端，实际 offset=${lot.offset}`)
  assert((snap.stats.produced[gear] ?? 0) === 0, '头堵场景不应有产出')
}

function openMachineOutput(): void {
  const r = recipe('open-machine-output')
  const objects: FactoryObject[] = [
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'in', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
    // 没有下游的机器必须保留已完成产物并持续形成出料背压。
    { id: 'machine', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0, recipeId: r.id },
  ]
  const snap = initAndAdvance(objects, [r], 12, 141).getSnapshot()
  const machine = snap.machines.find((runtime) => runtime.objectId === 'machine')
  assert(machine && machine.outputQueue.length > 0, '机器无下游时产物不应被静默清空')
  assert(machine.state === 'output', `机器无下游时应保持 output，实际为 ${machine.state}`)
  assert((snap.stats.produced[gear] ?? 0) === 0, '未进入出货边界的机器产物不应计入产出')
}

function largeMachineMiddleLanes(): void {
  const r = recipe('large-machine-middle-lanes')
  const objects: FactoryObject[] = [
    { id: 'supply', type: 'inboundWarehouse', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'in', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0 },
    // 3x2 CNC 的背面入口列有两个格子，默认选中中间 lane 收料。
    { id: 'large', type: 'smelter', pos: { x: 0, z: -1 }, rotation: 0, recipeId: r.id },
    // 出口同样落在前面列的选中 lane 上，随后送入出货仓库计量。
    { id: 'out', type: 'conveyor', pos: { x: 3, z: 0 }, rotation: 0 },
    { id: 'sink', type: 'outboundWarehouse', pos: { x: 4, z: -1 }, rotation: 0 },
  ]
  const snap = initAndAdvance(objects, [r], 24, 15).getSnapshot()
  const machine = snap.machines.find((runtime) => runtime.objectId === 'large')
  assert(machine && machine.processingTime > 0, '大尺寸设备没有从选中入口通道收料')
  assert((snap.stats.produced[gear] ?? 0) > 0, '大尺寸设备的出口通道没有产出')
}

function sourceTransferLifecycle(): void {
  const objects: FactoryObject[] = [
    // 货物存取站 4x4：后面居中 2x2 泊位停靠真实货架，前面选中 lane 接传送带。
    { id: 'station', type: 'source', pos: { x: 0, z: 0 }, rotation: 0, itemId: iron },
    { id: 'rack', type: 'oreMiner', pos: { x: -2, z: 1 }, rotation: 0, itemId: iron },
    { id: 'belt', type: 'conveyor', pos: { x: 4, z: 1 }, rotation: 0 },
  ]
  assertNoOverlap(objects)
  const engine = new SimulationEngine(16)
  engine.init(objects, [])
  let sawPicking = false
  let sawPlacing = false
  let sawGridLot = false
  let rackStock = Infinity
  for (let step = 0; step < 100; step++) {
    engine.advance(0.05)
    const snapshot = engine.getSnapshot()
    const state = snapshot.sources.find((source) => source.objectId === 'station')?.state
    sawPicking ||= state === 'picking'
    sawPlacing ||= state === 'placing'
    sawGridLot ||= snapshot.itemLots.some((lot) => lot.conveyorId === 'belt')
    const rack = snapshot.racks.find((entry) => entry.objectId === 'rack')
    if (rack) rackStock = Math.min(rackStock, Object.values(rack.inventory).reduce((sum, qty) => sum + qty, 0))
  }
  assert(sawPicking && sawPlacing, '存取站 did not pass through picking and placing states')
  assert(sawGridLot, '存取站 did not hand the item to the grid conveyor')
  assert(rackStock < Infinity && rackStock < 24, `存取站 did not withdraw real stock from the docked rack (min=${rackStock})`)
}

function longAdvance(): void {
  const engine = new SimulationEngine(17)
  engine.init([], [])
  engine.advance(1800)
  assert(Math.abs(engine.getSnapshot().timeSec - 1800) < 0.05, `长时仿真被截断为 ${engine.getSnapshot().timeSec}s`)
}

const cases: Array<[string, () => void]> = [
  ['基础闭环', closedLoop],
  ['90° 转弯线路', turningRoute],
  ['三向分流', splitterRoute],
  ['双输入汇流', mergerRoute],
  ['下游拒收头堵', blockedHead],
]

cases.push(['large-machine-middle-lanes', largeMachineMiddleLanes])
cases.push(['机器开放输出端背压', openMachineOutput])
cases.push(['source-transfer-lifecycle', sourceTransferLifecycle])
cases.push(['long-advance-no-truncation', longAdvance])

const passed = cases.filter(([name, fn]) => runCase(name, fn)).length
console.log(`\n仿真回归：${passed}/${cases.length} 通过`)
if (passed !== cases.length) process.exit(1)
