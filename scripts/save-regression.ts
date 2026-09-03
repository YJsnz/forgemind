import { strict as assert } from 'node:assert'
import { BASE_A01_OBJECTS } from '../src/game/baseA01'
import { DEFAULT_ITEMS, DEFAULT_RECIPES } from '../src/game/item'
import { parseSave, SAVE_VERSION, serializeSave, type FactorySave } from '../src/game/save'
import { normalizeStoredLabel } from '../src/game/labelNormalization'
import type { BuildType } from '../src/game/types'

const save: FactorySave = {
  version: SAVE_VERSION,
  savedAt: '2026-08-17T00:00:00.000Z',
  objects: BASE_A01_OBJECTS,
  items: DEFAULT_ITEMS,
  recipes: DEFAULT_RECIPES,
}

const roundTripped = parseSave(serializeSave(save))
assert.equal(roundTripped.version, SAVE_VERSION)
assert.equal(roundTripped.objects.length, BASE_A01_OBJECTS.length)
assert.deepEqual(new Set(roundTripped.objects.map((object) => object.type)), new Set<BuildType>([
  'source', 'oreMiner', 'agv', 'conveyor', 'smelter', 'press', 'washing',
  'machine', 'assembler', 'inspection', 'splitter', 'storage',
  'drone',
]))

const migrated = parseSave(serializeSave({ ...save, version: 1 }))
assert.equal(migrated.version, SAVE_VERSION)
assert.equal(migrated.objects.length, save.objects.length)

const repairedText = parseSave(JSON.stringify({ ...save, name: 'WZH åŽŸæ–™å·¥åŽ‚', floorNames: ['L1 åŽŸæ–™æŽ¥æ”¶', 'L2 ç²¾åŠ å·¥', 'L3 è£…é…äº¤ä»˜'] }))
assert.equal(repairedText.name, 'WZH 原料工厂')
assert.deepEqual(repairedText.floorNames, ['L1 原料接收', 'L2 精加工', 'L3 装配交付'])
assert.equal(normalizeStoredLabel('L1 äŽŸæ–™货架', 'fallback'), 'L1 原料货架')
const repairedObjectLabel = parseSave(JSON.stringify({
  ...save,
  objects: [{ ...save.objects[0], type: 'storage', displayName: 'L1 åŽŸæ–™货架' }],
}))
assert.equal(repairedObjectLabel.objects[0].displayName, 'L1 原料货架')
const fallbackText = parseSave(JSON.stringify({ ...save, floorNames: ['1F ????????', '2F ????????', '3F ????????'] }))
assert.deepEqual(fallbackText.floorNames, ['1F 生产层', '2F 生产层', '3F 生产层'])

const repairedCatalog = parseSave(JSON.stringify({
  ...save,
  items: save.items.map((item, index) => index === 0 ? { ...item, name: '????' } : item),
  recipes: save.recipes.map((recipe, index) => index === 0 ? { ...recipe, name: 'L1 æ•°æŽ§è½¦é“£å¤åˆ' } : recipe),
}))
assert.equal(repairedCatalog.items[0].name, '钢制毛坯')
assert.equal(repairedCatalog.recipes[0].name, 'L1 数控车铣复合')

assert.throws(() => parseSave(JSON.stringify({ ...save, version: 99 })), /不支持的存档版本/)
assert.throws(() => parseSave(JSON.stringify({ ...save, objects: [{ ...save.objects[0], type: 'unknown' }] })), /对象类型非法/)
assert.throws(() => parseSave(JSON.stringify({ ...save, objects: [save.objects[0], save.objects[0]] })), /对象 id 重复/)

const rectangularMachine = parseSave(JSON.stringify({
  ...save,
  objects: [],
  machineDefinitions: [{
    id: 'rectangular-machine', name: '矩形机器', modelType: 'machine',
    footprint: { w: 1, d: 4 }, height: 1.5, throughput: '1 / min', power: '1 kW',
    inputPortCount: 4, outputPortCount: 4, recipeIds: [],
  }],
}))
assert.equal(rectangularMachine.machineDefinitions[0].inputPortCount, 4)
assert.equal(rectangularMachine.machineDefinitions[0].outputPortCount, 4)

console.log(`存档回归：${roundTripped.objects.length} 个设备完整往返，v1 → v${SAVE_VERSION} 迁移通过`)
