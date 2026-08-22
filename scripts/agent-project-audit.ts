import { execFileSync } from 'node:child_process'
import { analyzeFactory, buildFactoryPatchProposal, validateFactoryPatch } from '../src/game/factoryAgent'
import { SimulationEngine } from '../src/game/simulation'
import { objectCompatiblePortCells, occupiedCells } from '../src/game/grid'
import type { FactorySave } from '../src/game/save'

const projectId = process.argv[2]
if (!projectId) throw new Error('用法：node scripts/run-sim.mjs scripts/agent-project-audit.ts <project-id>')

const sql = `SELECT save_json FROM factory WHERE id='${projectId.replaceAll("'", "''")}' LIMIT 1`
const raw = execFileSync('docker', ['exec', 'forgemind-mysql', 'mysql', '-N', '-B', '-uforgemind', '-pforgemind', 'forgemind', '-e', sql], { encoding: 'utf8' }).trim()
if (!raw) throw new Error(`找不到工厂存档：${projectId}`)
const save = JSON.parse(raw) as FactorySave
const engine = new SimulationEngine(20260821)
engine.init(save.objects, save.recipes)
for (let second = 0; second < 600; second += 1) engine.advance(1)
const context = { objects: save.objects, items: save.items, recipes: save.recipes, snapshot: engine.getSnapshot(), floorCount: save.floorCount }
const objective = '把 L1 的加工设备重新排列，缩短原料仓库到机器的运输距离。保留现有机器和配方，不允许删除设备。AGV 路线不得穿过机器，优先降低阻塞。'
const analysis = analyzeFactory(objective, context, 'plan_design')
const patch = buildFactoryPatchProposal(analysis, context)
const hasActionableFinding = analysis.findings.some((finding) => finding.severity === 'critical' || finding.severity === 'warning')
const errors = patch ? validateFactoryPatch(patch, context) : hasActionableFinding ? ['存在可处理问题但没有生成 Patch'] : []
const debugIds = new Set(['l3_infeed_clean_part', 'l3_cv_clean_-7'])
console.log(JSON.stringify({
  projectId,
  objects: save.objects.length,
  timeSec: context.snapshot.timeSec,
  consumed: context.snapshot.stats.consumed,
  produced: context.snapshot.stats.produced,
  findings: analysis.findings.map((finding) => ({ code: finding.code, objectId: finding.objectIds[0], evidence: finding.evidence.map((entry) => entry.value) })),
  relatedEdges: analysis.findings.flatMap((finding) => finding.objectIds.slice(0, 1).flatMap((objectId) => analysis.graph.edges
    .filter((edge) => edge.from === `object:${objectId}` || edge.to === `object:${objectId}`)
    .map((edge) => ({ objectId, from: edge.from, to: edge.to, kind: edge.kind })))),
  debugPorts: save.objects.filter((object) => debugIds.has(object.id)).map((object) => ({ id: object.id, rotation: object.rotation, occupied: occupiedCells(object), input: objectCompatiblePortCells(object, 'input'), output: objectCompatiblePortCells(object, 'output') })),
  operations: patch?.operations.map((operation) => ({ kind: operation.kind, objectId: operation.kind === 'add_object' ? operation.object.id : operation.objectId, reason: operation.reason })) ?? [],
  errors,
}, null, 2))
if (errors.length > 0) process.exitCode = 1
