import { isTransportType, objectRole, type AgvProgram, type AgvRouteAction, type AgvRouteWaypoint, type FactoryFloorId, type FactoryObject } from './types'
import type { Recipe } from './item'
import { mulberry32 } from './rng'
import { rotationToDir, cellKey } from './dir'
import { objectPortCell, objectPortCells, objectToWorld, occupiedCells } from './grid'
import { AGV_CENTER_CLEARANCE, AGV_NAV_RADIUS, agvDockCandidates, findAgvPath, type AgvDynamicObstacle, type AgvNavigationPoint } from './agvNavigation'
import { WAREHOUSE_AGV_ROUTE } from './warehouse'
import { DRONE_DOCK, DRONE_FLOOR_ELEVATIONS, FLOOR_DELIVERY_POINTS, getDroneRoute } from './droneNavigation'

/**
 * 仿真引擎（补充设计 §3 内核）—— 唯一真相源。
 *
 * Day 5 完整版：传送带分段模型 + ItemLot 在途运输 + 头堵背压 + 机器输入/输出耦合 + Source 产出。
 *
 * 连接语义（极简，贯穿全引擎）：
 *   每个对象（source / conveyor / machine）都有「输出方向」= rotation 方向。
 *   物品从对象 A 沿 A.dir 流出，进入「A.pos + A.dir」这一格上的对象 B：
 *     - B 是传送带 → 物品沿 B.dir 继续（槽位空才能进入）。
 *     - B 是机器   → 物品进入机器输入缓冲（机器 idle 且需要该物品）。
 *   机器加工完成后，沿 machine.dir 吐出产物到下游传送带（或计数视为出口）。
 *   用户只需保证「上游的 rotation 指向下游」，物品就会流动。
 */

/** 固定步长（§3.2：50ms 一步） */
export const SIM_STEP = 0.05

/** 收料 / 出料过渡时长（秒） */
export const LOAD_TIME = 0.5
export const OUTPUT_TIME = 0.3

/** 传送带速度（格/秒） */
export const CONVEYOR_SPEED = 2

/** source 产出间隔（秒） */
export const SOURCE_INTERVAL = 1.0
export const SOURCE_TRANSFER_TIME = 1.2

const floorCellKey = (floorId: FactoryFloorId | undefined, x: number, z: number): string => `${floorId ?? 1}:${cellKey(x, z)}`

/** 机器运行时状态（§3.4 状态机） */
export type MachineState = 'idle' | 'loading' | 'processing' | 'output'

export interface MachineRuntime {
  objectId: string
  state: MachineState
  /** 当前阶段进度 0..1 */
  progress: number
  recipeId: string | null
  /** 输入缓冲：已收到的输入 itemId -> 数量 */
  inputBuffer: Record<string, number>
  /** 累计加工时间（秒），用于利用率统计 */
  processingTime: number
}

/** 在途物品实例（§3.4 ItemLot） */
export interface ItemLot {
  id: string
  itemId: string
  /** 当前所在传送带 id */
  conveyorId: string
  /** 物料随输送带继承的楼层，旧快照默认视为 L1。 */
  floorId: FactoryFloorId
  /** 沿 conveyor 朝向的格内进度 0..1 */
  offset: number
}

export interface SimStats {
  consumed: Record<string, number>
  produced: Record<string, number>
}

export type FloorSimStats = Record<FactoryFloorId, SimStats>

function createFloorStats(): FloorSimStats {
  return {
    1: { consumed: {}, produced: {} },
    2: { consumed: {}, produced: {} },
    3: { consumed: {}, produced: {} },
  }
}

/** 快照：前端消费的最小接口 */
export interface SimulationSnapshot {
  timeSec: number
  machines: MachineRuntime[]
  sources: SourceRuntimeSnapshot[]
  itemLots: ItemLot[]
  agvs: AgvRuntimeSnapshot[]
  drones: DroneRuntimeSnapshot[]
  stats: SimStats
  floorStats: FloorSimStats
}

export type SourceState = 'idle' | 'picking' | 'placing' | 'blocked'

export interface SourceRuntimeSnapshot {
  objectId: string
  itemId: string | null
  state: SourceState
  progress: number
}

interface SourceRuntime {
  objectId: string
  itemId: string | null
  /** 产出计时器 */
  timer: number
  transferTimer: number
  state: SourceState
}

interface ConveyorRuntime {
  objectId: string
  /** 当前槽位上的物品（容量 1） */
  lot: ItemLot | null
  /** Round-robin output branch for a splitter. */
  branchCursor: number
}

export type AgvPhase = 'to-warehouse' | 'to-line' | 'to-source' | 'to-destination'
export type AgvMotionStatus = 'idle' | 'moving' | 'waiting'

export interface AgvRuntimeSnapshot {
  objectId: string
  position: AgvNavigationPoint
  headingY: number
  phase: AgvPhase
  motionStatus: AgvMotionStatus
  path: AgvNavigationPoint[]
  waypointIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  decision: AgvDecision
  blockedSeconds: number
  yieldCount: number
  currentWaypointLabel: string
}

export type DronePhase = 'parked' | 'taxi-to-lift' | 'ascending' | 'perimeter' | 'to-input' | 'returning'
export type DroneMotionStatus = 'idle' | 'moving' | 'waiting'

export interface DroneNavigationPoint {
  x: number
  y: number
  z: number
}

