import type { FactoryObject, Footprint, GridPos, PortSide, Rotation } from './types'
import { BUILD_BOUND, getObjectDef } from './types'
import { rotationToDir } from './dir'

/** 世界坐标 = 格坐标（1 格 = 1 米，格锚点在格中心） */
export function gridToWorld(g: GridPos): { x: number; z: number } {
  return { x: g.x + 0.5, z: g.z + 0.5 }
}

/** The visual anchor for a footprint is its geometric centre, not its min corner. */
export function objectToWorld(obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>): { x: number; z: number } {
  const fp = rotatedFootprint(getObjectDef(obj.type, obj.resourceId).footprint, obj.rotation)
  return { x: obj.pos.x + fp.w / 2, z: obj.pos.z + fp.d / 2 }
}

/** 旋转后足迹（0/180 不变，90/270 交换宽深） */
export function rotatedFootprint(f: Footprint, r: Rotation): Footprint {
  return r === 90 || r === 270 ? { w: f.d, d: f.w } : f
}

/** 对象占用的所有格坐标 */
export function occupiedCells(obj: FactoryObject): GridPos[] {
  const def = getObjectDef(obj.type, obj.resourceId)
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
  resourceId?: string,
): boolean {
  const def = getObjectDef(type, resourceId)
  const fp = rotatedFootprint(def.footprint, rotation)
  if (isOutOfBounds(pos, fp)) return false
  const cells = occupiedCells({ id: '', type, resourceId, pos, rotation })
  return !others.some((o) => cellsOverlap(cells, occupiedCells(o)))
}

/** Returns the first grid cell immediately outside a machine's named port. */
export function objectPortCell(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
): GridPos | null {
  return objectPortCells(obj, port)[0] ?? null
}

/** Returns all external cells for a named port. Splitters and mergers expose multiple ports. */
export function objectPortCells(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
): GridPos[] {
  const def = getObjectDef(obj.type, obj.resourceId)
  const side = port === 'input' ? def.inputPort : def.outputPort
  if (!side) return []

  const cells = portCellsBySide(obj)
  if (obj.type === 'splitter') return port === 'output' ? [...cells.front, ...cells.left, ...cells.right] : cells.back
  if (obj.type === 'merger') return port === 'input' ? [...cells.back, ...cells.left, ...cells.right] : cells.front
  // The infeed station is a 3x2 compound model with one physical belt on
  // the near central lane. Keep the simulation and the visual dock on that
  // same lane instead of averaging the two middle cells of the footprint.
  if (obj.type === 'source' && port === 'output') return cells.front.slice(0, 1)
  // The robotic assembly cell is fed from three independent dock faces. This
  // prevents one saturated material lane from blocking the other BOM inputs.
  if (obj.type === 'assembler' && port === 'input') return assemblyDockCells(obj)
  // A single conveyor segment can be the corner of a Manhattan drag route.
  // Its output remains directional, while the inlet may arrive from either
  // side of the segment as well as from the conventional back port.
  if (obj.type === 'conveyor' && port === 'input') return [...cells.back, ...cells.left, ...cells.right]
  return cells[side]
}

/** Returns the external grid cells for one named side of a port. */
export function objectPortCellsForSide(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
  side: PortSide,
): GridPos[] {
  const def = getObjectDef(obj.type, obj.resourceId)
  const declaredSide = port === 'input' ? def.inputPort : def.outputPort
  if (!declaredSide) return []
  if (obj.type === 'splitter' && port === 'input' && side !== 'back') return []
  if (obj.type === 'splitter' && port === 'output' && !['front', 'left', 'right'].includes(side)) return []
  if (obj.type === 'merger' && port === 'output' && side !== 'front') return []
  if (obj.type === 'merger' && port === 'input' && !['back', 'left', 'right'].includes(side)) return []
  if (obj.type === 'source' && port === 'output' && side !== declaredSide) return []
  if (obj.type === 'assembler' && port === 'input' && !['back', 'left', 'right'].includes(side)) return []
  if (obj.type !== 'splitter' && obj.type !== 'merger' && obj.type !== 'conveyor' && obj.type !== 'assembler' && side !== declaredSide) return []
  if (obj.type === 'conveyor' && port === 'output' && side !== declaredSide) return []
  if (obj.type === 'conveyor' && port === 'input' && !['back', 'left', 'right'].includes(side)) return []
  const cells = portCellsBySide(obj)[side]
  if (obj.type === 'source' && port === 'output') return cells.slice(0, 1)
  return cells
}

