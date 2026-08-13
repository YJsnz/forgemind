import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { OBJECT_DEFS } from '../game/types'
import { objectPortCells, objectToWorld, occupiedCells, rotatedFootprint } from '../game/grid'
import { EquipmentModel } from './EquipmentModel'
import type { FactoryObject, PortSide } from '../game/types'
import type { MachineRuntime } from '../game/simulation'

/**
 * 单个已放置对象的渲染。
 * - machine：高精度公模（机械臂）+ 状态色底座 + 进度条
 * - conveyor/source：程序化几何（简单几何体，无需公模）
 */
export function FactoryObjectMesh({
  obj,
  objects,
  selected,
  active = false,
  runtime,
  onClick,
}: {
  obj: FactoryObject
  objects: FactoryObject[]
  selected: boolean
  active?: boolean
  runtime?: MachineRuntime
  onClick: (id: string) => void
}) {
  const def = OBJECT_DEFS[obj.type]
  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const { x, z } = objectToWorld(obj)
  const group = useRef<THREE.Group>(null)

  const stateColor = machineStateColor(runtime)
  const conveyorLinks = def.role === 'conveyor' && obj.type === 'conveyor'
    ? getConveyorLinks(obj, objects)
    : null

  // 选中态低强度发光脉冲
  useFrame(({ clock }) => {
    if (!group.current || !selected) return
    const t = clock.getElapsedTime()
    const pulse = 0.5 + 0.5 * Math.sin(t * 3)
    group.current.scale.setScalar(1 + pulse * 0.03)
  })

  const isMachine = def.role === 'machine'

  return (
    <group
      ref={group}
      position={[x, 0, z]}
      rotation={[0, obj.rotation === 90 ? -Math.PI / 2 : obj.rotation === 180 ? Math.PI : obj.rotation === 270 ? Math.PI / 2 : 0, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onClick(obj.id)
      }}
    >
      {isMachine ? (
        <>
          <EquipmentModel type={obj.type} color={def.color} accent={def.accent} height={def.height} active={active} runtime={runtime} />
          {/* 状态色底座（显示机器状态，模型上方不遮挡） */}
          <mesh position={[0, 0.025, 0]} receiveShadow>
            <boxGeometry args={[fp.w, 0.04, fp.d]} />
            <meshStandardMaterial
              color="#697773"
              roughness={0.72}
              metalness={0.35}
            />
          </mesh>
          <mesh position={[0, 0.048, 0]} receiveShadow>
            <boxGeometry args={[Math.max(fp.w - 0.14, 0.2), 0.012, Math.max(fp.d - 0.14, 0.2)]} />
            <meshStandardMaterial color="#a4b0aa" roughness={0.55} metalness={0.5} emissive={stateColor} emissiveIntensity={selected ? 0.16 : 0.035} />
          </mesh>
        </>
      ) : def.role === 'conveyor' || def.role === 'storage' ? (
        <EquipmentModel type={obj.type} color={def.color} accent={def.accent} height={def.height} active={active} runtime={runtime} conveyorCorner={Boolean(conveyorLinks?.corner)} />
      ) : (
        <EquipmentModel type={obj.type} color={def.color} accent={def.accent} height={def.height} active={active} runtime={runtime} conveyorCorner={Boolean(conveyorLinks?.corner)} />
      )}

      {/* 机器进度条（加工/收料/出料阶段） */}
      {runtime && runtime.progress > 0 && runtime.progress < 1 && (
        <mesh position={[0, 1.3, 0]}>
          <planeGeometry args={[fp.w * runtime.progress, 0.06]} />
          <meshBasicMaterial color="#4fc3f7" />
        </mesh>
      )}

      {/* 传送带方向指示箭头 */}
      {def.role === 'conveyor' && (
        <>
          {conveyorLinks?.corner
            ? <ConveyorCornerArrow height={Math.max(def.height, 0.52)} />
            : <ConveyorArrow height={Math.max(def.height, 0.52)} />}
          {!conveyorLinks?.corner && <ConveyorMotion active={active} height={Math.max(def.height, 0.52)} />}
        </>
      )}

      <PortMarkers
        type={obj.type}
        footprint={fp}
        input={def.inputPort}
        output={def.outputPort}
        hideInput={Boolean(conveyorLinks?.inputConnected)}
        hideOutput={Boolean(conveyorLinks?.outputConnected)}
      />

      {/* 选中描边（按足迹高度） */}
      {selected && (
        <lineSegments position={[0, def.height / 2, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(fp.w, def.height, fp.d)]} />
          <lineBasicMaterial color="#4fc3f7" linewidth={1} />
        </lineSegments>
      )}
    </group>
  )
}

