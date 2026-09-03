import * as THREE from 'three'
import { getObjectDef } from '../game/types'
import { dirToRotation } from '../game/dir'
import { objectToWorld, rotatedFootprint } from '../game/grid'
import { useForgeMindStore, type Ghost } from '../store/forgeMind'
import { EquipmentModel } from './EquipmentModel'
import { PortMarkers } from './FactoryObjectMesh'
import type { GridPos, Rotation } from '../game/types'
import { buildingVisualScaleForType, CONVEYOR_VISUAL_SURFACE_Y_M, CONVEYOR_VISUAL_WIDTH_M } from './industrialVisualScale'
import { isInclineConveyorType } from '../game/inclineConveyor'
import { InclineConveyorPreview } from './InclineConveyorMesh'

export function GhostPreview({ ghost }: { ghost: Ghost }) {
  const ghostPath = useForgeMindStore((state) => state.ghostPath)
  const ghostPathValid = useForgeMindStore((state) => state.ghostPathValid)
  if (!ghost.pos) return null
  if (isInclineConveyorType(ghost.type)) {
    return <InclineConveyorPreview type={ghost.type} lowPos={ghost.pos} rotation={ghost.rotation} lowerFloorId={ghost.floorId ?? 1} valid={ghost.valid} />
  }
  if (ghost.type === 'conveyor' && ghostPath.length > 0) {
    return <group>{ghostPath.map((pos, index) => <ConveyorGhost key={`${pos.x}:${pos.z}`} pos={pos} rotation={pathRotation(ghostPath, index, ghost.rotation)} valid={ghostPathValid[index] ?? ghost.valid} index={index} />)}</group>
  }

  const def = getObjectDef(ghost.type, ghost.resourceId)
  const fp = rotatedFootprint(def.footprint, ghost.rotation)
  const { x, z } = objectToWorld({ type: ghost.type, resourceId: ghost.resourceId, pos: ghost.pos, rotation: ghost.rotation })
  const color = ghost.valid ? '#66bb6a' : '#ef5350'
  const visualScale = buildingVisualScaleForType(ghost.type)
  const previewObject = {
    id: '__ghost-preview__',
    type: ghost.type,
    resourceId: ghost.resourceId,
    pos: ghost.pos,
    rotation: ghost.rotation,
    floorId: ghost.floorId,
  }

  return <group position={[x, 0, z]} rotation={[0, rotationAngle(ghost.rotation), 0]}>
    {/* 建造预览直接复用已放置对象的真实模型，让模型本身承担朝向提示。 */}
    <EquipmentModel type={ghost.type} resourceId={ghost.resourceId} color={def.color} accent={def.accent} height={def.height} castShadows={false} />
    <PreviewOrientationMarker footprint={fp} color={def.accent} />
    <PortMarkers obj={previewObject} input={def.inputPort} output={def.outputPort} />
    <lineSegments position={[0, def.height * visualScale / 2, 0]}><edgesGeometry args={[new THREE.BoxGeometry(fp.w * visualScale, def.height * visualScale, fp.d * visualScale)]} /><lineBasicMaterial color={color} /></lineSegments>
  </group>
}

function ConveyorGhost({ pos, rotation, valid }: { pos: GridPos; rotation: Rotation; valid: boolean; index: number }) {
  const { x, z } = objectToWorld({ type: 'conveyor', pos, rotation })
  const color = valid ? '#e4b52b' : '#ef5350'
  return <group position={[x, 0, z]} rotation={[0, rotationAngle(rotation), 0]}>
    <EquipmentModel type="conveyor" color="#5b9b99" accent={color} height={0.35} castShadows={false} />
    <mesh position={[0, CONVEYOR_VISUAL_SURFACE_Y_M, 0]}>
      <boxGeometry args={[0.86, 0.035, CONVEYOR_VISUAL_WIDTH_M]} />
      <meshStandardMaterial color={color} transparent opacity={0.22} emissive={color} emissiveIntensity={0.35} />
    </mesh>
    <lineSegments position={[0, CONVEYOR_VISUAL_SURFACE_Y_M / 2, 0]}><edgesGeometry args={[new THREE.BoxGeometry(0.96, CONVEYOR_VISUAL_SURFACE_Y_M, CONVEYOR_VISUAL_WIDTH_M)]} /><lineBasicMaterial color={color} transparent opacity={0.9} /></lineSegments>
  </group>
}

/** A small front-facing cue remains visible even on buildings without ports. */
function PreviewOrientationMarker({ footprint, color }: { footprint: { w: number; d: number }; color: string }) {
  return <group position={[footprint.w / 2 + 0.24, 0.09, 0]}>
    <mesh rotation={[0, 0, -Math.PI / 2]}>
      <coneGeometry args={[0.12, 0.28, 4]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
    <mesh position={[-0.15, 0, 0]}>
      <boxGeometry args={[0.3, 0.025, 0.035]} />
      <meshBasicMaterial color={color} transparent opacity={0.68} />
    </mesh>
  </group>
}

function pathRotation(path: GridPos[], index: number, fallback: Rotation): Rotation {
  const current = path[index]
  const next = path[index + 1] ?? path[index - 1]
  if (!current || !next) return fallback
  const forward = index < path.length - 1
  return dirToRotation({ dx: forward ? next.x - current.x : current.x - next.x, dz: forward ? next.z - current.z : current.z - next.z })
}

function rotationAngle(rotation: Rotation) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}