function portCellsBySide(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
): Record<PortSide, GridPos[]> {
  const def = getObjectDef(obj.type, obj.resourceId)
  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const forward = rotationToDir(obj.rotation)
  const sideDir = { dx: -forward.dz, dz: forward.dx }

  const central = (length: number): number[] => {
    const middle = Math.floor(length / 2)
    // An even-sized footprint has two equally central lanes. Accept both so
    // a belt can be routed through either middle row/column of a large cell.
    return length % 2 === 0 ? [middle - 1, middle] : [middle]
  }
  const xMiddle = central(fp.w)
  const zMiddle = central(fp.d)
  const minX = obj.pos.x
  const maxX = obj.pos.x + fp.w - 1
  const minZ = obj.pos.z
  const maxZ = obj.pos.z + fp.d - 1
  const edge = (dir: { dx: number; dz: number }, distance: number, varying: number[]): GridPos[] => varying.map((value) => ({
    x: (dir.dx * distance !== 0 ? (dir.dx > 0 ? maxX + 1 : minX - 1) : obj.pos.x + value),
    z: (dir.dz * distance !== 0 ? (dir.dz > 0 ? maxZ + 1 : minZ - 1) : obj.pos.z + value),
  }))

  const front = forward.dx !== 0
    ? edge(forward, 1, zMiddle)
    : edge(forward, 1, xMiddle)
  const back = forward.dx !== 0
    ? edge({ dx: -forward.dx, dz: -forward.dz }, 1, zMiddle)
    : edge({ dx: -forward.dx, dz: -forward.dz }, 1, xMiddle)
  const left = sideDir.dx !== 0
    ? edge(sideDir, 1, zMiddle)
    : edge(sideDir, 1, xMiddle)
  const right = sideDir.dx !== 0
    ? edge({ dx: -sideDir.dx, dz: -sideDir.dz }, 1, zMiddle)
    : edge({ dx: -sideDir.dx, dz: -sideDir.dz }, 1, xMiddle)
  return { front, back, left, right }
}

/** All rear/side edge cells of the 3x3 robotic cell are valid line-side docks. */
function assemblyDockCells(obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>): GridPos[] {
  const forward = rotationToDir(obj.rotation)
  const left = { dx: -forward.dz, dz: forward.dx }
  const directions = [
    { dx: -forward.dx, dz: -forward.dz },
    left,
    { dx: -left.dx, dz: -left.dz },
  ]
  const occupied = occupiedCells({ id: '', ...obj })
  const occupiedSet = new Set(occupied.map((cell) => `${cell.x},${cell.z}`))
  const docks = directions.flatMap((direction) => occupied
    .filter((cell) => !occupiedSet.has(`${cell.x + direction.dx},${cell.z + direction.dz}`))
    .map((cell) => ({ x: cell.x + direction.dx, z: cell.z + direction.dz })))
  return Array.from(new Map(docks.map((cell) => [`${cell.x},${cell.z}`, cell])).values())
}

export function portWorldOffset(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
  side?: PortSide,
): { x: number; z: number } | null {
  const cells = side ? objectPortCellsForSide(obj, port, side) : objectPortCells(obj, port)
  if (cells.length === 0) return null
  const centre = objectToWorld(obj)
  const world = cells.reduce((sum, cell) => {
    const point = gridToWorld(cell)
    return { x: sum.x + point.x / cells.length, z: sum.z + point.z / cells.length }
  }, { x: 0, z: 0 })
  return { x: world.x - centre.x, z: world.z - centre.z }
}

/** 占用格去重合并（用于碰撞加速，MVP 直接线性扫） */
export function allOccupied(objects: FactoryObject[]): GridPos[] {
  return objects.flatMap(occupiedCells)
}
