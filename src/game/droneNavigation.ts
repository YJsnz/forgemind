import type { FactoryFloorId } from './types'

export type DroneRoutePoint = [number, number]

/** Shared cargo-drone route definition used by the 3D scene and warehouse control page. */
export const DRONE_DOCK: DroneRoutePoint = [18.5, -13.5]
export const DRONE_LIFT_SHAFT: DroneRoutePoint = [18, -15]

export const FLOOR_LINE_DOCKS: Record<2 | 3, DroneRoutePoint> = {
  2: [16, -15],
  3: [16, -15],
}

export const FLOOR_DELIVERY_POINTS: Record<2 | 3, DroneRoutePoint[]> = {
  2: [[-22, -10], [-4, 13], [7, -14], [-22, 10]],
  3: [[-8, 1], [3, 10], [3, -7], [10, 1]],
}

export const DRONE_FLOOR_ELEVATIONS: Record<2 | 3, number> = {
  2: 36,
  3: 72,
}

export function getDroneRoute(floorId: 2 | 3, elevation: number): Array<[number, number, number]> {
  const target = FLOOR_LINE_DOCKS[floorId]
  const targetY = elevation + 4.5
  return [
    [DRONE_DOCK[0], 2.05, DRONE_DOCK[1]],
    [DRONE_LIFT_SHAFT[0], 2.05, DRONE_LIFT_SHAFT[1]],
    [DRONE_LIFT_SHAFT[0], targetY, DRONE_LIFT_SHAFT[1]],
    [20.5, targetY, -15],
    [20.5, targetY, 14],
    [-22.5, targetY, 14],
    [-22.5, targetY, -16],
    [target[0], targetY, -16],
    [target[0], targetY, target[1]],
  ]
}

export function droneRouteLabels(floorId: 2 | 3): string[] {
  return [
    'L1 停机位 / 待命',
    '东侧升降井 / 进站',
    `垂直上升 / ${floorId === 2 ? '36' : '72'}M`,
    '外围高位环线 / 东南侧',
    '外围高位环线 / 东北侧',
    '外围高位环线 / 西北侧',
    '外围高位环线 / 西南侧',
    '外围高位环线 / 南侧转接',
    `L${floorId} 物料枢纽 / 对接`,
  ]
}

export function getDroneTargetFloor(floorId: FactoryFloorId): 2 | 3 | null {
  return floorId === 2 || floorId === 3 ? floorId : null
}
