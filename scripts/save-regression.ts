import { strict as assert } from 'node:assert'
import { BASE_A01_OBJECTS } from '../src/game/baseA01'
import { DEFAULT_ITEMS, DEFAULT_RECIPES } from '../src/game/item'
import { parseSave, SAVE_VERSION, serializeSave, type FactorySave } from '../src/game/save'
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

assert.throws(() => parseSave(JSON.stringify({ ...save, version: 99 })), /不支持的存档版本/)
assert.throws(() => parseSave(JSON.stringify({ ...save, objects: [{ ...save.objects[0], type: 'unknown' }] })), /对象类型非法/)
assert.throws(() => parseSave(JSON.stringify({ ...save, objects: [save.objects[0], save.objects[0]] })), /对象 id 重复/)

console.log(`存档回归：${roundTripped.objects.length} 个设备完整往返，v1 → v${SAVE_VERSION} 迁移通过`)
