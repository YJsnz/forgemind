import { isBuildType, type AgvProgram, type AgvRouteWaypoint, type FactoryObject, type Rotation } from './types'
import type { Item, Recipe, RecipePort } from './item'

/**
 * 工厂存档格式（JSON 导入/导出，Day 3）。
 * 补充设计 §4.4：7 天冲刺不接数据库，静态结构用 JSON 文件持久化。
 */

export interface FactorySave {
  version: number
  savedAt?: string
  objects: FactoryObject[]
  items: Item[]
  recipes: Recipe[]
}

/** Version 2 includes the complete equipment catalogue in `objects`. */
export const SAVE_VERSION = 2
const FIRST_SUPPORTED_VERSION = 1

/** 导出存档（序列化到 JSON 字符串） */
export function serializeSave(save: FactorySave): string {
  return JSON.stringify(save, null, 2)
}

/** 下载存档为文件 */
export function downloadSave(save: FactorySave, filename = 'forgemind-factory.json') {
  const blob = new Blob([serializeSave(save)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 从文件读取 JSON 文本 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

/**
 * 解析并校验存档，返回合法 FactorySave；非法则抛错。
 * 校验策略：未知字段忽略，关键字段做运行时类型检查（防脏数据进入 store）。
 */
export function parseSave(json: string): FactorySave {
  const parsed: unknown = JSON.parse(json)

  if (!isRecord(parsed)) {
    throw new Error('存档不是有效对象')
  }

  const version = parseVersion(parsed.version)
  const data = migrateSave(parsed, version)
  const objects = parseObjects(data.objects)
  const items = parseItems(data.items)
  const recipes = parseRecipes(data.recipes, items)

  return {
    version: SAVE_VERSION,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : undefined,
    objects,
    items,
    recipes,
  }
}

function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('存档版本非法')
  }
  if (value < FIRST_SUPPORTED_VERSION || value > SAVE_VERSION) {
    throw new Error(`不支持的存档版本 v${value}，当前支持 v${FIRST_SUPPORTED_VERSION}–v${SAVE_VERSION}`)
  }
  return value
}

/**
 * Upgrade older payloads before validation. Version 1 and 2 share the same
 * fields; v2 widens the accepted object catalogue, so the migration is a
 * deliberate normalization rather than a shape rewrite.
 */
function migrateSave(data: Record<string, unknown>, version: number): Record<string, unknown> {
  if (version === SAVE_VERSION) return data
  return { ...data, version: SAVE_VERSION }
}

function parseObjects(v: unknown): FactoryObject[] {
  if (!Array.isArray(v)) throw new Error('objects 不是数组')
  const ids = new Set<string>()
  return v.map((o) => {
    if (!isRecord(o)) throw new Error('对象数据非法')
    const x = o
    const type = x.type
    const pos = x.pos
    const rotation = x.rotation
    if (!isBuildType(type))
      throw new Error('对象类型非法')
    if (!isRecord(pos) || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.z))
      throw new Error('对象位置非法')
    if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270)
      throw new Error('对象旋转非法')
    const id = typeof x.id === 'string' ? x.id : genIdFor('obj')
    if (ids.has(id)) throw new Error(`对象 id 重复：${id}`)
    ids.add(id)
    return {
      id,
      type,
      pos: { x: pos.x as number, z: pos.z as number },
      rotation: rotation as Rotation,
      recipeId: typeof x.recipeId === 'string' ? x.recipeId : undefined,
      itemId: typeof x.itemId === 'string' ? x.itemId : undefined,
      agvProgram: parseAgvProgram(x.agvProgram),
    }
  })
}

