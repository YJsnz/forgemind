/**
 * 仿真核心纯函数单元回归。
 *
 * 场景级回归（sim:regression）失败时难以定位到函数级，本脚本直接钉住
 * simulation 内核依赖的最小契约：
 * - dir：旋转角与四邻方向的唯一换算
 * - grid：足迹、占格、放置合法性、端口格与货架泊位
 * - types：关键对象尺寸契约（历史上 fixture 断链的根因）
 * - rng / floorConfig：确定性与边界钳制
 *
 * 运行：npm run sim:units
 */
import { cellKey, dirToRotation, reverseDir, rotationToDir } from '../src/game/dir'
import {
  canPlace,
  cellsOverlap,
  gridToWorld,
  isOutOfBounds,
  objectCompatiblePortCells,
  objectPortCell,
  objectPortCells,
  occupiedCells,
  rotatedFootprint,
  snapCargoStoragePlacement,
  stationRackDocks,
} from '../src/game/grid'
import { clampFloorCount, MAX_FACTORY_FLOORS, MIN_FACTORY_FLOORS } from '../src/game/floorConfig'
import { mulberry32 } from '../src/game/rng'
import { BUILD_BOUND, getObjectDef } from '../src/game/types'
import type { FactoryObject, GridPos } from '../src/game/types'

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log(`✅ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`❌ ${name}: ${(error as Error).message}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function eq(actual: unknown, expected: unknown, label: string): void {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  assert(left === right, `${label}: 期望 ${right}，实际 ${left}`)
}

const at = (x: number, z: number): GridPos => ({ x, z })
const obj = (patch: Partial<FactoryObject>): FactoryObject => ({ id: 'o', type: 'conveyor', pos: at(0, 0), rotation: 0, ...patch })

// —— dir ——
test('dir: rotationToDir 四向换算', () => {
  eq(rotationToDir(0), { dx: 1, dz: 0 }, '0')
  eq(rotationToDir(90), { dx: 0, dz: 1 }, '90')
  eq(rotationToDir(180), { dx: -1, dz: 0 }, '180')
  eq(rotationToDir(270), { dx: 0, dz: -1 }, '270')
})

test('dir: dirToRotation 与 rotationToDir 互逆', () => {
  for (const r of [0, 90, 180, 270] as const) {
    eq(dirToRotation(rotationToDir(r)), r, `rotation ${r}`)
  }
})

test('dir: reverseDir 取反且 cellKey 稳定', () => {
  eq(reverseDir({ dx: 2, dz: -3 }), { dx: -2, dz: 3 }, 'reverse')
  eq(cellKey(-4, 7), '-4,7', 'cellKey')
})

// —— footprint / 占格 ——
test('grid: rotatedFootprint 在 90/270 交换宽深', () => {
  const fp = { w: 3, d: 2 }
  eq(rotatedFootprint(fp, 0), { w: 3, d: 2 }, '0')
  eq(rotatedFootprint(fp, 90), { w: 2, d: 3 }, '90')
  eq(rotatedFootprint(fp, 180), { w: 3, d: 2 }, '180')
  eq(rotatedFootprint(fp, 270), { w: 2, d: 3 }, '270')
})

test('grid: occupiedCells 数量等于旋转后足迹面积', () => {
  eq(occupiedCells(obj({ type: 'smelter', pos: at(1, -1), rotation: 0 })).length, 6, 'smelter 3x2 @0')
  eq(occupiedCells(obj({ type: 'smelter', pos: at(1, -1), rotation: 90 })).length, 6, 'smelter 3x2 @90')
  eq(occupiedCells(obj({ type: 'machine', pos: at(0, 0), rotation: 0 })).length, 1, 'machine 1x1')
})

test('grid: gridToWorld 锚点在格中心', () => {
  eq(gridToWorld(at(3, -2)), { x: 3.5, z: -1.5 }, 'centre')
})

test('grid: isOutOfBounds 尊重 BUILD_BOUND', () => {
  assert(!isOutOfBounds(at(BUILD_BOUND - 1, 0), { w: 1, d: 1 }), '贴边内应合法')
  // 边界为闭区间：恰好压在 ±BUILD_BOUND 的格子仍然合法。
  assert(!isOutOfBounds(at(BUILD_BOUND, -BUILD_BOUND), { w: 1, d: 1 }), '边界格本身合法')
  assert(isOutOfBounds(at(BUILD_BOUND + 1, 0), { w: 1, d: 1 }), '越出东界应非法')
  assert(isOutOfBounds(at(0, -(BUILD_BOUND + 1)), { w: 1, d: 1 }), '越出北界应非法')
})

test('grid: cellsOverlap 与 canPlace 碰撞判定', () => {
  assert(cellsOverlap([at(0, 0)], [at(0, 0)]), '同格重叠')
  assert(!cellsOverlap([at(0, 0)], [at(1, 0)]), '相邻不重叠')
  const others = [obj({ id: 'a', type: 'machine', pos: at(2, 2) })]
  assert(canPlace(at(0, 0), 'machine', 0, others), '空位可放置')
  assert(!canPlace(at(1, 1), 'smelter', 0, others), '3x2 压住已有机器应拒绝')
  // pos 是最小角锚点：3x3 放到 (-26,0) 时 minX 越出负边界。
  assert(!canPlace(at(-BUILD_BOUND - 2, 0), 'inboundWarehouse', 0, []), '3x3 越出负边界应拒绝')
  assert(canPlace(at(-BUILD_BOUND, 0), 'inboundWarehouse', 0, []), '贴住负边界的 3x3 合法')
})

// —— 对象尺寸契约（fixture 断链的历史根因）——
test('types: 关键对象默认足迹契约', () => {
  eq(getObjectDef('source').footprint, { w: 4, d: 4 }, '货物存取站 4x4')
  eq(getObjectDef('smelter').footprint, { w: 3, d: 2 }, 'CNC 3x2')
  eq(getObjectDef('inboundWarehouse').footprint, { w: 3, d: 3 }, '入货仓库 3x3')
  eq(getObjectDef('outboundWarehouse').footprint, { w: 3, d: 3 }, '出货仓库 3x3')
  eq(getObjectDef('machine').footprint, { w: 1, d: 1 }, '通用机器 1x1')
  eq(getObjectDef('conveyor').footprint, { w: 1, d: 1 }, '传送带 1x1')
})

// —— 端口格 ——
test('grid: 1x1 机器输入在西、输出在东（rotation 0）', () => {
  const machine = obj({ type: 'machine', pos: at(5, 5), rotation: 0 })
  eq(objectPortCell(machine, 'input'), at(4, 5), 'input')
  eq(objectPortCell(machine, 'output'), at(6, 5), 'output')
})

test('grid: 传送带入口接受背/左/右三向', () => {
  const belt = obj({ type: 'conveyor', pos: at(0, 0), rotation: 0 })
  const inputs = objectPortCells(belt, 'input')
  assert(inputs.some((c) => c.x === -1 && c.z === 0), 'back')
  assert(inputs.some((c) => c.x === 0 && c.z === 1), 'left')
  assert(inputs.some((c) => c.x === 0 && c.z === -1), 'right')
  assert(!inputs.some((c) => c.x === 1 && c.z === 0), 'front 不是入口')
  eq(objectPortCells(belt, 'output'), [at(1, 0)], 'output')
})

test('grid: 分流器三出一旦入口，汇流器三入一出口', () => {
  const split = obj({ type: 'splitter', pos: at(0, 0), rotation: 0 })
  const splitOut = objectPortCells(split, 'output')
  assert(splitOut.some((c) => c.x === 1 && c.z === 0), 'front 出口')
  assert(splitOut.some((c) => c.x === 0 && c.z === 1), 'left 出口')
  assert(splitOut.some((c) => c.x === 0 && c.z === -1), 'right 出口')
  eq(objectPortCells(split, 'input'), [at(-1, 0)], 'splitter input')

  const merge = obj({ type: 'merger', pos: at(0, 0), rotation: 0 })
  const mergeIn = objectPortCells(merge, 'input')
  assert(mergeIn.some((c) => c.x === -1 && c.z === 0), 'back 入口')
  assert(mergeIn.some((c) => c.x === 0 && c.z === 1), 'left 入口')
  assert(mergeIn.some((c) => c.x === 0 && c.z === -1), 'right 入口')
  eq(objectPortCells(merge, 'output'), [at(1, 0)], 'merger output')
})

test('grid: 存取站取货模式只有前面一个选中 lane，存货模式反向', () => {
  const station = obj({ type: 'source', pos: at(0, 0), rotation: 0, itemId: 'item_iron' })
  eq(objectCompatiblePortCells(station, 'output'), [at(4, 1)], 'pickup output lane')
  eq(objectPortCells(station, 'input'), [], 'pickup 无输入')

  const store = obj({ type: 'source', pos: at(0, 0), rotation: 0, stationProgram: { mode: 'store', rackAssignments: {} } })
  eq(objectCompatiblePortCells(store, 'input'), [at(4, 1)], 'store input lane')
  eq(objectPortCells(store, 'output'), [], 'store 无输出')
})

test('grid: 4x4 存取站背面泊位是居中 2x2 且锚点可吸附 2x2 货架', () => {
  const station = obj({ id: 'station', type: 'source', pos: at(0, 0), rotation: 0 })
  const docks = stationRackDocks(station)
  eq(docks.length, 3, 'back/left/right 三泊位')
  const back = docks[0]
  eq(back.side, 'back', '第一泊位是背面')
  eq(back.cells.length, 4, '泊位含接触与外扩两层共 4 格')
  for (const cell of back.cells) {
    assert(cell.x <= -1 && cell.z >= 1 && cell.z <= 2, `背面泊位格 ${JSON.stringify(cell)} 应在居中区域`)
  }
  // 泊位锚点处放置 2x2 货架必须与站体不碰撞。
  assert(back.cells.every((cell) => cell.x < 0 || cell.z > 3), '泊位不得压住站体')
})

test('grid: 靠近泊位放置货架吸附到泊位锚点，远离时不吸附', () => {
  const station = obj({ id: 'station', type: 'source', pos: at(10, 10), rotation: 0 })
  const snapped = snapCargoStoragePlacement(at(7, 12), 'oreMiner', 0, 1, [station])
  eq(snapped, at(8, 11), '背面泊位锚点')
  const free = snapCargoStoragePlacement(at(-20, -20), 'oreMiner', 0, 1, [station])
  eq(free, at(-20, -20), '远离泊位保持原位')
})

// —— rng / floorConfig ——
test('rng: mulberry32 同种子序列逐位一致且落在 [0,1)', () => {
  const a = mulberry32(20260813)
  const b = mulberry32(20260813)
  let sawValue = false
  for (let index = 0; index < 256; index++) {
    const left = a()
    const right = b()
    assert(left === right, `第 ${index} 位序列分叉`)
    assert(left >= 0 && left < 1, `数值 ${left} 超界`)
    sawValue ||= left !== 0
  }
  assert(sawValue, '序列不应恒为 0')
})

test('rng: 不同种子序列不同', () => {
  const a = mulberry32(1)
  const b = mulberry32(2)
  const diverged = Array.from({ length: 16 }, (_, index) => index).some(() => a() !== b())
  assert(diverged, '不同种子不应产生相同序列')
})

test('floorConfig: clampFloorCount 钳制到内置层数范围', () => {
  eq(clampFloorCount(MIN_FACTORY_FLOORS), MIN_FACTORY_FLOORS, '下界')
  eq(clampFloorCount(MAX_FACTORY_FLOORS), MAX_FACTORY_FLOORS, '上界')
  eq(clampFloorCount(-5), MIN_FACTORY_FLOORS, '低于下界回退最小值')
  eq(clampFloorCount(MAX_FACTORY_FLOORS + 9), MAX_FACTORY_FLOORS, '高于上界回退最大值')
})

console.log(`\n仿真核心单元回归：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