export interface DroneRuntimeSnapshot {
  objectId: string
  position: DroneNavigationPoint
  headingY: number
  phase: DronePhase
  motionStatus: DroneMotionStatus
  path: DroneNavigationPoint[]
  waypointIndex: number
  targetFloor: 2 | 3
  deliveryPointIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  currentWaypointLabel: string
}

export type AgvDecision = 'idle' | 'moving' | 'yielding' | 'replanning' | 'recovering'

interface AgvRuntime {
  objectId: string
  position: AgvNavigationPoint
  headingY: number
  phase: AgvPhase
  motionStatus: AgvMotionStatus
  path: AgvNavigationPoint[]
  waypointIndex: number
  routeIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  retryTimer: number
  program: AgvProgram | null
  decision: AgvDecision
  blockedSeconds: number
  yieldCount: number
  currentWaypointLabel: string
  pathMode: 'mission' | 'recovery' | 'yield'
}

interface DroneRuntime {
  objectId: string
  position: DroneNavigationPoint
  headingY: number
  phase: DronePhase
  motionStatus: DroneMotionStatus
  path: DroneNavigationPoint[]
  pathLabels: string[]
  waypointIndex: number
  targetFloor: 2 | 3
  deliveryPointIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  holdSeconds: number
}

interface AgvMissionTarget {
  position: AgvNavigationPoint
  candidates?: AgvNavigationPoint[]
  kind: 'warehouse' | 'line-side' | 'source' | 'destination'
  action: AgvRouteAction
  label: string
}

export class SimulationEngine {
  readonly seed: number
  readonly rng: () => number

  private timeSec = 0
  private accumulator = 0

  private machines = new Map<string, MachineRuntime>()
  private conveyors = new Map<string, ConveyorRuntime>()
  private agvs = new Map<string, AgvRuntime>()
  private drones = new Map<string, DroneRuntime>()
  private sources = new Map<string, SourceRuntime>()
  private recipes = new Map<string, Recipe>()
  /** cellKey -> FactoryObject（用于查下游） */
  private objectByCell = new Map<string, FactoryObject>()
  /** objectId -> FactoryObject（用于查自身 pos/rotation） */
  private objectById = new Map<string, FactoryObject>()

  private stats: SimStats = { consumed: {}, produced: {} }
  private floorStats: FloorSimStats = createFloorStats()
  private lotCounter = 0
  private factoryObjects: FactoryObject[] = []

  constructor(seed: number) {
    this.seed = seed >>> 0
    this.rng = mulberry32(this.seed)
  }

  /** 装载工厂结构 */
  init(objects: FactoryObject[], recipes: Recipe[]): void {
    this.timeSec = 0
    this.accumulator = 0
    this.stats = { consumed: {}, produced: {} }
    this.floorStats = createFloorStats()
    this.machines.clear()
    this.conveyors.clear()
    this.agvs.clear()
    this.drones.clear()
    this.sources.clear()
    this.recipes.clear()
    this.objectByCell.clear()
    this.objectById.clear()
    this.lotCounter = 0
    this.factoryObjects = objects

    for (const r of recipes) this.recipes.set(r.id, r)

    for (const o of objects) {
      for (const cell of occupiedCells(o)) {
        this.objectByCell.set(floorCellKey(o.floorId, cell.x, cell.z), o)
      }
      this.objectById.set(o.id, o)
      if (objectRole(o.type, o.resourceId) === 'machine') {
        this.machines.set(o.id, {
          objectId: o.id,
          state: 'idle',
          progress: 0,
          recipeId: o.recipeId ?? null,
          inputBuffer: {},
          processingTime: 0,
        })
      } else if (o.type === 'agv') {
        this.agvs.set(o.id, createAgvRuntime(o))
      } else if (o.type === 'drone') {
        this.drones.set(o.id, createDroneRuntime(o))
      } else if (isTransportType(o.type, o.resourceId)) {
        this.conveyors.set(o.id, { objectId: o.id, lot: null, branchCursor: 0 })
      } else if (objectRole(o.type, o.resourceId) === 'source') {
        this.sources.set(o.id, {
          objectId: o.id,
          itemId: o.itemId ?? null,
          timer: 0,
          transferTimer: 0,
          state: 'idle',
        })
      }
    }

    for (const runtime of this.agvs.values()) this.planAgvPath(runtime)
  }

  advance(dtSec: number): void {
    if (dtSec <= 0) return
    this.accumulator += dtSec
    const steps = Math.floor(this.accumulator / SIM_STEP)
    for (let index = 0; index < steps; index += 1) {
      this.step(SIM_STEP)
    }
    this.accumulator -= steps * SIM_STEP
  }

  private step(dt: number): void {
    this.timeSec += dt
    this.stepSources(dt)
    this.stepConveyors(dt)
    this.stepMachines(dt)
    this.stepAgvs(dt)
    this.stepDrones(dt)
  }

  // —— Source：定时产出到下游 ——
  private stepSources(dt: number): void {
    for (const s of this.sources.values()) {
      if (!s.itemId) {
        s.state = 'blocked'
        s.transferTimer = 0
        continue
      }

      const srcObj = this.objectById.get(s.objectId)
      if (!srcObj) {
        s.state = 'blocked'
        s.transferTimer = 0
        continue
      }

      if (s.transferTimer <= 0 && s.state !== 'picking' && s.state !== 'placing') {
        s.timer += dt
        if (s.timer < SOURCE_INTERVAL) {
          s.state = 'idle'
          continue
        }
        if (this.sourceDownstreams(srcObj).length === 0) {
          s.state = 'blocked'
          continue
        }
        s.timer -= SOURCE_INTERVAL
        s.transferTimer = 0
      }

      s.transferTimer += dt
      const progress = Math.min(s.transferTimer / SOURCE_TRANSFER_TIME, 1)
      s.state = progress < 0.52 ? 'picking' : 'placing'
      if (progress < 1) continue

      if (this.trySourceOutput(srcObj, s.itemId)) {
        s.transferTimer = 0
        s.state = 'idle'
      } else {
        s.state = 'blocked'
      }
    }
  }

