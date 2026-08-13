import { create } from 'zustand'
import type { BuildType, FactoryObject, GridPos, Rotation } from '../game/types'
import { canPlace } from '../game/grid'
import { DEFAULT_ITEMS, DEFAULT_RECIPES, type Item, type ItemCategory, type Recipe } from '../game/item'
import { genId as itemGenId } from '../game/item'
import type { FactorySave } from '../game/save'
import { SAVE_VERSION } from '../game/save'
import type { SimulationSnapshot } from '../game/simulation'

/**
 * 低频 UI/编辑状态（补充设计 §5.3：只装低频状态；
 * 高频仿真实体位置绝不进 store，命令式更新 Three.js）。
 *
 * Day 2：建造；Day 3：Item/Recipe + 保存加载。
 */

/** 生成对象短 id */
function genId(): string {
  return `obj_${Math.random().toString(36).slice(2, 9)}`
}

/** ghost 预览（跟随鼠标的待放置对象） */
export interface Ghost {
  type: BuildType
  pos: GridPos | null
  rotation: Rotation
  valid: boolean
}

export interface ForgeMindState {
  /** 当前选中的建造工具类型；null = 无工具（浏览/选择模式） */
  buildType: BuildType | null
  /** 已放置对象 */
  objects: FactoryObject[]
  /** ghost 预览 */
  ghost: Ghost
  ghostPath: GridPos[]
  ghostPathValid: boolean[]
  /** 当前选中对象 id */
  selectedId: string | null
  /** 物品类型定义 */
  items: Item[]
  /** 配方定义 */
  recipes: Recipe[]

  /** 仿真快照（低频，10Hz 由 runner 写入） */
  simSnapshot: SimulationSnapshot
  /** 仿真是否运行中 */
  simPlaying: boolean
  /** 仿真倍率 */
  simSpeed: number
  /** 重置信号：每 +1，runner 重建引擎 */
  simResetTick: number

  setBuildType: (t: BuildType | null) => void
  /** 更新 ghost 的网格位置（含合法性计算）；null = 指针不在网格上 */
  updateGhost: (pos: GridPos | null) => void
  setGhostPath: (path: GridPos[]) => void
  setGhostPathValid: (valid: boolean[]) => void
  /** ghost 旋转 90°（R 键） */
  rotateGhost: () => void
  /** 确认放置当前 ghost */
  place: () => void
  /** Place a segment at an explicit grid cell (used by conveyor drag placement). */
  placeAt: (pos: GridPos, rotation?: Rotation) => boolean
  /** 移除指定对象 */
  remove: (id: string) => void
  /** 旋转已放置对象 */
  rotateObject: (id: string) => void
  select: (id: string | null) => void

  /** 新增物品 */
  addItem: (name: string, category: ItemCategory, color: string) => void
  /** 删除物品（若有配方引用则一并移除引用，防止悬空） */
  removeItem: (id: string) => void
  /** 新增配方 */
  addRecipe: (
    name: string,
    inputs: Recipe['inputs'],
    outputs: Recipe['outputs'],
    durationSec: number,
  ) => void
  /** 删除配方 */
  removeRecipe: (id: string) => void

  /** 机器绑定配方 */
  bindRecipe: (objectId: string, recipeId: string | null) => void
  /** source 绑定产出物品 */
  bindItem: (objectId: string, itemId: string | null) => void

  /** 设置仿真快照（仅 runner 调用，低频） */
  setSimSnapshot: (snap: SimulationSnapshot) => void
  setSimPlaying: (p: boolean) => void
  setSimSpeed: (x: number) => void
  /** 请求重置仿真（runner 监听 tick 变化重建引擎） */
  requestSimReset: () => void

  /** 导出当前状态为存档对象 */
  exportSave: () => FactorySave
  /** 用存档覆盖当前状态 */
  importSave: (save: FactorySave) => void
  /** 清空全部（新建工厂） */
  clearAll: () => void
}

const emptyGhost: Ghost = { type: 'machine', pos: null, rotation: 0, valid: false }

const emptySnapshot: SimulationSnapshot = {
  timeSec: 0,
  machines: [],
  itemLots: [],
  stats: { consumed: {}, produced: {} },
}

