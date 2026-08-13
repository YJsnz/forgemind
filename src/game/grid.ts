import type { FactoryObject, Footprint, GridPos, Rotation } from './types'
import { BUILD_BOUND, OBJECT_DEFS } from './types'
import { rotationToDir } from './dir'

/** 世界坐标 = 格坐标（1 格 = 1 米，格锚点在格中心） */
export function gridToWorld(g: GridPos): { x: number; z: number } {
  return { x: g.x + 0.5, z: g.z + 0.5 }
}

/** The visual anchor for a footprint is its geometric centre, not its min corner. */
export function objectToWorld(obj: Pick<FactoryObject, 'type' | 'pos' | 'rotation'>): { x: number; z: number } {
  const fp = rotatedFootprint(OBJECT_DEFS[obj.type].footprint, obj.rotation)
  return { x: obj.pos.x + fp.w / 2, z: obj.pos.z + fp.d / 2 }
}

/** 旋转后足迹（0/180 不变，90/270 交换宽深） */
export function rotatedFootprint(f: Footprint, r: Rotation): Footprint {
  return r === 90 || r === 270 ? { w: f.d, d: f.w } : f
}

/** 对象占用的所有格坐标 */
export function occupiedCells(obj: FactoryObject): GridPos[] {
  const def = OBJECT_DEFS[obj.type]
  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const cells: GridPos[] = []
  for (let dx = 0; dx < fp.w; dx++) {
    for (let dz = 0; dz < fp.d; dz++) {
      cells.push({ x: obj.pos.x + dx, z: obj.pos.z + dz })
    }
  }
  return cells
}

/** 是否越出建造区边界 */
export function isOutOfBounds(pos: GridPos, fp: Footprint): boolean {
  const minX = pos.x
  const minZ = pos.z
  const maxX = pos.x + fp.w - 1
  const maxZ = pos.z + fp.d - 1
  return (
    minX < -BUILD_BOUND ||
    maxX > BUILD_BOUND ||
    minZ < -BUILD_BOUND ||
    maxZ > BUILD_BOUND
  )
}

/** 两组格是否重叠（用于碰撞） */
export function cellsOverlap(a: GridPos[], b: GridPos[]): boolean {
  const key = (c: GridPos) => `${c.x},${c.z}`
  const set = new Set(a.map(key))
  return b.some((c) => set.has(key(c)))
}

/**
 * 放置合法性：界内 + 不与其它对象碰撞。
 * @param pos 锚点格（最小角）
 * @param type 类型
 * @param rotation 旋转
 * @param others 已存在的对象（不含自身）
 */
export function canPlace(
  pos: GridPos,
  type: FactoryObject['type'],
  rotation: Rotation,
  others: FactoryObject[],
): boolean {
  const def = OBJECT_DEFS[type]
  const fp = rotatedFootprint(def.footprint, rotation)
  if (isOutOfBounds(pos, fp)) return false
  const cells = occupiedCells({ id: '', type, pos, rotation })
  return !others.some((o) => cellsOverlap(cells, occupiedCells(o)))
}

/** Returns the first grid cell immediately outside a machine's named port. */
export function objectPortCell(
  obj: Pick<FactoryObject, 'type' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
): GridPos | null {
  return objectPortCells(obj, port)[0] ?? null
}

/** Returns all external cells for a named port. Splitters and mergers expose multiple ports. */
export function objectPortCells(
  obj: Pick<FactoryObject, 'type' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
): GridPos[] {
  const def = OBJECT_DEFS[obj.type]
  const side = port === 'input' ? def.inputPort : def.outputPort
  if (!side) return []

  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const centreX = obj.pos.x + Math.floor(fp.w / 2)
  const centreZ = obj.pos.z + Math.floor(fp.d / 2)
  const forward = rotationToDir(obj.rotation)
  const sideDir = { dx: -forward.dz, dz: forward.dx }

  const forwardReach = forward.dx !== 0 ? Math.ceil(fp.w / 2) : Math.ceil(fp.d / 2)
  const sideReach = sideDir.dx !== 0 ? Math.ceil(fp.w / 2) : Math.ceil(fp.d / 2)
  const front = { x: centreX + forward.dx * forwardReach, z: centreZ + forward.dz * forwardReach }
  const back = { x: centreX - forward.dx * forwardReach, z: centreZ - forward.dz * forwardReach }
  const left = { x: centreX + sideDir.dx * sideReach, z: centreZ + sideDir.dz * sideReach }
  const right = { x: centreX - sideDir.dx * sideReach, z: centreZ - sideDir.dz * sideReach }
  if (obj.type === 'splitter') return port === 'output' ? [front, left, right] : [back]
  if (obj.type === 'merger') return port === 'input' ? [back, left, right] : [front]
  // A single conveyor segment can be the corner of a Manhattan drag route.
  // Its output remains directional, while the inlet may arrive from either
  // side of the segment as well as from the conventional back port.
  if (obj.type === 'conveyor' && port === 'input') return [back, left, right]
  if (side === 'front') return [front]
  if (side === 'back') return [back]
  if (side === 'left') return [left]
  return [right]
}

export function portWorldOffset(
  obj: Pick<FactoryObject, 'type' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
): { x: number; z: number } | null {
  const cell = objectPortCell(obj, port)
  if (!cell) return null
  const centre = objectToWorld(obj)
  const world = gridToWorld(cell)
  return { x: world.x - centre.x, z: world.z - centre.z }
}

/** 占用格去重合并（用于碰撞加速，MVP 直接线性扫） */
export function allOccupied(objects: FactoryObject[]): GridPos[] {
  return objects.flatMap(occupiedCells)
}