  private sourceDownstreams(srcObj: FactoryObject): FactoryObject[] {
    return objectPortCells(srcObj, 'output')
      .map((cell) => this.objectByCell.get(floorCellKey(srcObj.floorId, cell.x, cell.z)))
      .filter((obj): obj is FactoryObject => Boolean(obj))
      .filter((obj) => this.isConnected(srcObj, obj))
  }

  private trySourceOutput(srcObj: FactoryObject, itemId: string): boolean {
    for (const downstream of this.sourceDownstreams(srcObj)) {
      if (isTransportType(downstream.type, downstream.resourceId)) {
        const c = this.conveyors.get(downstream.id)
        if (c && !c.lot) {
          c.lot = this.makeLot(itemId, downstream.id, 0)
          return true
        }
      } else if (objectRole(downstream.type, downstream.resourceId) === 'machine' && this.tryFeedMachine(downstream.id, itemId)) {
        return true
      }
    }
    return false
  }

  private stepConveyors(dt: number): void {
    const step = CONVEYOR_SPEED * dt
    // 固定按 id 排序，保证确定性
    const ids = Array.from(this.conveyors.keys()).sort()

    for (const id of ids) {
      const c = this.conveyors.get(id)!
      const lot = c.lot
      if (!lot) continue
      const obj = this.objectById.get(id)
      if (!obj) continue

      lot.offset += step

      // 到达段末端 → 尝试进入下游
      if (lot.offset >= 1) {
        if (obj.type === 'splitter') {
          if (!this.tryMoveFromSplitter(c, obj, lot)) lot.offset = 1
          continue
        }
        const dir = rotationToDir(obj.rotation)
        const output = objectPortCell(obj, 'output') ?? { x: obj.pos.x + dir.dx, z: obj.pos.z + dir.dz }
        const nx = output.x
        const nz = output.z
        const downstream = this.objectByCell.get(floorCellKey(obj.floorId, nx, nz))

        let moved = false
        if (downstream && this.isConnected(obj, downstream) && isTransportType(downstream.type, downstream.resourceId)) {
          const dc = this.conveyors.get(downstream.id)
          if (dc && !dc.lot) {
            dc.lot = this.makeLot(lot.itemId, downstream.id, lot.offset - 1)
            c.lot = null
            moved = true
          }
        } else if (downstream && this.isConnected(obj, downstream) && objectRole(downstream.type, downstream.resourceId) === 'machine') {
          if (this.tryFeedMachine(downstream.id, lot.itemId)) {
            c.lot = null
            moved = true
          }
        } else if (!downstream) {
          // 下游是空格 → 物品离开工厂（「出口」语义）
          c.lot = null
          moved = true
        }

        if (!moved) {
          // 下游满 → 头堵，停在末端（背压向后传播）
          lot.offset = 1
        }
      }
    }
  }

  // —— Machine：状态机 ——
  private tryMoveFromSplitter(c: ConveyorRuntime, obj: FactoryObject, lot: ItemLot): boolean {
    const outputs = objectPortCells(obj, 'output')
    const start = c.branchCursor % Math.max(outputs.length, 1)
    for (let offset = 0; offset < outputs.length; offset++) {
      const output = outputs[(start + offset) % outputs.length]
      const downstream = this.objectByCell.get(floorCellKey(obj.floorId, output.x, output.z))
      if (!downstream || !this.isConnected(obj, downstream)) continue
      if (isTransportType(downstream.type, downstream.resourceId)) {
        const dc = this.conveyors.get(downstream.id)
        if (!dc || dc.lot) continue
        dc.lot = this.makeLot(lot.itemId, downstream.id, lot.offset - 1)
        c.branchCursor = (start + offset + 1) % outputs.length
        c.lot = null
        return true
      }
      if (objectRole(downstream.type, downstream.resourceId) === 'machine' && this.tryFeedMachine(downstream.id, lot.itemId)) {
        c.branchCursor = (start + offset + 1) % outputs.length
        c.lot = null
        return true
      }
    }
    return false
  }

  private stepMachines(dt: number): void {
    for (const m of this.machines.values()) {
      this.stepMachine(m, dt)
    }
  }

