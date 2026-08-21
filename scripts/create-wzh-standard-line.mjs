import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localRequire = createRequire(import.meta.url)
const output = path.join(root, 'scripts', 'wzh-standard-line.json')

const bundled = await build({
  entryPoints: [path.join(root, 'src/game/baseA01.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  write: false,
})
const moduleRecord = { exports: {} }
vm.runInNewContext(bundled.outputFiles[0].text, {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require: localRequire,
  console,
  process,
})

const { createBaseA01Layout } = moduleRecord.exports
const gridBundled = await build({
  entryPoints: [path.join(root, 'src/game/grid.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  write: false,
})
const gridModuleRecord = { exports: {} }
vm.runInNewContext(gridBundled.outputFiles[0].text, {
  module: gridModuleRecord,
  exports: gridModuleRecord.exports,
  require: localRequire,
  console,
  process,
})
const { objectPortCells, occupiedCells, stationRackDocks } = gridModuleRecord.exports
const objects = createBaseA01Layout().map((object) => ({
  ...object,
  pos: { ...object.pos },
  agvProgram: object.agvProgram ? { ...object.agvProgram } : undefined,
}))
const ids = new Set(objects.map((object) => object.id))

function add(object) {
  if (ids.has(object.id)) throw new Error(`duplicate object id: ${object.id}`)
  ids.add(object.id)
  objects.push(object)
}

function addInputRack(sourceId, rackId, itemId, initialQuantity) {
  const source = objects.find((object) => object.id === sourceId)
  if (!source) throw new Error(`missing input source: ${sourceId}`)
  const occupied = new Set(objects
    .filter((object) => (object.floorId ?? 1) === (source.floorId ?? 1))
    .flatMap(occupiedCells)
    .map((cell) => `${cell.x},${cell.z}`))
  const dock = stationRackDocks(source).find((candidate) => candidate.cells.every((cell) => {
    if (cell.x < -24 || cell.x > 23 || cell.z < -24 || cell.z > 23) return false
    return !occupied.has(`${cell.x},${cell.z}`)
  }))
  if (!dock) throw new Error(`no free cargo rack dock for source: ${sourceId}`)
  add({
    id: rackId,
    type: 'storage',
    floorId: source.floorId ?? 1,
    pos: dock.anchor,
    rotation: 0,
    displayName: `${sourceId} 供料货架`,
    storageConfig: { capacity: 240, initialInventory: initialQuantity > 0 ? { [itemId]: initialQuantity } : {} },
  })
}

// Pair every floor input station with a real cargo rack so the line is
// executable in the simulator rather than leaving decorative inputs.
addInputRack('l2_infeed_steel', 'wzh_l2_steel_input_rack', 'item_steel_blank', 24)
addInputRack('l2_infeed_sheet', 'wzh_l2_sheet_input_rack', 'item_steel_sheet', 24)
addInputRack('l2_infeed_copper', 'wzh_l2_copper_input_rack', 'item_copper_wire', 24)
addInputRack('l2_infeed_fastener', 'wzh_l2_fastener_input_rack', 'item_fastener', 96)
addInputRack('l3_infeed_clean_part', 'wzh_l3_clean_input_rack', 'item_clean_part', 0)
addInputRack('l3_infeed_shell', 'wzh_l3_shell_input_rack', 'item_stamped_shell', 24)
addInputRack('l3_infeed_kit', 'wzh_l3_kit_input_rack', 'item_fastener_kit', 24)
addInputRack('l3_infeed_coil', 'wzh_l3_coil_input_rack', 'item_coil', 24)

function convertBufferToStoreStation(bufferId, stationId, upstreamId) {
  const buffer = objects.find((object) => object.id === bufferId)
  const upstream = objects.find((object) => object.id === upstreamId)
  if (!buffer || !upstream) throw new Error(`missing buffer route: ${bufferId} <- ${upstreamId}`)
  const station = {
    id: stationId,
    type: 'source',
    floorId: buffer.floorId ?? 1,
    pos: { ...buffer.pos },
    rotation: buffer.rotation,
    displayName: `${bufferId} 入架站`,
    stationProgram: { mode: 'store', transferIntervalSec: 0.5, rackAssignments: {} },
  }
  const occupied = new Set(objects
    .filter((object) => object.id !== bufferId && (object.floorId ?? 1) === (buffer.floorId ?? 1))
    .flatMap(occupiedCells)
    .map((cell) => `${cell.x},${cell.z}`))
  const upstreamCells = occupiedCells(upstream)
  const upstreamOutput = objectPortCells(upstream, 'output')[0]
  const stationCandidate = upstreamOutput && Array.from({ length: 9 }, (_, x) => x - 4)
    .flatMap((x) => Array.from({ length: 9 }, (_, z) => z - 4).map((z) => ({ x: buffer.pos.x + x, z: buffer.pos.z + z })))
    .flatMap((pos) => [0, 90, 180, 270].map((rotation) => ({ ...station, pos, rotation })))
    .find((candidate) => {
      const cells = occupiedCells(candidate)
      return cells.some((cell) => cell.x === upstreamOutput.x && cell.z === upstreamOutput.z)
        && objectPortCells(candidate, 'input').some((cell) => upstreamCells.some((upstreamCell) => upstreamCell.x === cell.x && upstreamCell.z === cell.z))
        && cells.every((cell) => !occupied.has(`${cell.x},${cell.z}`))
    })
  if (!stationCandidate) throw new Error(`no store station route: ${bufferId} <- ${upstreamId}`)
  Object.assign(station, stationCandidate)
  const dock = stationRackDocks(station).find((candidate) => candidate.cells.every((cell) => {
    if (cell.x < -24 || cell.x > 23 || cell.z < -24 || cell.z > 23) return false
    return !occupied.has(`${cell.x},${cell.z}`)
  }))
  if (!dock) throw new Error(`no free buffer rack dock: ${bufferId}`)
  buffer.pos = dock.anchor
  buffer.rotation = 0
  add(station)
}

// The simulation receives a rack through a cargo access station. Keep the
// visible storage buffers, but give each in-line buffer a real store station
// so produced lots can be deposited and later picked up by AGVs or the drone.
for (const [bufferId, stationId, upstreamId] of [
  ['l2_clean_buffer', 'wzh_l2_clean_buffer_station', 'l2_cv_clean_02'],
  ['l2_shell_buffer', 'wzh_l2_shell_buffer_station', 'l2_cv_shell_02'],
  ['l2_coil_buffer', 'wzh_l2_coil_buffer_station', 'l2_cv_coil_02'],
  ['l2_kit_buffer', 'wzh_l2_kit_buffer_station', 'l2_cv_kit_02'],
  ['l3_finished_buffer', 'wzh_l3_finished_buffer_station', 'l3_cv_finished'],
]) convertBufferToStoreStation(bufferId, stationId, upstreamId)
const drone = objects.find((object) => object.id === 'a01_drone_logistics_01')
if (drone?.agvProgram) {
  drone.agvProgram = { ...drone.agvProgram, destinationObjectId: 'wzh_l3_clean_input_rack' }
}

// L1 receiving boundary. The inbound warehouse continuously supplies steel;
// the AGV moves pallet quantities into the finite raw-material rack.
add({
  id: 'wzh_inbound_warehouse',
  type: 'inboundWarehouse',
  floorId: 1,
  pos: { x: -24, z: -20 },
  rotation: 0,
  itemId: 'item_steel_blank',
  displayName: 'WZH 入货仓库',
})
add({
  id: 'wzh_agv_inbound',
  type: 'agv',
  floorId: 1,
  pos: { x: -20, z: -20 },
  rotation: 0,
  agvProgram: {
    enabled: true,
    sourceObjectId: 'wzh_inbound_warehouse',
    destinationObjectId: 'a01_raw_material_rack',
    itemId: 'item_steel_blank',
    loadQuantity: 24,
    priority: 3,
    policy: 'priority',
    dispatchMode: 'continuous',
  },
})

// A real up-link from L1 to L2 and a return down-link from L3 to L2.
add({
  id: 'wzh_incline_up_1_2',
  type: 'inclineUp',
  floorId: 1,
  pos: { x: -17, z: 20 },
  rotation: 0,
  incline: {
    direction: 'up',
    lowerFloorId: 1,
    upperFloorId: 2,
    lowPos: { x: -17, z: 20 },
    highPos: { x: -10, z: 20 },
    riseM: 5.25,
    runM: 7,
  },
})
add({
  id: 'wzh_incline_down_3_2',
  type: 'inclineDown',
  floorId: 3,
  pos: { x: 10, z: 20 },
  rotation: 180,
  incline: {
    direction: 'down',
    lowerFloorId: 2,
    upperFloorId: 3,
    lowPos: { x: 17, z: 20 },
    highPos: { x: 10, z: 20 },
    riseM: 5.25,
    runM: 7,
  },
})

// L3 dispatch boundary. An AGV clears the finite finished-goods buffer into
// the outbound warehouse after inspection and packaging.
add({
  id: 'wzh_outbound_warehouse',
  type: 'outboundWarehouse',
  floorId: 3,
  pos: { x: 18, z: 8 },
  rotation: 180,
  displayName: 'WZH 出货仓库',
})
add({
  id: 'wzh_agv_finished_dispatch',
  type: 'agv',
  floorId: 3,
  pos: { x: 17, z: 5 },
  rotation: 0,
  agvProgram: {
    enabled: true,
    sourceObjectId: 'l3_finished_buffer',
    destinationObjectId: 'wzh_outbound_warehouse',
    itemId: 'item_inspected_motor',
    loadQuantity: 12,
    priority: 3,
    policy: 'shortest',
    dispatchMode: 'continuous',
  },
})

// The standard line also contains an explicit merge point and a user-defined
// finishing cell, so every built-in construction type is represented.
add({ id: 'wzh_l3_output_merger', type: 'merger', floorId: 3, pos: { x: 1, z: 14 }, rotation: 0 })
add({
  id: 'wzh_precision_finishing',
  type: 'machine',
  resourceId: 'wzh_precision_finishing_machine',
  floorId: 3,
  pos: { x: 15, z: 6 },
  rotation: 0,
  recipeId: 'recipe_packaging',
})

const machineDefinitions = [{
  id: 'wzh_precision_finishing_machine',
  name: '精加工与包装工作站',
  description: '完成终检后的成品精加工、标签和包装准备。',
  modelType: 'machine',
  footprint: { w: 1, d: 1 },
  height: 1.6,
  throughput: '24 / min',
  power: '12 kW',
  inputPortCount: 1,
  outputPortCount: 1,
  recipeIds: ['recipe_packaging'],
}]

// Give the finite racks meaningful initial inventory and explicit station
// behavior. The base layout remains the tested A-01 process topology.
for (const object of objects) {
  if (object.type === 'oreMiner' || object.type === 'storage') {
    object.storageConfig ??= { capacity: 240, initialInventory: {} }
    object.storageConfig.capacity = Math.max(object.storageConfig.capacity, 240)
  }
}
const rawRack = objects.find((object) => object.id === 'a01_raw_material_rack')
if (rawRack?.storageConfig) rawRack.storageConfig.initialInventory = { item_steel_blank: 24 }
const sheetRack = objects.find((object) => object.id === 'a01_warehouse_raw_rack_01')
if (sheetRack?.storageConfig) sheetRack.storageConfig.initialInventory = { item_steel_sheet: 24, item_fastener: 48 }
const copperRack = objects.find((object) => object.id === 'a01_warehouse_raw_rack_02')
if (copperRack?.storageConfig) copperRack.storageConfig.initialInventory = { item_copper_wire: 24 }

const save = {
  version: 6,
  savedAt: new Date().toISOString(),
  name: 'WZH 三层标准电机生产线',
  floorCount: 3,
  floorNames: ['1F 原料接收与总装卸', '2F 零部件加工与齐套', '3F 总装、质检与出货'],
  objects,
  items: [
    { id: 'item_steel_blank', name: '钢制毛坯', category: 'raw', color: '#87959a', size: 1, modelPath: 'material/ingot.glb', modelId: 'RAW_INGOT' },
    { id: 'item_screw', name: '螺丝', category: 'raw', color: '#6d7b7b', size: 1, modelPath: 'mechanical/bolt.glb', modelId: 'PART_BOLT' },
    { id: 'item_steel_sheet', name: '冷轧钢板', category: 'raw', color: '#9ba8aa', size: 1, modelPath: 'material/plate.glb', modelId: 'MATERIAL_PLATE' },
    { id: 'item_copper_wire', name: '铜线盘', category: 'raw', color: '#c87948', size: 1, modelPath: 'material/wire-coil.glb', modelId: 'MATERIAL_WIRE_COIL' },
    { id: 'item_fastener', name: '标准紧固件', category: 'raw', color: '#6d7b7b', size: 1, modelPath: 'mechanical/bolt.glb', modelId: 'PART_BOLT' },
    { id: 'item_fastener_kit', name: '紧固件齐套包', category: 'intermediate', color: '#7f8b88', size: 1, modelPath: 'package/box.glb', modelId: 'PACK_BOX' },
    { id: 'item_machined_housing', name: '机加工壳体', category: 'intermediate', color: '#71868a', size: 1, modelPath: 'material/chunk.glb', modelId: 'RAW_CHUNK' },
    { id: 'item_stamped_shell', name: '冲压壳体', category: 'intermediate', color: '#8a9ca0', size: 1, modelPath: 'material/plate.glb', modelId: 'MATERIAL_PLATE' },
    { id: 'item_clean_part', name: '洁净零件', category: 'intermediate', color: '#5f9c9c', size: 1, modelPath: 'mechanical/gear.glb', modelId: 'PART_GEAR' },
    { id: 'item_coil', name: '定子线圈', category: 'intermediate', color: '#c28e35', size: 1, modelPath: 'material/coil.glb', modelId: 'MATERIAL_COIL' },
    { id: 'item_motor', name: '电机总成', category: 'product', color: '#4c9fa0', size: 1, modelPath: 'electronic/motor.glb', modelId: 'ELEC_MOTOR' },
    { id: 'item_inspected_motor', name: '已检电机', category: 'product', color: '#3f9d79', size: 1, modelPath: 'electronic/motor.glb', modelId: 'ELEC_MOTOR' },
  ],
  recipes: [
    { id: 'recipe_machining', name: '数控车铣复合', inputs: [{ itemId: 'item_steel_blank', qty: 1 }], outputs: [{ itemId: 'item_machined_housing', qty: 1 }], durationSec: 6 },
    { id: 'recipe_stamping', name: '板材冲压成型', inputs: [{ itemId: 'item_steel_sheet', qty: 1 }], outputs: [{ itemId: 'item_stamped_shell', qty: 1 }], durationSec: 4 },
    { id: 'recipe_coil', name: '定子线圈绕制', inputs: [{ itemId: 'item_copper_wire', qty: 1 }], outputs: [{ itemId: 'item_coil', qty: 1 }], durationSec: 5.5 },
    { id: 'recipe_fastener_kit', name: '紧固件自动齐套', inputs: [{ itemId: 'item_fastener', qty: 4 }], outputs: [{ itemId: 'item_fastener_kit', qty: 1 }], durationSec: 2.5 },
    { id: 'recipe_wash', name: '去毛刺与清洗', inputs: [{ itemId: 'item_machined_housing', qty: 1 }], outputs: [{ itemId: 'item_clean_part', qty: 1 }], durationSec: 3.5 },
    { id: 'recipe_motor', name: '电机自动装配', inputs: [{ itemId: 'item_clean_part', qty: 1 }, { itemId: 'item_stamped_shell', qty: 1 }, { itemId: 'item_fastener_kit', qty: 1 }, { itemId: 'item_coil', qty: 1 }], outputs: [{ itemId: 'item_motor', qty: 1 }], durationSec: 8 },
    { id: 'recipe_inspection', name: '视觉终检与追溯', inputs: [{ itemId: 'item_motor', qty: 1 }], outputs: [{ itemId: 'item_inspected_motor', qty: 1 }], durationSec: 2 },
    { id: 'recipe_packaging', name: '成品包装入库', inputs: [{ itemId: 'item_inspected_motor', qty: 1 }], outputs: [{ itemId: 'item_inspected_motor', qty: 1 }], durationSec: 3 },
  ],
  machineDefinitions,
}

fs.writeFileSync(output, `${JSON.stringify(save, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ output, floors: save.floorCount, objects: save.objects.length, items: save.items.length, recipes: save.recipes.length, machineDefinitions: save.machineDefinitions.length }, null, 2))
