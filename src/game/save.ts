import type { FactoryObject, Rotation } from './types'
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

export const SAVE_VERSION = 1

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
  const data = JSON.parse(json) as Record<string, unknown>

  if (typeof data !== 'object' || data === null) {
    throw new Error('存档不是有效对象')
  }

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

function parseObjects(v: unknown): FactoryObject[] {
  if (!Array.isArray(v)) throw new Error('objects 不是数组')
  return v.map((o) => {
    const x = o as Record<string, unknown>
    const type = x.type
    const pos = x.pos as Record<string, unknown>
    const rotation = x.rotation
    if (type !== 'machine' && type !== 'conveyor' && type !== 'source')
      throw new Error('对象类型非法')
    if (typeof pos?.x !== 'number' || typeof pos?.z !== 'number')
      throw new Error('对象位置非法')
    if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270)
      throw new Error('对象旋转非法')
    return {
      id: typeof x.id === 'string' ? x.id : genIdFor('obj'),
      type,
      pos: { x: pos.x, z: pos.z },
      rotation: rotation as Rotation,
      recipeId: typeof x.recipeId === 'string' ? x.recipeId : undefined,
      itemId: typeof x.itemId === 'string' ? x.itemId : undefined,
    }
  })
}

function parseItems(v: unknown): Item[] {
  if (!Array.isArray(v)) throw new Error('items 不是数组')
  return v.map((i) => {
    const x = i as Record<string, unknown>
    if (typeof x.name !== 'string') throw new Error('物品名称非法')
    const cat = x.category
    if (cat !== 'raw' && cat !== 'intermediate' && cat !== 'product')
      throw new Error('物品类别非法')
    return {
      id: typeof x.id === 'string' ? x.id : genIdFor('item'),
      name: x.name,
      category: cat,
      color: typeof x.color === 'string' ? x.color : '#4fc3f7',
      size: typeof x.size === 'number' ? x.size : 1,
      note: typeof x.note === 'string' ? x.note : undefined,
    }
  })
}

function parseRecipes(v: unknown, items: Item[]): Recipe[] {
  if (!Array.isArray(v)) throw new Error('recipes 不是数组')
  const itemIds = new Set(items.map((i) => i.id))
  return v.map((r) => {
    const x = r as Record<string, unknown>
    if (typeof x.name !== 'string') throw new Error('配方名称非法')
    const inputs = parsePorts(x.inputs, itemIds)
    const outputs = parsePorts(x.outputs, itemIds)
    return {
      id: typeof x.id === 'string' ? x.id : genIdFor('recipe'),
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
    const x = p as Record<string, unknown>
    if (typeof x.itemId !== 'string' || !validItemIds.has(x.itemId))
      throw new Error('配方引用了不存在的物品')
    if (typeof x.qty !== 'number' || x.qty <= 0) throw new Error('配方数量非法')
    return { itemId: x.itemId, qty: x.qty }
  })
}

function genIdFor(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}