  private stepMachine(m: MachineRuntime, dt: number): void {
    const recipe = m.recipeId ? this.recipes.get(m.recipeId) : undefined
    if (!recipe) {
      m.state = 'idle'
      m.progress = 0
      return
    }

    switch (m.state) {
      case 'idle': {
        // 检查输入是否齐备
        if (this.inputsSatisfied(m, recipe)) {
          // 消耗输入
          const floorId = this.findMachineObject(m.objectId)?.floorId ?? 1
          const floorStats = this.floorStats[floorId]
          for (const p of recipe.inputs) {
            this.stats.consumed[p.itemId] =
              (this.stats.consumed[p.itemId] ?? 0) + p.qty
            floorStats.consumed[p.itemId] =
              (floorStats.consumed[p.itemId] ?? 0) + p.qty
          }
          m.inputBuffer = {}
          m.state = 'loading'
          m.progress = 0
        }
        break
      }

      case 'loading':
        m.progress += dt / LOAD_TIME
        if (m.progress >= 1) {
          m.progress = 0
          m.state = 'processing'
        }
        break

      case 'processing':
        m.progress += dt / recipe.durationSec
        m.processingTime += dt
        if (m.progress >= 1) {
          m.progress = 0
          m.state = 'output'
        }
        break

      case 'output': {
        m.progress += dt / OUTPUT_TIME
        if (m.progress >= 1) {
          m.progress = 0
          // 吐出产物到下游传送带
          const placed = this.tryOutput(m, recipe)
          if (placed) {
            // 回到 idle，等待下一轮输入齐备（§3.4 状态机闭环）
            m.state = 'idle'
          }
          // 未吐出 → 停在 output（下游空后下步再试）
          else {
            m.progress = 1
          }
        }
        break
      }
    }
  }

  private inputsSatisfied(m: MachineRuntime, recipe: Recipe): boolean {
    for (const p of recipe.inputs) {
      if ((m.inputBuffer[p.itemId] ?? 0) < p.qty) return false
    }
    return true
  }

  /** 尝试把物品喂给机器输入缓冲。返回是否成功。 */
  private tryFeedMachine(machineId: string, itemId: string): boolean {
    const m = this.machines.get(machineId)
    if (!m) return false
    if (m.state !== 'idle') return false
    const recipe = m.recipeId ? this.recipes.get(m.recipeId) : undefined
    if (!recipe) return false
    // 该物品是配方某个输入，且还未收满
    for (const p of recipe.inputs) {
      if (p.itemId === itemId && (m.inputBuffer[itemId] ?? 0) < p.qty) {
        m.inputBuffer[itemId] = (m.inputBuffer[itemId] ?? 0) + 1
        return true
      }
    }
    return false
  }

  /** 尝试从机器输出产物到下游。返回是否成功（成功则计入产出）。 */
  private tryOutput(m: MachineRuntime, recipe: Recipe): boolean {
    // 若无产物（配方无输出），直接视为完成
    if (recipe.outputs.length === 0) return true

    const obj = this.findMachineObject(m.objectId)
    if (!obj) return false
    const outputs = objectPortCells(obj, 'output')
    const downstreams = outputs
      .map((cell) => this.objectByCell.get(floorCellKey(obj.floorId, cell.x, cell.z)))
      .filter((target): target is FactoryObject => Boolean(target))
    const downstream = downstreams.find((target) => this.isConnected(obj, target))

    const out = recipe.outputs[0] // MVP 单输出；多输出后续扩展

    if (downstream && isTransportType(downstream.type, downstream.resourceId)) {
      const dc = this.conveyors.get(downstream.id)
      if (dc && !dc.lot) {
        dc.lot = this.makeLot(out.itemId, downstream.id, 0)
        this.recordProduced(m.objectId, recipe)
        return true
      }
      return false // 下游传送带满 → 背压
    }

    // 下游无传送带 → 直接视为出口，计入产出
    if (downstreams.length > 0 && !downstream) return false

    this.recordProduced(m.objectId, recipe)
    return true
  }

  private recordProduced(machineId: string, recipe: Recipe): void {
    const floorId = this.findMachineObject(machineId)?.floorId ?? 1
    const floorStats = this.floorStats[floorId]
    for (const p of recipe.outputs) {
      this.stats.produced[p.itemId] = (this.stats.produced[p.itemId] ?? 0) + p.qty
      floorStats.produced[p.itemId] = (floorStats.produced[p.itemId] ?? 0) + p.qty
    }
  }

