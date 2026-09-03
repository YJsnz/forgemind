/**
 * 能耗归因层 —— 与瓶颈归因共用分采样证据副本。
 *
 * 口径（确定性、无概率模型）：
 * - 额定功率取设备定义的 power 字段（如 "22 kW"），解析失败按 0
 * - 运行态（加工/上料/出料/载具移动）按额定功率计，待机按 15% 计
 * - 能量 = 功率 × 采样步长，窗口内累加
 *
 * 结论只做归因提示（哪个设备在待机浪费），不直接触发任何修改。
 */
import { getObjectDef, getFactoryObjectDisplayName, objectRole, type FactoryObject } from './types'
import { runSampledEvidence } from './bottleneckAnalysis'
import type { Recipe } from './item'

export interface MachineEnergyStats {
  objectId: string
  displayName: string
  ratedKw: number
  /** 窗口能耗（kWh），含待机 */
  energyKwh: number
  /** 待机能耗（kWh） */
  idleKwh: number
  /** 待机能耗占比 0-1 */
  idleShare: number
}

export interface EnergyReport {
  horizonSec: number
  sampleCount: number
  totalKwh: number
  idleWasteKwh: number
  machines: MachineEnergyStats[]
  vehicles: MachineEnergyStats[]
  /** 待机浪费最大的设备；无显著浪费时为 null */
  topIdleWaster: MachineEnergyStats | null
}

const STANDBY_FACTOR = 0.15
const STEP_SEC = 5

export function parseRatedKw(power: string | undefined): number {
  if (!power) return 0
  const match = power.match(/([\d.]+)\s*kw/i)
  return match ? Number(match[1]) : 0
}

function emptyStats(objectId: string, displayName: string, ratedKw: number): { id: string; name: string; kw: number; energy: number; idle: number } {
  return { id: objectId, name: displayName, kw: ratedKw, energy: 0, idle: 0 }
}

export function analyzeEnergy(objects: FactoryObject[], recipes: Recipe[], horizonSec = 60): EnergyReport {
  const machines = objects.filter((object) => objectRole(object.type, object.resourceId) === 'machine')
  const vehicles = objects.filter((object) => objectRole(object.type, object.resourceId) === 'vehicle')
  const tracked = new Map<string, ReturnType<typeof emptyStats>>()
  for (const machine of machines) {
    tracked.set(machine.id, emptyStats(machine.id, getFactoryObjectDisplayName(machine), parseRatedKw(getPowerField(machine))))
  }
  for (const vehicle of vehicles) {
    tracked.set(vehicle.id, emptyStats(vehicle.id, getFactoryObjectDisplayName(vehicle), parseRatedKw(getPowerField(vehicle))))
  }

  const sampleCount = runSampledEvidence(objects, recipes, horizonSec, (snapshot) => {
    for (const runtime of snapshot.machines) {
      const entry = tracked.get(runtime.objectId)
      if (!entry) continue
      const running = runtime.state !== 'idle'
      const kw = entry.kw * (running ? 1 : STANDBY_FACTOR)
      entry.energy += kw * (STEP_SEC / 3600)
      if (!running) entry.idle += kw * (STEP_SEC / 3600)
    }
    for (const agv of snapshot.agvs) {
      const entry = tracked.get(agv.objectId)
      if (!entry) continue
      const moving = agv.motionStatus === 'moving'
      const kw = entry.kw * (moving ? 1 : STANDBY_FACTOR)
      entry.energy += kw * (STEP_SEC / 3600)
      if (!moving) entry.idle += kw * (STEP_SEC / 3600)
    }
    for (const drone of snapshot.drones) {
      const entry = tracked.get(drone.objectId)
      if (!entry) continue
      const moving = drone.motionStatus === 'moving'
      const kw = entry.kw * (moving ? 1 : STANDBY_FACTOR)
      entry.energy += kw * (STEP_SEC / 3600)
      if (!moving) entry.idle += kw * (STEP_SEC / 3600)
    }
  })

  const toStats = (entry: { id: string; name: string; kw: number; energy: number; idle: number }): MachineEnergyStats => ({
    objectId: entry.id,
    displayName: entry.name,
    ratedKw: entry.kw,
    energyKwh: entry.energy,
    idleKwh: entry.idle,
    idleShare: entry.energy > 0 ? entry.idle / entry.energy : 0,
  })
  const machineStats = machines.map((machine) => toStats(tracked.get(machine.id)!))
  const vehicleStats = vehicles.map((vehicle) => toStats(tracked.get(vehicle.id)!))
  const all = [...machineStats, ...vehicleStats].sort((left, right) => right.idleKwh - left.idleKwh || left.objectId.localeCompare(right.objectId))
  const totalKwh = all.reduce((sum, entry) => sum + entry.energyKwh, 0)
  const idleWasteKwh = all.reduce((sum, entry) => sum + entry.idleKwh, 0)
  const top = all[0]
  const topIdleWaster = top && top.idleKwh > 0.01 && top.idleShare >= 0.4 ? top : null

  return {
    horizonSec,
    sampleCount,
    totalKwh,
    idleWasteKwh,
    machines: machineStats,
    vehicles: vehicleStats,
    topIdleWaster,
  }
}

function getPowerField(object: FactoryObject): string | undefined {
  return getObjectDef(object.type, object.resourceId).power
}