export const useForgeMindStore = create<ForgeMindState>((set, get) => ({
  buildType: null,
  objects: [],
  ghost: emptyGhost,
  ghostPath: [],
  ghostPathValid: [],
  selectedId: null,
  items: DEFAULT_ITEMS,
  recipes: DEFAULT_RECIPES,
  simSnapshot: emptySnapshot,
  simPlaying: false,
  simSpeed: 1,
  simResetTick: 0,

  setBuildType: (t) =>
    set((s) => ({
      buildType: t,
      ghost: t ? { type: t, pos: s.ghost.pos, rotation: 0, valid: false } : emptyGhost,
      ghostPath: [],
      ghostPathValid: [],
    })),

  updateGhost: (pos) =>
    set((s) => {
      if (!s.ghost.pos && pos === null) return {}
      const rotation = s.ghost.rotation
      const valid = pos !== null && canPlace(pos, s.ghost.type, rotation, s.objects)
      return { ghost: { ...s.ghost, pos, valid } }
    }),

  setGhostPath: (path) => set({ ghostPath: path }),
  setGhostPathValid: (valid) => set({ ghostPathValid: valid }),

  rotateGhost: () =>
    set((s) => {
      if (!s.buildType) return {}
      const rotation = ((s.ghost.rotation + 90) % 360) as Rotation
      const pos = s.ghost.pos
      const valid =
        pos !== null && canPlace(pos, s.ghost.type, rotation, s.objects)
      return { ghost: { ...s.ghost, rotation, valid } }
    }),

  place: () =>
    set((s) => {
      if (!s.ghost.pos || !s.ghost.valid) return {}
      const obj: FactoryObject = {
        id: genId(),
        type: s.ghost.type,
        pos: s.ghost.pos,
        rotation: s.ghost.rotation,
      }
      return { objects: [...s.objects, obj] }
    }),

  placeAt: (pos, rotation = get().ghost.rotation) => {
    let placed = false
    set((s) => {
      if (!s.buildType || !canPlace(pos, s.buildType, rotation, s.objects)) return {}
      placed = true
      const obj: FactoryObject = {
        id: genId(),
        type: s.buildType,
        pos,
        rotation,
      }
      return { objects: [...s.objects, obj], ghost: { ...s.ghost, pos, rotation, valid: true } }
    })
    return placed
  },

  remove: (id) =>
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  rotateObject: (id) =>
    set((s) => {
      const obj = s.objects.find((o) => o.id === id)
      if (!obj) return {}
      const rotation = ((obj.rotation + 90) % 360) as Rotation
      const others = s.objects.filter((o) => o.id !== id)
      if (!canPlace(obj.pos, obj.type, rotation, others)) return {}
      return {
        objects: s.objects.map((o) => (o.id === id ? { ...o, rotation } : o)),
      }
    }),

  select: (id) => set({ selectedId: id }),

  addItem: (name, category, color) =>
    set((s) => ({
      items: [...s.items, { id: itemGenId('item'), name, category, color, size: 1 }],
    })),

  removeItem: (id) =>
    set((s) => {
      // 同时清理引用该物品的配方端口，防止悬空引用
      const recipes = s.recipes
        .map((r) => ({
          ...r,
          inputs: r.inputs.filter((p) => p.itemId !== id),
          outputs: r.outputs.filter((p) => p.itemId !== id),
        }))
        .filter((r) => r.inputs.length > 0 || r.outputs.length > 0)
      return {
        items: s.items.filter((i) => i.id !== id),
        recipes,
      }
    }),

  addRecipe: (name, inputs, outputs, durationSec) =>
    set((s) => ({
      recipes: [
        ...s.recipes,
        {
          id: itemGenId('recipe'),
          name,
          inputs,
          outputs,
          durationSec: Math.max(0.1, durationSec),
        },
      ],
    })),

  removeRecipe: (id) =>
    set((s) => ({ recipes: s.recipes.filter((r) => r.id !== id) })),

  bindRecipe: (objectId, recipeId) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...o, recipeId: recipeId ?? undefined } : o,
      ),
    })),

  bindItem: (objectId, itemId) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...o, itemId: itemId ?? undefined } : o,
      ),
    })),

  setSimSnapshot: (snap) => set({ simSnapshot: snap }),
  setSimPlaying: (p) => set({ simPlaying: p }),
  setSimSpeed: (x) => set({ simSpeed: x }),
  requestSimReset: () => set((s) => ({ simResetTick: s.simResetTick + 1 })),

  exportSave: () => {
    const s = get()
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      objects: s.objects,
      items: s.items,
      recipes: s.recipes,
    }
  },

  importSave: (save) =>
    set({
      objects: save.objects,
      items: save.items,
      recipes: save.recipes,
      selectedId: null,
      buildType: null,
      ghost: emptyGhost,
      ghostPath: [],
      ghostPathValid: [],
      simSnapshot: emptySnapshot,
      simPlaying: false,
    }),

  clearAll: () =>
    set({
      objects: [],
      items: [],
      recipes: [],
      selectedId: null,
      buildType: null,
      ghost: emptyGhost,
      ghostPath: [],
      ghostPathValid: [],
      simSnapshot: emptySnapshot,
      simPlaying: false,
    }),
}))