  private stepAgvs(dt: number): void {
    for (const runtime of [...this.agvs.values()].sort((left, right) => left.objectId.localeCompare(right.objectId))) {
      const mission = this.agvMission(runtime)
      if (mission.length === 0) {
        runtime.path = []
        runtime.waypointIndex = 0
        runtime.motionStatus = 'idle'
        runtime.decision = 'idle'
        runtime.currentWaypointLabel = '任务已停用'
        continue
      }

      runtime.retryTimer = Math.max(0, runtime.retryTimer - dt)
      if (runtime.path.length === 0) {
        runtime.motionStatus = 'waiting'
        runtime.decision = runtime.blockedSeconds > 0 ? 'replanning' : 'yielding'
        if (runtime.retryTimer > 0) continue
        if (this.planAgvPath(runtime)) {
          runtime.motionStatus = 'moving'
          runtime.decision = 'moving'
        } else {
          runtime.retryTimer = runtime.blockedSeconds > 2.5 ? 1.2 : 0.5
        }
        continue
      }

      if (runtime.waypointIndex >= runtime.path.length) {
        if (runtime.pathMode === 'recovery') {
          runtime.path = []
          runtime.waypointIndex = 0
          runtime.pathMode = 'mission'
          runtime.blockedSeconds = 0
          runtime.decision = 'replanning'
          continue
        }
        if (runtime.pathMode === 'yield') {
          runtime.path = []
          runtime.waypointIndex = 0
          runtime.pathMode = 'mission'
          runtime.blockedSeconds = 0
          runtime.retryTimer = 0.35
          runtime.motionStatus = 'waiting'
          runtime.decision = 'yielding'
          continue
        }
        const arrivedTarget = mission[runtime.routeIndex % mission.length]
        this.applyAgvArrival(runtime, arrivedTarget)
        runtime.routeIndex = (runtime.routeIndex + 1) % mission.length
        runtime.path = []
        runtime.waypointIndex = 0
        runtime.motionStatus = 'waiting'
        runtime.blockedSeconds = 0
        runtime.decision = 'moving'
        continue
      }

      const target = runtime.path[runtime.waypointIndex]
      const dx = target.x - runtime.position.x
      const dz = target.z - runtime.position.z
      const distance = Math.hypot(dx, dz)
      const travel = Math.min(distance, AGV_SPEED * dt)
      const nextPosition = distance <= 0.0001 || travel >= distance
        ? target
        : { x: runtime.position.x + dx / distance * travel, z: runtime.position.z + dz / distance * travel }
      const blocker = this.blockingAgv(runtime, nextPosition)
      if (blocker) {
        const yielding = this.shouldYield(runtime, blocker)
        if (yielding && runtime.decision !== 'yielding' && runtime.decision !== 'replanning') runtime.yieldCount += 1
        runtime.blockedSeconds += dt
        runtime.motionStatus = 'waiting'
        runtime.decision = yielding ? 'yielding' : 'replanning'
        if (runtime.retryTimer <= 0) {
          if (yielding && runtime.blockedSeconds >= 0.15) {
            // First response is a constant-time retreat along the already
            // validated path. Only a persistent conflict is allowed to invoke
            // the expensive global planner.
            const yieldPath = this.planYieldPath(runtime, blocker, runtime.blockedSeconds >= 1)
            if (yieldPath) {
              runtime.path = yieldPath
              runtime.waypointIndex = 1
              runtime.pathMode = 'yield'
              runtime.retryTimer = 0
              runtime.decision = 'yielding'
            } else {
              runtime.retryTimer = 0.1
            }
          } else if (runtime.blockedSeconds >= 3) {
            const escapePath = this.planEscapePath(runtime, blocker)
            if (escapePath) {
              runtime.path = escapePath
              runtime.waypointIndex = 1
              runtime.pathMode = 'recovery'
              runtime.retryTimer = 0
              runtime.decision = 'recovering'
            } else {
              runtime.path = []
              runtime.waypointIndex = 0
              runtime.retryTimer = 1.25
              runtime.decision = 'recovering'
            }
          } else {
            // The right-of-way vehicle keeps its current mission path. The
            // yielding vehicle is responsible for backing out of the conflict
            // zone; clearing both paths here creates a mutual replanning deadlock.
            runtime.retryTimer = 0.25
          }
        }
        continue
      }

      runtime.blockedSeconds = 0
      if (distance <= 0.0001 || travel >= distance) {
        runtime.position = { ...target }
        runtime.waypointIndex += 1
        runtime.distanceTravelled += distance
      } else {
        runtime.position = {
          x: runtime.position.x + dx / distance * travel,
          z: runtime.position.z + dz / distance * travel,
        }
        runtime.distanceTravelled += travel
      }
      if (distance > 0.0001) runtime.headingY = Math.atan2(dz, dx)
      runtime.motionStatus = 'moving'
      runtime.decision = 'moving'
    }
  }

