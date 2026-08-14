import { isTransportType, objectRole, type FactoryObject } from './types'
import type { Recipe } from './item'
import { mulberry32 } from './rng'
import { rotationToDir, cellKey } from './dir'
import { objectPortCell, objectPortCells, occupiedCells } from './grid'

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
  /** 沿 conveyor 朝向的格内进度 0..1 */
  offset: number
}

export interface SimStats {
  consumed: Record<string, number>
  produced: Record<string, number>
}

/** 快照：前端消费的最小接口 */
export interface SimulationSnapshot {
  timeSec: number
  machines: MachineRuntime[]
  sources: SourceRuntimeSnapshot[]
  itemLots: ItemLot[]
  stats: SimStats
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

export class SimulationEngine {
  readonly seed: number
  readonly rng: () => number

  private timeSec = 0
  private accumulator = 0

  private machines = new Map<string, MachineRuntime>()
  private conveyors = new Map<string, ConveyorRuntime>()
  private sources = new Map<string, SourceRuntime>()
  private recipes = new Map<string, Recipe>()
  /** cellKey -> FactoryObject（用于查下游） */
  private objectByCell = new Map<string, FactoryObject>()
  /** objectId -> FactoryObject（用于查自身 pos/rotation） */
  private objectById = new Map<string, FactoryObject>()

  private stats: SimStats = { consumed: {}, produced: {} }
  private lotCounter = 0

  constructor(seed: number) {
    this.seed = seed >>> 0
    this.rng = mulberry32(this.seed)
  }

  /** 装载工厂结构 */
  init(objects: FactoryObject[], recipes: Recipe[]): void {
    this.timeSec = 0
    this.accumulator = 0
    this.stats = { consumed: {}, produced: {} }
    this.machines.clear()
    this.conveyors.clear()
    this.sources.clear()
    this.recipes.clear()
    this.objectByCell.clear()
    this.objectById.clear()
    this.lotCounter = 0

    for (const r of recipes) this.recipes.set(r.id, r)

    for (const o of objects) {
      for (const cell of occupiedCells(o)) {
        this.objectByCell.set(cellKey(cell.x, cell.z), o)
      }
      this.objectById.set(o.id, o)
      if (objectRole(o.type) === 'machine') {
        this.machines.set(o.id, {
          objectId: o.id,
          state: 'idle',
          progress: 0,
          recipeId: o.recipeId ?? null,
          inputBuffer: {},
          processingTime: 0,
        })
      } else if (isTransportType(o.type)) {
        this.conveyors.set(o.id, { objectId: o.id, lot: null, branchCursor: 0 })
      } else if (objectRole(o.type) === 'source') {
        this.sources.set(o.id, {
          objectId: o.id,
          itemId: o.itemId ?? null,
          timer: 0,
          transferTimer: 0,
          state: 'idle',
        })
      }
    }
  }

  advance(dtSec: number): void {
    if (dtSec <= 0) return
    this.accumulator += dtSec
    let guard = 0
    while (this.accumulator >= SIM_STEP && guard < 1000) {
      this.step(SIM_STEP)
      this.accumulator -= SIM_STEP
      guard++
    }
  }

  private step(dt: number): void {
    this.timeSec += dt
    this.stepSources(dt)
    this.stepConveyors(dt)
    this.stepMachines(dt)
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
      .map((cell) => this.objectByCell.get(cellKey(cell.x, cell.z)))
      .filter((obj): obj is FactoryObject => Boolean(obj))
      .filter((obj) => this.isConnected(srcObj, obj))
  }

  private trySourceOutput(srcObj: FactoryObject, itemId: string): boolean {
    for (const downstream of this.sourceDownstreams(srcObj)) {
      if (isTransportType(downstream.type)) {
        const c = this.conveyors.get(downstream.id)
        if (c && !c.lot) {
          c.lot = this.makeLot(itemId, downstream.id, 0)
          return true
        }
      } else if (objectRole(downstream.type) === 'machine' && this.tryFeedMachine(downstream.id, itemId)) {
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
        const downstream = this.objectByCell.get(cellKey(nx, nz))

        let moved = false
        if (downstream && this.isConnected(obj, downstream) && isTransportType(downstream.type)) {
          const dc = this.conveyors.get(downstream.id)
          if (dc && !dc.lot) {
            dc.lot = this.makeLot(lot.itemId, downstream.id, lot.offset - 1)
            c.lot = null
            moved = true
          }
        } else if (downstream && this.isConnected(obj, downstream) && objectRole(downstream.type) === 'machine') {
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
      const downstream = this.objectByCell.get(cellKey(output.x, output.z))
      if (!downstream || !this.isConnected(obj, downstream)) continue
      if (isTransportType(downstream.type)) {
        const dc = this.conveyors.get(downstream.id)
        if (!dc || dc.lot) continue
        dc.lot = this.makeLot(lot.itemId, downstream.id, lot.offset - 1)
        c.branchCursor = (start + offset + 1) % outputs.length
        c.lot = null
        return true
      }
      if (objectRole(downstream.type) === 'machine' && this.tryFeedMachine(downstream.id, lot.itemId)) {
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
          for (const p of recipe.inputs) {
            this.stats.consumed[p.itemId] =
              (this.stats.consumed[p.itemId] ?? 0) + p.qty
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
      .map((cell) => this.objectByCell.get(cellKey(cell.x, cell.z)))
      .filter((target): target is FactoryObject => Boolean(target))
    const downstream = downstreams.find((target) => this.isConnected(obj, target))

    const out = recipe.outputs[0] // MVP 单输出；多输出后续扩展

    if (downstream && isTransportType(downstream.type)) {
      const dc = this.conveyors.get(downstream.id)
      if (dc && !dc.lot) {
        dc.lot = this.makeLot(out.itemId, downstream.id, 0)
        this.recordProduced(recipe)
        return true
      }
      return false // 下游传送带满 → 背压
    }

    // 下游无传送带 → 直接视为出口，计入产出
    if (downstreams.length > 0 && !downstream) return false

    this.recordProduced(recipe)
    return true
  }

  private recordProduced(recipe: Recipe): void {
    for (const p of recipe.outputs) {
      this.stats.produced[p.itemId] = (this.stats.produced[p.itemId] ?? 0) + p.qty
    }
  }

  /** A transfer is valid only when the upstream output faces the downstream input. */
  private isConnected(upstream: FactoryObject, downstream: FactoryObject): boolean {
    const inputCells = objectPortCells(downstream, 'input')
    if (inputCells.length === 0) return true
    return occupiedCells(upstream).some((cell) => inputCells.some((input) => cell.x === input.x && cell.z === input.z))
  }

  private makeLot(itemId: string, conveyorId: string, offset: number): ItemLot {
    return {
      id: `lot_${this.lotCounter++}`,
      itemId,
      conveyorId,
      offset,
    }
  }

  private findMachineObject(machineId: string): FactoryObject | undefined {
    return this.objectById.get(machineId)
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
      stats: {
        consumed: { ...this.stats.consumed },
        produced: { ...this.stats.produced },
      },
    }
  }
}
