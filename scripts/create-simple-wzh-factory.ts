import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { FactorySave } from '../src/game/save'
import type { FactoryObject, ItemDefinition, RecipeDefinition } from '../src/game/types'
import { SimulationEngine } from '../src/game/simulation'
import { stationRackDocks } from '../src/game/grid'

const ownerId = 'd255c9ba-6d5f-45c3-ba71-384c709d528b'
const baselinePatchId = 'patch-b02a210e-8cf9-4251-8601-03dc73398ca5'
const name = 'WZH 三层轻量完整产线'
const raw = execFileSync('docker', ['exec', 'forgemind-mysql', 'mysql', '-N', '-B', '-uforgemind', '-pforgemind', 'forgemind', '-e', `SELECT backup_save_json FROM agent_patch WHERE id='${baselinePatchId}' LIMIT 1`], { encoding: 'utf8' }).trim()
if (!raw) throw new Error('找不到物品模型基线')
const baseline = JSON.parse(raw) as FactorySave

const itemIds = ['item_steel_blank', 'item_machined_housing', 'item_clean_part', 'item_inspected_motor']
const items = baseline.items.filter((item) => itemIds.includes(item.id)) as ItemDefinition[]
const recipes: RecipeDefinition[] = [
  { id: 'simple_l1_machining', name: 'L1 毛坯加工', inputs: [{ itemId: 'item_steel_blank', qty: 1 }], outputs: [{ itemId: 'item_machined_housing', qty: 1 }], durationSec: 4 },
  { id: 'simple_l2_cleaning', name: 'L2 精加工与清洗', inputs: [{ itemId: 'item_machined_housing', qty: 1 }], outputs: [{ itemId: 'item_clean_part', qty: 1 }], durationSec: 4 },
  { id: 'simple_l3_assembly', name: 'L3 装配、质检与包装', inputs: [{ itemId: 'item_clean_part', qty: 1 }], outputs: [{ itemId: 'item_inspected_motor', qty: 1 }], durationSec: 5 },
]
const objects: FactoryObject[] = []

function add(object: FactoryObject) {
  objects.push(object)
  return object
}

function buildFloorLine(floorId: 1 | 2 | 3, inputItemId: string, outputItemId: string, recipeId: string, label: string) {
  const pickup = add({
    id: `simple_l${floorId}_pickup`, type: 'source', floorId, pos: { x: -12, z: -2 }, rotation: 0,
    itemId: inputItemId, displayName: `${label} 供料站`,
    stationProgram: { mode: 'pickup', transferIntervalSec: 4, rackAssignments: { [inputItemId]: 'left' } },
  })
  const inputDock = stationRackDocks(pickup).find((dock) => dock.side === 'left')!
  const inputRack = add({
    id: `simple_l${floorId}_input_rack`, type: 'storage', floorId, pos: inputDock.anchor, rotation: 0,
    displayName: `${label} 输入货架`, storageConfig: { capacity: 80, initialInventory: {} },
  })
  for (let x = -8; x <= -6; x += 1) add({ id: `simple_l${floorId}_in_cv_${x}`, type: 'conveyor', floorId, pos: { x, z: -1 }, rotation: 0 })
  add({
    id: `simple_l${floorId}_machine`, type: 'machine', floorId, pos: { x: -5, z: -1 }, rotation: 0,
    displayName: `${label} 工艺工作站`, recipeId,
  })
  for (let x = -4; x <= -2; x += 1) add({ id: `simple_l${floorId}_out_cv_${x}`, type: 'conveyor', floorId, pos: { x, z: -1 }, rotation: 0 })
  const store = add({
    id: `simple_l${floorId}_store`, type: 'source', floorId, pos: { x: -1, z: -3 }, rotation: 180,
    displayName: `${label} 成品入架站`,
    stationProgram: { mode: 'store', transferIntervalSec: 0.8, rackAssignments: { [outputItemId]: 'left' } },
  })
  const outputDock = stationRackDocks(store).find((dock) => dock.side === 'left')!
  const outputRack = add({
    id: `simple_l${floorId}_output_rack`, type: 'storage', floorId, pos: outputDock.anchor, rotation: 0,
    displayName: `${label} 输出货架`, storageConfig: { capacity: 80, initialInventory: {} },
  })
  return { inputRack, outputRack }
}

