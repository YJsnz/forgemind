import { Suspense, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PandaArmModel } from './PandaArmModel'
import { FormalConveyorSegment } from './FormalConveyorSegment'
import type { SourceRuntimeSnapshot } from '../game/simulation'

interface IncomingStationModelProps {
  color: string
  accent: string
  active?: boolean
  runtime?: SourceRuntimeSnapshot
}

/**
 * Incoming material is a compound station rather than a resource node:
 * the vehicle unloads on the left, the arm picks from that stack, and the
 * short roller belt carries the pallet out through the source output port.
 */
export function IncomingStationModel({ color, accent, active = false, runtime }: IncomingStationModelProps) {
  const transferring = runtime?.state === 'picking' || runtime?.state === 'placing'
  const blocked = runtime?.state === 'blocked'

  return (
    <group>
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.85, 0.16, 1.9]} />
        <meshStandardMaterial color="#566761" roughness={0.68} metalness={0.42} />
      </mesh>
      <mesh position={[0, 0.175, 0]} receiveShadow>
        <boxGeometry args={[2.62, 0.025, 1.66]} />
        <meshStandardMaterial color="#b9c4be" roughness={0.52} metalness={0.34} />
      </mesh>

      {/* The station exposes the near central lane of its 3x2 footprint. */}
      <group position={[0.92, 0.17, -0.5]}>
        <Suspense fallback={<FormalConveyorFallback color={color} accent={accent} />}>
          <FormalConveyorSegment targetFootprint={1.05} targetHeight={0.52} />
        </Suspense>
        <ConveyorSignal active={active && transferring} accent={accent} />
      </group>

      <MaterialStack />

      <group position={[-0.25, 0.18, -0.05]} scale={1.05}>
        <PandaArmModel behavior="infeed" active={active} progress={runtime?.progress ?? 0} />
      </group>

      <mesh position={[-0.25, 0.205, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.39, 24]} />
        <meshBasicMaterial color={active ? accent : '#80918b'} transparent opacity={active ? 0.72 : 0.24} />
      </mesh>

      <mesh position={[1.48, 0.27, -0.5]} castShadow>
        <boxGeometry args={[0.1, 0.14, 0.58]} />
        <meshStandardMaterial color="#1a2825" roughness={0.66} metalness={0.42} />
      </mesh>

      <mesh position={[0, 0.39, -0.84]}>
        <boxGeometry args={[1.72, 0.028, 0.035]} />
        <meshBasicMaterial color={blocked ? '#c95b54' : accent} transparent opacity={blocked ? 0.9 : transferring ? 0.84 : 0.28} />
      </mesh>
    </group>
  )
}

function FormalConveyorFallback({ color, accent }: { color: string; accent: string }) {
  return <group>
    <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.05, 0.16, 0.72]} />
      <meshStandardMaterial color="#182522" roughness={0.76} metalness={0.36} />
    </mesh>
    <mesh position={[0, 0.18, 0]} receiveShadow>
      <boxGeometry args={[0.92, 0.025, 0.52]} />
      <meshStandardMaterial color="#273633" roughness={0.72} metalness={0.2} />
    </mesh>
    {[-0.38, -0.13, 0.13, 0.38].map((x) => <mesh key={x} position={[x, 0.22, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.055, 0.055, 0.58, 12]} />
      <meshStandardMaterial color="#a6b0aa" roughness={0.42} metalness={0.78} />
    </mesh>)}
    <mesh position={[0.32, 0.25, 0]}>
      <boxGeometry args={[0.14, 0.018, 0.42]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.28} />
    </mesh>
    <mesh position={[0.5, 0.25, 0]} rotation={[0, 0, -Math.PI / 2]}>
      <coneGeometry args={[0.08, 0.16, 4]} />
      <meshBasicMaterial color={accent} />
    </mesh>
    <mesh position={[0, 0.26, 0]}>
      <boxGeometry args={[0.9, 0.012, 0.022]} />
      <meshBasicMaterial color={color} transparent opacity={0.28} />
    </mesh>
  </group>
}

function ConveyorSignal({ active, accent }: { active: boolean; accent: string }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const phase = (clock.getElapsedTime() * (active ? 1.8 : 0.3)) % 1
    ref.current.position.x = -0.42 + phase * 0.84
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = active ? 0.82 : 0.16
  })
  return <mesh ref={ref} position={[-0.42, 0.56, 0]}>
    <boxGeometry args={[0.16, 0.018, 0.22]} />
    <meshBasicMaterial color={accent} transparent opacity={active ? 0.8 : 0.18} />
  </mesh>
}

function MaterialStack() {
  return (
    <group position={[-0.98, 0.21, 0.48]}>
      <Crate position={[0, 0, 0]} color="#a87845" />
      <Crate position={[0.27, 0, -0.04]} color="#b7844c" />
      <Crate position={[0.12, 0.26, -0.02]} color="#c39356" />
      <mesh position={[0.06, 0.42, 0.02]}>
        <boxGeometry args={[0.48, 0.025, 0.58]} />
        <meshStandardMaterial color="#e1b24b" emissive="#e1b24b" emissiveIntensity={0.12} />
      </mesh>
    </group>
  )
}

function Crate({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={[0.42, 0.24, 0.42]} />
      <meshStandardMaterial color={color} roughness={0.82} metalness={0.08} />
    </mesh>
  )
}