function getConveyorLinks(obj: FactoryObject, objects: FactoryObject[]) {
  const ownCells = occupiedCells(obj)
  const sharesCell = (cells: { x: number; z: number }[], target: { x: number; z: number }[]) => cells.some((a) => target.some((b) => a.x === b.x && a.z === b.z))
  const incoming = objects.find((other) => other.id !== obj.id && sharesCell(objectPortCells(other, 'output'), ownCells))
  const outgoing = objects.find((other) => other.id !== obj.id && sharesCell(objectPortCells(obj, 'output'), occupiedCells(other)))
  const incomingConveyor = objects.find((other) => other.id !== obj.id && other.type === 'conveyor' && sharesCell(objectPortCells(other, 'output'), ownCells))
  const outgoingConveyor = objects.find((other) => other.id !== obj.id && other.type === 'conveyor' && sharesCell(objectPortCells(obj, 'output'), occupiedCells(other)))
  const directionBetween = (from: FactoryObject, to: FactoryObject) => ({
    dx: Math.sign(to.pos.x - from.pos.x),
    dz: Math.sign(to.pos.z - from.pos.z),
  })
  const incomingDir = incomingConveyor ? directionBetween(obj, incomingConveyor) : null
  const outgoingDir = outgoingConveyor ? directionBetween(obj, outgoingConveyor) : null
  const corner = Boolean(
    incomingDir && outgoingDir &&
    incomingDir.dx * outgoingDir.dx + incomingDir.dz * outgoingDir.dz === 0,
  )
  return {
    inputConnected: Boolean(incoming),
    outputConnected: Boolean(outgoing),
    corner,
  }
}

function PortMarkers({ type, footprint, input, output, hideInput = false, hideOutput = false }: { type: FactoryObject['type']; footprint: { w: number; d: number }; input: PortSide | null; output: PortSide | null; hideInput?: boolean; hideOutput?: boolean }) {
  // Conveyors communicate direction through the belt arrow. Rendering a full
  // input/output marker pair on every 1x1 segment creates floating dots at
  // every joint, especially where a route turns.
  if (type === 'conveyor') return null
  const inputSides: PortSide[] = type === 'merger' ? ['back', 'left', 'right'] : input ? [input] : []
  const outputSides: PortSide[] = type === 'splitter' ? ['front', 'left', 'right'] : output ? [output] : []
  return <>{inputSides.filter(() => !hideInput).map((side) => <PortMarker key={`input-${side}`} kind="input" side={side} footprint={footprint} color="#4d9bb1" />)}{outputSides.filter(() => !hideOutput).map((side) => <PortMarker key={`output-${side}`} kind="output" side={side} footprint={footprint} color="#e6ad26" />)}</>
}