  private planAgvPath(runtime: AgvRuntime): boolean {
    const mission = this.agvMission(runtime)
    if (mission.length === 0) return false
    const target = mission[runtime.routeIndex % mission.length]
    const candidates = target.candidates ?? [target.position]
    const nextPath = candidates
      .map((candidate) => findAgvPath(this.factoryObjects, runtime.position, candidate, runtime.objectId, this.dynamicObstaclesFor(runtime, true)))
      .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1))
      ?? candidates
        .map((candidate) => findAgvPath(this.factoryObjects, runtime.position, candidate, runtime.objectId, this.dynamicObstaclesFor(runtime)))
        .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1))
    if (!nextPath || nextPath.length <= 1) return false
    runtime.path = nextPath
    runtime.waypointIndex = 1
    runtime.pathMode = 'mission'
    runtime.phase = target.kind === 'warehouse' ? 'to-warehouse' : target.kind === 'line-side' ? 'to-line' : target.kind === 'source' ? 'to-source' : 'to-destination'
    runtime.currentWaypointLabel = target.label
    runtime.retryTimer = 0
    return true
  }

  private agvMission(runtime: AgvRuntime): AgvMissionTarget[] {
    const program = runtime.program
    if (program && !program.enabled) return []
    const source = program?.sourceObjectId ? this.objectById.get(program.sourceObjectId) : undefined
    const destination = program?.destinationObjectId ? this.objectById.get(program.destinationObjectId) : undefined
    if (program?.enabled && source && destination) {
      const configuredRoute = program.route?.filter((waypoint) => waypoint.position && waypoint.action)
      if (configuredRoute && configuredRoute.length >= 2) return configuredRoute.map((waypoint) => this.missionTargetFromWaypoint(waypoint))
      return [
        this.missionTargetFromWaypoint({ id: 'source', label: '起点装货', objectId: source.id, position: agvDockCandidates(source)[0], action: 'load' }),
        this.missionTargetFromWaypoint({ id: 'destination', label: '终点卸货', objectId: destination.id, position: agvDockCandidates(destination)[0], action: 'unload' }),
      ]
    }
    return WAREHOUSE_AGV_ROUTE.map((point, index) => ({
      position: point.position,
      kind: point.kind,
      action: point.kind === 'warehouse' ? 'load' : 'unload',
      label: point.label,
      ...(index === 0 ? { candidates: [point.position] } : {}),
    }))
  }

  private missionTargetFromWaypoint(waypoint: AgvRouteWaypoint): AgvMissionTarget {
    const object = waypoint.objectId ? this.objectById.get(waypoint.objectId) : undefined
    const candidates = object ? agvDockCandidates(object) : undefined
    return {
      position: candidates?.[0] ?? waypoint.position,
      candidates,
      kind: waypoint.action === 'load' ? 'source' : waypoint.action === 'unload' ? 'destination' : 'line-side',
      action: waypoint.action,
      label: waypoint.label,
    }
  }

  private applyAgvArrival(runtime: AgvRuntime, target: AgvMissionTarget) {
    if (target.action === 'load') {
      runtime.cargoItemId = runtime.program?.itemId ?? 'item_steel_blank'
      runtime.cargoQuantity = runtime.program?.loadQuantity ?? 100
    } else if (target.action === 'unload') {
      if (runtime.cargoQuantity > 0) runtime.completedTrips += 1
      runtime.cargoItemId = null
      runtime.cargoQuantity = 0
    }
  }

  private dynamicObstaclesFor(runtime: AgvRuntime, includeLookahead = false): AgvDynamicObstacle[] {
    const obstacles: AgvDynamicObstacle[] = []
    for (const other of this.agvs.values()) {
      if (other.objectId === runtime.objectId || other.motionStatus === 'idle') continue
      obstacles.push({ position: other.position, radius: AGV_NAV_RADIUS })
      const next = other.path[other.waypointIndex]
      if (next) obstacles.push({ position: next, radius: AGV_NAV_RADIUS })
      if (!includeLookahead) continue

      // Reserve the next few cells of each moving AGV's route. A planner that
      // only sees the current cell discovers the conflict too late, when both
      // vehicles are already inside the same narrow aisle.
      const lookahead = [other.position, ...other.path.slice(other.waypointIndex, other.waypointIndex + 4)]
      for (let index = 1; index < lookahead.length; index += 1) {
        const from = lookahead[index - 1]
        const to = lookahead[index]
        const distance = Math.hypot(to.x - from.x, to.z - from.z)
        const samples = Math.min(8, Math.max(1, Math.ceil(distance)))
        for (let sample = 1; sample <= samples; sample += 1) {
          const progress = sample / samples
          obstacles.push({
            position: {
              x: from.x + (to.x - from.x) * progress,
              z: from.z + (to.z - from.z) * progress,
            },
            radius: AGV_NAV_RADIUS,
          })
        }
      }
    }
    return obstacles
  }

  private blockingAgv(runtime: AgvRuntime, position: AgvNavigationPoint): AgvRuntime | undefined {
    return [...this.agvs.values()]
      .filter((other) => other.objectId !== runtime.objectId && other.motionStatus !== 'idle')
      .find((other) => Math.hypot(other.position.x - position.x, other.position.z - position.z) < AGV_CENTER_CLEARANCE)
  }

  private planEscapePath(runtime: AgvRuntime, blocker: AgvRuntime): AgvNavigationPoint[] | null {
    const awayX = Math.sign(runtime.position.x - blocker.position.x) || 1
    const awayZ = Math.sign(runtime.position.z - blocker.position.z) || 1
    const candidates = [
      { x: runtime.position.x + awayX * 3, z: runtime.position.z },
      { x: runtime.position.x, z: runtime.position.z + awayZ * 3 },
      { x: runtime.position.x - awayX * 3, z: runtime.position.z },
      { x: runtime.position.x, z: runtime.position.z - awayZ * 3 },
    ]
    return candidates
      .map((candidate) => findAgvPath(this.factoryObjects, runtime.position, candidate, runtime.objectId, this.dynamicObstaclesFor(runtime, true)))
      .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1)) ?? null
  }

  private planYieldPath(runtime: AgvRuntime, blocker: AgvRuntime, allowGlobalSearch: boolean): AgvNavigationPoint[] | null {
    const retreatPoint = runtime.path
      .slice(0, runtime.waypointIndex)
      .reverse()
        .find((point) => Math.hypot(point.x - runtime.position.x, point.z - runtime.position.z) > 0.8 && Math.hypot(point.x - blocker.position.x, point.z - blocker.position.z) >= AGV_CENTER_CLEARANCE)
    if (retreatPoint) return [{ ...runtime.position }, { ...retreatPoint }]
    if (!allowGlobalSearch) return null

    const next = runtime.path[runtime.waypointIndex]
    const moveX = (next ? Math.sign(next.x - runtime.position.x) : 0) || Math.sign(runtime.position.x - blocker.position.x) || 1
    const moveZ = (next ? Math.sign(next.z - runtime.position.z) : 0) || Math.sign(runtime.position.z - blocker.position.z) || 0
    const away = { x: -moveX, z: -moveZ }
    const targets = [
      ...runtime.path
        .slice(0, runtime.waypointIndex)
        .reverse()
        .filter((point) => Math.hypot(point.x - runtime.position.x, point.z - runtime.position.z) > 0.8),
      { x: runtime.position.x + away.x * 2, z: runtime.position.z + away.z * 2 },
      { x: runtime.position.x + away.x * 3, z: runtime.position.z + away.z * 3 },
      { x: runtime.position.x + away.z * 2, z: runtime.position.z - away.x * 2 },
      { x: runtime.position.x - away.z * 2, z: runtime.position.z + away.x * 2 },
    ]
    const dynamicObstacles = this.dynamicObstaclesFor(runtime, true)
    return targets
      .filter((target) => Math.hypot(target.x - blocker.position.x, target.z - blocker.position.z) >= AGV_CENTER_CLEARANCE)
      .map((target) => findAgvPath(this.factoryObjects, runtime.position, target, runtime.objectId, dynamicObstacles))
      .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1)) ?? null
  }

  private shouldYield(runtime: AgvRuntime, blocker: AgvRuntime) {
    // Priority is explicit, while trip count provides aging: a vehicle that
    // has already completed more work gives way to a waiting vehicle instead
    // of monopolising a shared dock forever.
    const priority = (runtime.program?.priority ?? 0) * 100 - runtime.completedTrips
    const blockerPriority = (blocker.program?.priority ?? 0) * 100 - blocker.completedTrips
    return priority < blockerPriority || (priority === blockerPriority && runtime.objectId > blocker.objectId)
  }

  /** A transfer is valid only when the upstream output faces the downstream input. */
  private isConnected(upstream: FactoryObject, downstream: FactoryObject): boolean {
    if ((upstream.floorId ?? 1) !== (downstream.floorId ?? 1)) return false
    const inputCells = objectPortCells(downstream, 'input')
    if (inputCells.length === 0) return true
    return occupiedCells(upstream).some((cell) => inputCells.some((input) => cell.x === input.x && cell.z === input.z))
  }

  private makeLot(itemId: string, conveyorId: string, offset: number): ItemLot {
    const conveyor = this.objectById.get(conveyorId)
    return {
      id: `lot_${this.lotCounter++}`,
      itemId,
      conveyorId,
      floorId: conveyor?.floorId ?? 1,
      offset,
    }
  }

  private findMachineObject(machineId: string): FactoryObject | undefined {
    return this.objectById.get(machineId)
  }

  private stepDrones(dt: number): void {
    for (const runtime of this.drones.values()) {
      if (runtime.phase === 'parked') {
        runtime.motionStatus = 'waiting'
        runtime.holdSeconds -= dt
        if (runtime.holdSeconds <= 0) {
          const mission = buildDroneMission(runtime.targetFloor)
          runtime.path = mission.points
          runtime.pathLabels = mission.labels
          runtime.waypointIndex = 1
          runtime.deliveryPointIndex = 0
          runtime.motionStatus = 'moving'
          runtime.phase = 'taxi-to-lift'
        }
        continue
      }

      runtime.motionStatus = 'moving'
      advanceDrone(runtime, dt)
    }
  }

  getSnapshot(): SimulationSnapshot {
    const lots: ItemLot[] = []
    for (const c of this.conveyors.values()) {
      if (c.lot) lots.push({ ...c.lot })
    }
    return {
      timeSec: this.timeSec,
      machines: Array.from(this.machines.values()).map((m) => ({ ...m })),
      sources: Array.from(this.sources.values()).map((s) => ({
        objectId: s.objectId,
        itemId: s.itemId,
        state: s.state,
        progress: s.transferTimer > 0 ? Math.min(s.transferTimer / SOURCE_TRANSFER_TIME, 1) : 0,
      })),
      itemLots: lots,
      agvs: Array.from(this.agvs.values()).map((runtime) => ({
        objectId: runtime.objectId,
        position: { ...runtime.position },
        headingY: runtime.headingY,
        phase: runtime.phase,
        motionStatus: runtime.motionStatus,
        path: runtime.path.map((point) => ({ ...point })),
        waypointIndex: runtime.waypointIndex,
        cargoItemId: runtime.cargoItemId,
        cargoQuantity: runtime.cargoQuantity,
        completedTrips: runtime.completedTrips,
        distanceTravelled: runtime.distanceTravelled,
        decision: runtime.decision,
        blockedSeconds: runtime.blockedSeconds,
        yieldCount: runtime.yieldCount,
        currentWaypointLabel: runtime.currentWaypointLabel,
      })),
      drones: Array.from(this.drones.values()).map((runtime) => ({
        objectId: runtime.objectId,
        position: { ...runtime.position },
        headingY: runtime.headingY,
        phase: runtime.phase,
        motionStatus: runtime.motionStatus,
        path: runtime.path.map((point) => ({ ...point })),
        waypointIndex: runtime.waypointIndex,
        targetFloor: runtime.targetFloor,
        deliveryPointIndex: runtime.deliveryPointIndex,
        cargoItemId: runtime.cargoItemId,
        cargoQuantity: runtime.cargoQuantity,
        completedTrips: runtime.completedTrips,
        distanceTravelled: runtime.distanceTravelled,
        currentWaypointLabel: runtime.pathLabels[runtime.waypointIndex] ?? 'L1 停机位 / 待命',
      })),
      stats: {
        consumed: { ...this.stats.consumed },
        produced: { ...this.stats.produced },
      },
      floorStats: {
        1: { consumed: { ...this.floorStats[1].consumed }, produced: { ...this.floorStats[1].produced } },
        2: { consumed: { ...this.floorStats[2].consumed }, produced: { ...this.floorStats[2].produced } },
        3: { consumed: { ...this.floorStats[3].consumed }, produced: { ...this.floorStats[3].produced } },
      },
    }
  }
}

