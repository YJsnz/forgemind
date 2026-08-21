import { Edges, Html, Line } from '@react-three/drei'
import type { BuildType, FactoryFloorId, FactoryObject } from '../game/types'
import { DRONE_DOCK, FLOOR_DELIVERY_POINTS, FLOOR_LINE_DOCKS, getDroneRoute } from '../game/droneNavigation'
export type { FactoryFloorId } from '../game/types'

const FLOOR_HEIGHT = 36

export const FACTORY_FLOORS = [
  { id: 1, code: 'L1', name: '生产层', description: 'PRODUCTION / DRONE DOCK', elevation: 0 },
  { id: 2, code: 'L2', name: '工艺层', description: 'PROCESS LINE / DRONE SUPPLY', elevation: FLOOR_HEIGHT },
  { id: 3, code: 'L3', name: '装配层', description: 'ASSEMBLY LINE / DRONE SUPPLY', elevation: FLOOR_HEIGHT * 2 },
] as const

const PLATFORM_CENTER: [number, number] = [-2, -2]
const PLATFORM_SIZE: [number, number] = [48, 32]

export function getFloorElevation(floorId: FactoryFloorId): number {
  return FACTORY_FLOORS.find((floor) => floor.id === floorId)?.elevation ?? 0
}

/** Existing production objects and the drone dock stay on L1; upper-floor objects carry floorId. */
export function getObjectFloor(object: Pick<FactoryObject, 'type' | 'floorId'> | BuildType): FactoryFloorId {
  if (typeof object === 'string') return 1
  return object.floorId ?? 1
}

export function getFloorDroneDock(floorId: 2 | 3): [number, number] {
  return FLOOR_LINE_DOCKS[floorId]
}

export function FactoryFloorSystem({ activeFloor }: { activeFloor: FactoryFloorId }) {
  return (
    <group name="forgecore-floor-system">
      <FloorDecks activeFloor={activeFloor} />
      <VerticalCore />
      <DroneNavigationVisual activeFloor={activeFloor} />
    </group>
  )
}

function FloorDecks({ activeFloor }: { activeFloor: FactoryFloorId }) {
  return (
    <group>
      {FACTORY_FLOORS.map((floor) => {
        const isActive = floor.id === activeFloor
        const [width, depth] = PLATFORM_SIZE
        return (
          <group key={floor.id} position={[PLATFORM_CENTER[0], floor.elevation, PLATFORM_CENTER[1]]}>
            {floor.id !== 1 && (
              <mesh position={[0, -0.08, 0]} receiveShadow={isActive}>
                <boxGeometry args={[width, 0.16, depth]} />
                <meshStandardMaterial
                  color={floor.id === 3 ? '#5e8182' : '#708581'}
                  roughness={0.76}
                  metalness={0.18}
                  transparent
                  opacity={isActive ? 0.42 : 0.12}
                  depthWrite={isActive}
                />
                <Edges color={floor.id === 3 ? '#86d5ce' : '#d1ae38'} opacity={isActive ? 0.92 : 0.28} transparent />
              </mesh>
            )}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} renderOrder={isActive ? 2 : 1}>
              <planeGeometry args={[width, depth]} />
              <meshBasicMaterial
                color={floor.id === 3 ? '#6da9a4' : '#d6bf70'}
                transparent
                opacity={floor.id === 1 ? 0.025 : isActive ? 0.12 : 0.035}
                depthWrite={false}
              />
            </mesh>
            {isActive && <FloorGrid width={width} depth={depth} color={floor.id === 3 ? '#7bc9c2' : '#d3ad37'} />}
          </group>
        )
      })}
    </group>
  )
}

function FloorGrid({ width, depth, color }: { width: number; depth: number; color: string }) {
  const lines = Array.from({ length: 9 }, (_, index) => -20 + index * 5)
  return (
    <group position={[0, 0.028, 0]}>
      {lines.map((offset) => (
        <mesh key={`x-${offset}`} position={[offset, 0, 0]}>
          <boxGeometry args={[0.018, 0.012, depth]} />
          <meshBasicMaterial color={color} transparent opacity={0.24} />
        </mesh>
      ))}
      {lines.slice(1, 8).map((offset) => (
        <mesh key={`z-${offset}`} position={[0, 0, offset]}>
          <boxGeometry args={[width, 0.012, 0.018]} />
          <meshBasicMaterial color={color} transparent opacity={0.24} />
        </mesh>
      ))}
    </group>
  )
}

function VerticalCore() {
  const columns: Array<[number, number]> = [[-24, -18], [20, -18], [-24, 14], [20, 14]]
  return (
    <group name="factory-vertical-core">
      {columns.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, FLOOR_HEIGHT, z]}>
          <boxGeometry args={[0.12, FLOOR_HEIGHT * 2 + 0.1, 0.12]} />
          <meshBasicMaterial color="#6e9690" transparent opacity={0.3} />
        </mesh>
      ))}
      <Line points={[[PLATFORM_CENTER[0] - 24, 0.03, PLATFORM_CENTER[1] - 16], [PLATFORM_CENTER[0] + 24, 0.03, PLATFORM_CENTER[1] - 16]]} color="#d3af3c" lineWidth={1.1} transparent opacity={0.58} />
    </group>
  )
}

function DroneNavigationVisual({ activeFloor }: { activeFloor: FactoryFloorId }) {
  const targetFloor = activeFloor === 1 ? null : activeFloor
  const target = targetFloor ? getFloorDroneDock(targetFloor) : null
  const targetY = activeFloor === 1 ? 0 : getFloorElevation(activeFloor) + 4.5
  const points = targetFloor ? getDroneRoute(targetFloor, getFloorElevation(targetFloor)) : []
  const deliveryPoints = targetFloor ? FLOOR_DELIVERY_POINTS[targetFloor] : []

  return (
    <group name="drone-navigation">
      <mesh position={[DRONE_DOCK[0], 0.05, DRONE_DOCK[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.05, 1.32, 32]} />
        <meshBasicMaterial color="#e2b12e" transparent opacity={0.9} />
      </mesh>
      <Html position={[DRONE_DOCK[0], 2.2, DRONE_DOCK[1]]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
        <div className="fm-drone-dock-label">
          <b>L1 / DRONE DOCK</b>
          <span>{activeFloor === 1 ? 'PARKED / READY' : `UPLINK → L${activeFloor}`}</span>
        </div>
      </Html>
      {points.length > 1 && (
        <>
          <mesh position={[target![0], targetY, target![1]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.15, 1.48, 32]} />
            <meshBasicMaterial color="#80d9d0" transparent opacity={0.86} />
          </mesh>
          <Line points={points} color="#e2b12e" lineWidth={2} dashed dashSize={0.7} gapSize={0.35} transparent opacity={0.9} />
          {deliveryPoints.map(([x, z]) => (
            <Line
              key={`${x}-${z}`}
              points={[[target![0], targetY, target![1]], [target![0], targetY, z], [x, targetY, z]]}
              color="#75c8c0"
              lineWidth={1.05}
              dashed
              dashSize={0.36}
              gapSize={0.28}
              transparent
              opacity={0.72}
            />
          ))}
          <Html position={[target![0], targetY + 1.6, target![1]]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
            <div className="fm-drone-nav-label is-route">
              <b>L{activeFloor} / DRONE SUPPLY HUB</b>
              <span>L1 LIFT → PERIMETER LOOP → {deliveryPoints.length} INPUT DOCKS</span>
            </div>
          </Html>
        </>
      )}
    </group>
  )
}