function PortMarker({ kind, side, footprint, color }: { kind: 'input' | 'output'; side: PortSide; footprint: { w: number; d: number }; color: string }) {
  const sideData: Record<PortSide, { x: number; z: number; dx: number; dz: number }> = {
    front: { x: footprint.w / 2 + 0.08, z: 0, dx: 1, dz: 0 },
    back: { x: -footprint.w / 2 - 0.08, z: 0, dx: -1, dz: 0 },
    left: { x: 0, z: footprint.d / 2 + 0.08, dx: 0, dz: 1 },
    right: { x: 0, z: -footprint.d / 2 - 0.08, dx: 0, dz: -1 },
  }
  const edge = sideData[side]
  const arrow = kind === 'output' ? edge : { dx: -edge.dx, dz: -edge.dz }
  return (
    <group position={[edge.x, 0.28, edge.z]}>
      <mesh>
        <cylinderGeometry args={[0.075, 0.075, 0.025, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[arrow.dx * 0.07, 0, arrow.dz * 0.07]} rotation={arrowRotation(arrow.dx, arrow.dz)}>
        <coneGeometry args={[0.05, 0.12, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

function arrowRotation(dx: number, dz: number): [number, number, number] {
  if (dx === 1) return [0, 0, -Math.PI / 2]
  if (dx === -1) return [0, 0, Math.PI / 2]
  if (dz === 1) return [Math.PI / 2, 0, 0]
  return [-Math.PI / 2, 0, 0]
}

function ConveyorMotion({ active, height }: { active: boolean; height: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const phase = (clock.getElapsedTime() * (active ? 1.6 : 0.45)) % 1
    ref.current.position.x = phase - 0.5
    ref.current.scale.x = active ? 1 : 0.65
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = active ? 0.7 : 0.18
  })
  return (
    <mesh ref={ref} position={[-0.5, height + 0.015, 0]}>
      <boxGeometry args={[0.16, 0.018, 0.42]} />
      <meshBasicMaterial color="#f0c24b" transparent opacity={active ? 0.7 : 0.18} />
    </mesh>
  )
}

/** 传送带方向指示（小三角箭头） */
function ConveyorArrow({ height }: { height: number }) {
  // FactoryObjectMesh already rotates the whole conveyor to its flow
  // direction. Keep the arrow in local +X so vertical segments are not
  // rotated a second time into a reversed left-pointing arrow.
  return (
    <group position={[0, height + 0.035, 0]}>
      <mesh position={[0.1, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.11, 0.26, 8]} />
        <meshBasicMaterial color="#8be28a" />
      </mesh>
      <mesh position={[-0.1, 0, 0]}>
        <boxGeometry args={[0.24, 0.028, 0.028]} />
        <meshBasicMaterial color="#8be28a" />
      </mesh>
    </group>
  )
}

function ConveyorCornerArrow({ height }: { height: number }) {
  const arrowShape = useMemo(() => {
    const shape = new THREE.Shape()
    const points: Array<[number, number]> = []
    const centre = { x: 0.48, z: -0.48 }
    const appendArc = (radius: number, reverse = false) => {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        const angle = reverse ? Math.PI / 2 + t * Math.PI / 2 : Math.PI - t * Math.PI / 2
        const x = centre.x + Math.cos(angle) * radius
        const z = centre.z + Math.sin(angle) * radius
        points.push([x, -z])
      }
    }
    appendArc(0.31)
    appendArc(0.24, true)
    shape.moveTo(points[0][0], points[0][1])
    points.slice(1).forEach(([x, y]) => shape.lineTo(x, y))
    shape.closePath()
    return shape
  }, [])

  return (
    <group position={[0, height + 0.045, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[arrowShape]} />
        <meshBasicMaterial color="#8be28a" transparent opacity={0.92} />
      </mesh>
      <mesh position={[0.35, 0, -0.02]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.075, 0.17, 8]} />
        <meshBasicMaterial color="#8be28a" />
      </mesh>
    </group>
  )
}

/** 机器状态 → 颜色 */
function machineStateColor(runtime?: MachineRuntime): string {
  if (!runtime) return '#4fc3f7'
  switch (runtime.state) {
    case 'idle':
      return '#4fc3f7'
    case 'loading':
      return '#fbc02d'
    case 'processing':
      return '#29b6f6'
    case 'output':
      return '#66bb6a'
    default:
      return '#4fc3f7'
  }
}