const AGV_SPEED = 2.2
const DRONE_SPEED = 8.5
const DRONE_DOCK_HEIGHT = 1.45

function createAgvRuntime(object: FactoryObject): AgvRuntime {
  const position = objectToWorld(object)
  const direction = rotationToDir(object.rotation)
  return {
    objectId: object.id,
    position,
    headingY: Math.atan2(direction.dz, direction.dx),
    phase: 'to-warehouse',
    motionStatus: 'waiting',
    path: [],
    waypointIndex: 0,
    routeIndex: 0,
    cargoItemId: null,
    cargoQuantity: 0,
    completedTrips: 0,
    distanceTravelled: 0,
    retryTimer: 0,
    program: object.agvProgram ? { ...object.agvProgram } : null,
    decision: 'idle',
    blockedSeconds: 0,
    yieldCount: 0,
    currentWaypointLabel: '待规划',
    pathMode: 'mission',
  }
}

function createDroneRuntime(object: FactoryObject): DroneRuntime {
  return {
    objectId: object.id,
    position: { x: DRONE_DOCK[0], y: DRONE_DOCK_HEIGHT, z: DRONE_DOCK[1] },
    headingY: 0,
    phase: 'parked',
    motionStatus: 'waiting',
    path: [{ x: DRONE_DOCK[0], y: DRONE_DOCK_HEIGHT, z: DRONE_DOCK[1] }],
    pathLabels: ['L1 停机位 / 待命'],
    waypointIndex: 0,
    targetFloor: 2,
    deliveryPointIndex: 0,
    cargoItemId: null,
    cargoQuantity: 0,
    completedTrips: 0,
    distanceTravelled: 0,
    holdSeconds: 1.2,
  }
}

