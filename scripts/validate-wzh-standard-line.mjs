import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localRequire = createRequire(import.meta.url)
const savePath = path.join(root, 'scripts', 'wzh-standard-line.json')

async function loadCjs(entryPoint) {
  const bundled = await build({
    entryPoints: [path.join(root, entryPoint)],
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
  return moduleRecord.exports
}

const raw = fs.readFileSync(savePath, 'utf8')
const { parseSave } = await loadCjs('src/game/save.ts')
const save = parseSave(raw)
const { SimulationEngine } = await loadCjs('src/game/simulation.ts')
const engine = new SimulationEngine(20260821)
engine.init(save.objects, save.recipes)
engine.advance(30)
const snapshot = engine.getSnapshot()

const requiredTypes = [
  'source', 'inboundWarehouse', 'outboundWarehouse', 'oreMiner', 'conveyor',
  'inclineUp', 'inclineDown', 'splitter', 'merger', 'machine', 'smelter',
  'press', 'assembler', 'inspection', 'washing', 'agv', 'drone', 'storage',
]
const presentTypes = new Set(save.objects.map((object) => object.type))
const missingTypes = requiredTypes.filter((type) => !presentTypes.has(type))
if (missingTypes.length) throw new Error(`缺少建筑设施类型: ${missingTypes.join(', ')}`)

const result = {
  schemaVersion: save.version,
  floors: save.floorCount,
  objects: save.objects.length,
  items: save.items.length,
  recipes: save.recipes.length,
  agvs: save.objects.filter((object) => object.type === 'agv').length,
  drones: save.objects.filter((object) => object.type === 'drone').length,
  missingFacilityTypes: missingTypes,
  simulatedSeconds: snapshot.timeSec,
  produced: snapshot.stats.produced,
  consumed: snapshot.stats.consumed,
  machineStates: snapshot.machines.map((machine) => ({ objectId: machine.objectId, state: machine.state, inputBuffer: machine.inputBuffer, outputQueue: machine.outputQueue })),
  blockedSources: snapshot.sources.filter((source) => source.state === 'blocked').map((source) => ({ objectId: source.objectId, itemId: source.itemId, rackObjectId: source.rackObjectId, rackConnections: source.rackConnections })),
  itemLots: snapshot.itemLots.length,
  activeAgvs: snapshot.agvs.filter((agv) => agv.state !== 'idle').length,
  activeDrones: snapshot.drones.filter((drone) => drone.state !== 'idle').length,
}
console.log(JSON.stringify(result, null, 2))
