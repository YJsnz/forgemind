import * as THREE from 'three'
import { getObjectDef } from '../game/types'
import { dirToRotation } from '../game/dir'
import { objectToWorld, rotatedFootprint } from '../game/grid'
import { useForgeMindStore, type Ghost } from '../store/forgeMind'
import { EquipmentModel } from './EquipmentModel'
import type { GridPos, Rotation } from '../game/types'

export function GhostPreview({ ghost }: { ghost: Ghost }) {
  const ghostPath = useForgeMindStore((state) => state.ghostPath)
  const ghostPathValid = useForgeMindStore((state) => state.ghostPathValid)
  if (!ghost.pos) return null
  if (ghost.type === 'conveyor' && ghostPath.length > 0) {
    return <group>{ghostPath.map((pos, index) => <ConveyorGhost key={`${pos.x}:${pos.z}`} pos={pos} rotation={pathRotation(ghostPath, index, ghost.rotation)} valid={ghostPathValid[index] ?? ghost.valid} index={index} />)}</group>
  }

  const def = getObjectDef(ghost.type, ghost.resourceId)
  const fp = rotatedFootprint(def.footprint, ghost.rotation)
  const { x, z } = objectToWorld({ type: ghost.type, resourceId: ghost.resourceId, pos: ghost.pos, rotation: ghost.rotation })
  const color = ghost.valid ? '#66bb6a' : '#ef5350'
  const hasSplitAsset = Boolean(def.assetPath)

  return <group position={[x, 0, z]} rotation={[0, rotationAngle(ghost.rotation), 0]}>
    {hasSplitAsset ? <EquipmentModel type={ghost.type} resourceId={ghost.resourceId} color={def.color} accent={def.accent} height={def.height} /> : <PreviewVolume footprint={fp} height={def.height} color={color} />}
    <lineSegments><edgesGeometry args={[new THREE.BoxGeometry(fp.w, def.height, fp.d)]} /><lineBasicMaterial color={color} /></lineSegments>
  </group>
}

function ConveyorGhost({ pos, rotation, valid, index }: { pos: GridPos; rotation: Rotation; valid: boolean; index: number }) {
  const { x, z } = objectToWorld({ type: 'conveyor', pos, rotation })
  const color = valid ? '#e4b52b' : '#ef5350'
  return <group position={[x, 0, z]} rotation={[0, rotationAngle(rotation), 0]}>
    <mesh position={[0, 0.19, 0]}>
      <boxGeometry args={[0.86, 0.035, 0.86]} />
      <meshStandardMaterial color={color} transparent opacity={0.22} emissive={color} emissiveIntensity={0.35} />
    </mesh>
    <lineSegments position={[0, 0.22, 0]}><edgesGeometry args={[new THREE.BoxGeometry(0.96, 0.1, 0.96)]} /><lineBasicMaterial color={color} transparent opacity={0.9} /></lineSegments>
    <mesh position={[0.08 + ((index % 2) * 0.08), 0.235, 0]} rotation={[0, 0, -Math.PI / 2]}>
      <coneGeometry args={[0.055, 0.13, 8]} />
      <meshBasicMaterial color={color} />
    </mesh>
  </group>
}

function PreviewVolume({ footprint, height, color }: { footprint: { w: number; d: number }; height: number; color: string }) {
  return <mesh position={[0, height / 2, 0]}><boxGeometry args={[footprint.w, height, footprint.d]} /><meshStandardMaterial color={color} transparent opacity={0.42} roughness={0.3} metalness={0.3} /></mesh>
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