function buildDroneMission(targetFloor: 2 | 3): { points: DroneNavigationPoint[]; labels: string[] } {
  const route = getDroneRoute(targetFloor, DRONE_FLOOR_ELEVATIONS[targetFloor]).map(([x, y, z], index) => ({
    x,
    y: index === 0 ? DRONE_DOCK_HEIGHT : y,
    z,
  }))
  const hub = route[route.length - 1]
  const points: DroneNavigationPoint[] = [route[0]]
  const labels = ['L1 停机位 / 起飞']

  route.slice(1).forEach((point, index) => {
    points.push(point)
    labels.push(index === 0 ? '东侧升降井 / 进站' : index === 1 ? `垂直上升 / L${targetFloor}` : `外围高位环线 / ${index < 5 ? '东侧—北侧' : '西侧—南侧'}`)
  })

  FLOOR_DELIVERY_POINTS[targetFloor].forEach(([x, z], index) => {
    points.push({ x: hub.x, y: hub.y, z })
    labels.push(`L${targetFloor} 输入点 0${index + 1} / 横向分流`)
    points.push({ x, y: hub.y, z })
    labels.push(`L${targetFloor} 输入点 0${index + 1} / 配送`)
    points.push({ ...hub })
    labels.push(`L${targetFloor} 物料枢纽 / 返回`)
  })

  route.slice(0, -1).reverse().forEach((point, index) => {
    points.push(index === route.length - 2 ? { ...point, y: DRONE_DOCK_HEIGHT } : point)
    labels.push(index === route.length - 2 ? 'L1 停机位 / 返航' : '返航 / 外围环线')
  })
  return { points, labels }
}

function advanceDrone(runtime: DroneRuntime, dt: number): void {
  let remaining = DRONE_SPEED * dt
  while (remaining > 0 && runtime.waypointIndex < runtime.path.length) {
    const target = runtime.path[runtime.waypointIndex]
    const dx = target.x - runtime.position.x
    const dy = target.y - runtime.position.y
    const dz = target.z - runtime.position.z
    const segment = Math.hypot(dx, dy, dz)
    if (segment < 0.001) {
      runtime.position = { ...target }
      runtime.waypointIndex += 1
      continue
    }
    runtime.headingY = Math.atan2(dz, dx)
    if (remaining >= segment) {
      runtime.position = { ...target }
      runtime.distanceTravelled += segment
      remaining -= segment
      runtime.waypointIndex += 1
    } else {
      const amount = remaining / segment
      runtime.position = {
        x: runtime.position.x + dx * amount,
        y: runtime.position.y + dy * amount,
        z: runtime.position.z + dz * amount,
      }
      runtime.distanceTravelled += remaining
      remaining = 0
    }
  }

  const label = runtime.pathLabels[runtime.waypointIndex] ?? 'L1 停机位 / 返航'
  runtime.phase = dronePhaseFor(label)
  const deliveryMatch = label.match(/输入点 0(\d)/)
  if (deliveryMatch) runtime.deliveryPointIndex = Number(deliveryMatch[1]) - 1

  if (runtime.waypointIndex >= runtime.path.length) {
    runtime.completedTrips += 1
    runtime.targetFloor = runtime.targetFloor === 2 ? 3 : 2
    runtime.phase = 'parked'
    runtime.motionStatus = 'waiting'
    runtime.holdSeconds = 1.2
    runtime.path = [{ x: DRONE_DOCK[0], y: DRONE_DOCK_HEIGHT, z: DRONE_DOCK[1] }]
    runtime.pathLabels = ['L1 停机位 / 待命']
    runtime.waypointIndex = 0
    runtime.deliveryPointIndex = 0
    runtime.position = { x: DRONE_DOCK[0], y: DRONE_DOCK_HEIGHT, z: DRONE_DOCK[1] }
  }
}

function dronePhaseFor(label: string): DronePhase {
  if (label.includes('停机位')) return 'parked'
  if (label.includes('升降井')) return 'taxi-to-lift'
  if (label.includes('垂直上升')) return 'ascending'
  if (label.includes('外围') || label.includes('返航')) return label.includes('返航') ? 'returning' : 'perimeter'
  if (label.includes('输入点')) return 'to-input'
  return 'perimeter'
}