function parseAgvProgram(value: unknown): AgvProgram | undefined {
  if (!isRecord(value)) return undefined
  const route = Array.isArray(value.route) ? value.route.flatMap((entry): AgvRouteWaypoint[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.label !== 'string' || !isRecord(entry.position)) return []
    if (!isFiniteNumber(entry.position.x) || !isFiniteNumber(entry.position.z)) return []
    const action = entry.action === 'load' || entry.action === 'unload' || entry.action === 'pass' ? entry.action : 'pass'
    return [{ id: entry.id, label: entry.label, objectId: typeof entry.objectId === 'string' ? entry.objectId : null, position: { x: entry.position.x, z: entry.position.z }, action }]
  }) : undefined
  const policy = value.policy === 'shortest' || value.policy === 'priority' || value.policy === 'balanced' ? value.policy : 'balanced'
  return {
    enabled: value.enabled === true,
    sourceObjectId: typeof value.sourceObjectId === 'string' ? value.sourceObjectId : null,
    destinationObjectId: typeof value.destinationObjectId === 'string' ? value.destinationObjectId : null,
    itemId: typeof value.itemId === 'string' ? value.itemId : null,
    loadQuantity: isFiniteNumber(value.loadQuantity) ? Math.max(1, Math.round(value.loadQuantity)) : 100,
    route,
    priority: isFiniteNumber(value.priority) ? Math.max(0, Math.min(9, Math.round(value.priority))) : 0,
    policy,
  }
}

function parseItems(v: unknown): Item[] {
  if (!Array.isArray(v)) throw new Error('items 不是数组')
  const ids = new Set<string>()
  return v.map((i) => {
    if (!isRecord(i)) throw new Error('物品数据非法')
    const x = i
    if (typeof x.name !== 'string') throw new Error('物品名称非法')
    const cat = x.category
    if (cat !== 'raw' && cat !== 'intermediate' && cat !== 'product')
      throw new Error('物品类别非法')
    const id = typeof x.id === 'string' ? x.id : genIdFor('item')
    if (ids.has(id)) throw new Error(`物品 id 重复：${id}`)
    ids.add(id)
    if (x.size !== undefined && (!isFiniteNumber(x.size) || x.size <= 0)) throw new Error('物品尺寸非法')
    return {
      id,
      name: x.name,
      category: cat,
      color: typeof x.color === 'string' ? x.color : '#4fc3f7',
      size: typeof x.size === 'number' ? x.size : 1,
      note: typeof x.note === 'string' ? x.note : undefined,
      modelPath: typeof x.modelPath === 'string' ? x.modelPath : undefined,
    }
  })
}

function parseRecipes(v: unknown, items: Item[]): Recipe[] {
  if (!Array.isArray(v)) throw new Error('recipes 不是数组')
  const itemIds = new Set(items.map((i) => i.id))
  const ids = new Set<string>()
  return v.map((r) => {
    if (!isRecord(r)) throw new Error('配方数据非法')
    const x = r
    if (typeof x.name !== 'string') throw new Error('配方名称非法')
    const inputs = parsePorts(x.inputs, itemIds)
    const outputs = parsePorts(x.outputs, itemIds)
    if (x.durationSec !== undefined && (!isFiniteNumber(x.durationSec) || x.durationSec <= 0)) throw new Error('配方时长非法')
    const id = typeof x.id === 'string' ? x.id : genIdFor('recipe')
    if (ids.has(id)) throw new Error(`配方 id 重复：${id}`)
    ids.add(id)
    return {
      id,
      name: x.name,
      inputs,
      outputs,
      durationSec: typeof x.durationSec === 'number' ? x.durationSec : 1,
    }
  })
}

function parsePorts(v: unknown, validItemIds: Set<string>): RecipePort[] {
  if (!Array.isArray(v)) throw new Error('配方端口不是数组')
  return v.map((p) => {
    if (!isRecord(p)) throw new Error('配方端口非法')
    const x = p
    if (typeof x.itemId !== 'string' || !validItemIds.has(x.itemId))
      throw new Error('配方引用了不存在的物品')
    if (!isFiniteNumber(x.qty) || x.qty <= 0) throw new Error('配方数量非法')
    return { itemId: x.itemId, qty: x.qty as number }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function genIdFor(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}