const l1 = buildFloorLine(1, 'item_steel_blank', 'item_machined_housing', 'simple_l1_machining', 'L1 原料加工')
const l2 = buildFloorLine(2, 'item_machined_housing', 'item_clean_part', 'simple_l2_cleaning', 'L2 精加工')
const l3 = buildFloorLine(3, 'item_clean_part', 'item_inspected_motor', 'simple_l3_assembly', 'L3 装配交付')

const inbound = add({ id: 'simple_inbound', type: 'inboundWarehouse', floorId: 1, pos: { x: -22, z: -2 }, rotation: 0, itemId: 'item_steel_blank', displayName: 'L1 原料入货仓库' })
add({
  id: 'simple_inbound_agv', type: 'agv', floorId: 1, pos: { x: -18, z: 5 }, rotation: 0, displayName: 'L1 原料接驳 AGV',
  agvProgram: { enabled: true, sourceObjectId: inbound.id, destinationObjectId: l1.inputRack.id, itemId: 'item_steel_blank', loadQuantity: 4, dispatchMode: 'continuous', sourceMinQuantity: 1, destinationMaxQuantity: 40, policy: 'shortest', priority: 3 },
})
add({
  id: 'simple_l1_l2_drone', type: 'drone', floorId: 1, pos: { x: 7, z: -9 }, rotation: 0, displayName: 'L1→L2 工序无人机',
  agvProgram: { enabled: true, sourceObjectId: l1.outputRack.id, destinationObjectId: l2.inputRack.id, itemId: 'item_machined_housing', loadQuantity: 2, dispatchMode: 'continuous', sourceMinQuantity: 2, destinationMaxQuantity: 36, policy: 'shortest', priority: 3 },
})
add({
  id: 'simple_l2_l3_drone', type: 'drone', floorId: 2, pos: { x: 7, z: 0 }, rotation: 0, displayName: 'L2→L3 工序无人机',
  agvProgram: { enabled: true, sourceObjectId: l2.outputRack.id, destinationObjectId: l3.inputRack.id, itemId: 'item_clean_part', loadQuantity: 2, dispatchMode: 'continuous', sourceMinQuantity: 2, destinationMaxQuantity: 36, policy: 'shortest', priority: 3 },
})
const outbound = add({ id: 'simple_outbound', type: 'outboundWarehouse', floorId: 3, pos: { x: 13, z: -2 }, rotation: 180, displayName: 'L3 成品出货仓库' })
add({
  id: 'simple_outbound_agv', type: 'agv', floorId: 3, pos: { x: 7, z: 5 }, rotation: 0, displayName: 'L3 成品出货 AGV',
  agvProgram: { enabled: true, sourceObjectId: l3.outputRack.id, destinationObjectId: outbound.id, itemId: 'item_inspected_motor', loadQuantity: 2, dispatchMode: 'continuous', sourceMinQuantity: 2, destinationMaxQuantity: 9999, policy: 'shortest', priority: 3 },
})

const save: FactorySave = {
  version: 6,
  savedAt: new Date().toISOString(),
  name,
  floorCount: 3,
  floorNames: ['L1 原料接收与加工', 'L2 精加工与清洗', 'L3 装配质检与出货'],
  objects,
  items,
  recipes,
  machineDefinitions: [],
}

const engine = new SimulationEngine(20260821)
engine.init(save.objects, save.recipes)
for (let second = 0; second < 600; second += 1) engine.advance(1)
const snapshot = engine.getSnapshot()
const consumed = snapshot.stats.consumed.item_steel_blank ?? 0
const produced = snapshot.stats.produced.item_inspected_motor ?? 0
if (consumed <= 0 || produced <= 0) throw new Error(`轻量产线运行验证失败：consumed=${consumed}, produced=${produced}`)

const projectId = randomUUID()
const json = JSON.stringify(save).replaceAll("'", "''")
const escapedName = name.replaceAll("'", "''")
const sql = `START TRANSACTION; INSERT INTO factory (id,owner_user_id,name,schema_version,width,depth,save_json) VALUES ('${projectId}','${ownerId}','${escapedName}',${save.version},48,48,'${json}'); INSERT INTO factory_member (factory_id,user_id,role) VALUES ('${projectId}','${ownerId}','owner'); COMMIT;`
execFileSync('docker', ['exec', 'forgemind-mysql', 'mysql', '-uforgemind', '-pforgemind', 'forgemind', '-e', sql], { stdio: 'inherit' })
console.log(JSON.stringify({ projectId, name, objects: save.objects.length, floors: save.floorCount, consumed, produced }, null, 2))
