import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { PandaArmModel } from './PandaArmModel'
import { IncomingStationModel } from './IncomingStationModel'
import type { BuildType } from '../game/types'
import type { MachineRuntime, SourceRuntimeSnapshot } from '../game/simulation'

interface EquipmentModelProps {
  type: BuildType
  color: string
  accent: string
  height: number
  active?: boolean
  runtime?: MachineRuntime
  sourceRuntime?: SourceRuntimeSnapshot
  conveyorCorner?: boolean
  conveyorCornerInput?: 'left' | 'right'
}

export function EquipmentModel({ type, color, accent, height, active = false, runtime, sourceRuntime, conveyorCorner = false, conveyorCornerInput = 'left' }: EquipmentModelProps) {
  switch (type) {
    case 'machine':
      return <Suspense fallback={<SolidUnit color={color} height={height} />}><ImportedModel path="/models/industrial/realvirtual_high_detail.glb" targetFootprint={1.3} targetHeight={height} /></Suspense>
    case 'oreMiner':
      return <RawRack color={color} accent={accent} />
    case 'source':
      return <IncomingStationModel color={color} accent={accent} active={active} runtime={sourceRuntime} />
    case 'smelter':
      return <Suspense fallback={<CncCell color={color} accent={accent} />}><ImportedModel path="/models/industrial/cnc_machining_center.glb" targetFootprint={2.8} targetHeight={height} /></Suspense>
    case 'press':
      return <Suspense fallback={<Press color={color} accent={accent} runtime={runtime} />}><DetailedAsset path="/models/industrial/hydraulic_press_detail.glb" targetFootprint={1.72} targetHeight={height} accent={accent} active={runtime?.state === 'processing' || runtime?.state === 'loading'} kind="press" /></Suspense>
    case 'assembler':
      return <ImportedAssemblyCell targetFootprint={2.6} targetHeight={height} active={runtime?.state === 'loading' || runtime?.state === 'processing' || runtime?.state === 'output'} />
    case 'inspection':
      return <Suspense fallback={<InspectionCell color={color} accent={accent} />}><ImportedInspectionCell color={color} accent={accent} targetFootprint={1.8} targetHeight={height} /></Suspense>
    case 'washing':
      return <Suspense fallback={<WashCell color={color} accent={accent} runtime={runtime} />}><DetailedAsset path="/models/industrial/wash_deburr_detail.glb" targetFootprint={1.7} targetHeight={height} accent={accent} active={runtime?.state === 'processing' || runtime?.state === 'loading'} kind="wash" /></Suspense>
    case 'agv':
      return <Suspense fallback={<SolidUnit color={color} height={height} />}><ImportedModel path="/models/forklift_agv.glb" targetFootprint={1.7} targetHeight={height} /></Suspense>
    case 'storage':
      return <Suspense fallback={<Storage color={color} accent={accent} />}><DetailedAsset path="/models/industrial/pallet_buffer_detail.glb" targetFootprint={1.7} targetHeight={height} accent={accent} active={active} kind="storage" /></Suspense>
    case 'splitter':
      return <Suspense fallback={<FlowNode color={color} accent={accent} branches={3} scale={0.64} active={active} />}><DetailedAsset path="/models/industrial/flow_node_detail.glb" targetFootprint={1.02} targetHeight={0.8} accent={accent} active={active} kind="flow" /></Suspense>
    case 'merger':
      return <Suspense fallback={<FlowNode color={color} accent={accent} branches={3} merger scale={0.64} active={active} />}><DetailedAsset path="/models/industrial/flow_node_detail.glb" targetFootprint={1.02} targetHeight={0.8} accent={accent} active={active} kind="flow" /></Suspense>
    case 'conveyor':
      return conveyorCorner
        ? <ConveyorCorner accent={accent} height={Math.max(height, 0.52)} inputSide={conveyorCornerInput} />
        : <Suspense fallback={<Belt color={color} accent={accent} active={active} />}><ImportedModel path="/models/industrial/roller_conveyor_segment.glb" targetFootprint={1.05} targetHeight={Math.max(height, 0.52)} rotationOffsetY={Math.PI / 2} stripDirectionTexture /></Suspense>
    default:
      return <Belt color={color} accent={accent} />
  }
}

function Metal({ color, roughness = 0.5, metalness = 0.72 }: { color: string; roughness?: number; metalness?: number }) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
}

function SolidUnit({ color, height }: { color: string; height: number }) {
  return <group position={[0, height / 2, 0]}><mesh castShadow receiveShadow><boxGeometry args={[1, height, 1]} /><Metal color={color} /></mesh></group>
}

function Base({ children, width = 1.6, depth = 1.6 }: { children: React.ReactNode; width?: number; depth?: number }) {
  return <group>
    <mesh position={[0, 0.06, 0]} castShadow receiveShadow><boxGeometry args={[width, 0.12, depth]} /><Metal color="#5f706b" roughness={0.72} metalness={0.38} /></mesh>
    <mesh position={[0, 0.135, 0]} receiveShadow><boxGeometry args={[Math.max(width - 0.12, 0.2), 0.035, Math.max(depth - 0.12, 0.2)]} /><Metal color="#a1ada7" roughness={0.54} metalness={0.42} /></mesh>
    {[-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * (width / 2 - 0.16), 0.19, z * (depth / 2 - 0.16)]} castShadow><cylinderGeometry args={[0.055, 0.055, 0.06, 12]} /><Metal color="#d2dad4" /></mesh>))}
    {children}
  </group>
}

function ControlCabinet({ position, accent }: { position: [number, number, number]; accent: string }) {
  return <group position={position}>
    <mesh castShadow><boxGeometry args={[0.28, 0.62, 0.2]} /><Metal color="#2d3735" /></mesh>
    <mesh position={[0, 0.12, 0.105]}><planeGeometry args={[0.16, 0.14]} /><meshStandardMaterial color="#162423" emissive={accent} emissiveIntensity={0.32} /></mesh>
    <mesh position={[0, -0.1, 0.108]}><cylinderGeometry args={[0.035, 0.035, 0.025, 12]} /><meshStandardMaterial color="#d34c3f" emissive="#d34c3f" emissiveIntensity={0.18} /></mesh>
    <mesh position={[0, 0.33, 0]}><cylinderGeometry args={[0.025, 0.025, 0.18, 10]} /><Metal color="#7f8b85" /></mesh>
  </group>
}

function RawRack({ color, accent }: { color: string; accent: string }) {
  return <Base width={1.8} depth={1.8}>
    <group position={[0, 0.1, 0]}>
      {[-0.7, 0.7].map((x) => [-0.63, 0.63].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.88, z]} castShadow><boxGeometry args={[0.08, 1.55, 0.08]} /><Metal color="#6e7b76" /></mesh>))}
      {[0.28, 0.92, 1.56].map((y) => <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[1.48, 0.08, 1.36]} /><Metal color={color} /></mesh>)}
      <mesh position={[0, 0.42, 0.08]}><boxGeometry args={[1.16, 0.3, 0.85]} /><meshStandardMaterial color="#b08b55" roughness={0.75} /></mesh>
      <mesh position={[0, 1.08, -0.06]}><boxGeometry args={[1.1, 0.26, 0.78]} /><meshStandardMaterial color="#9b6f45" roughness={0.75} /></mesh>
      <mesh position={[0, 1.76, 0]}><boxGeometry args={[1.16, 0.04, 1.32]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.12} /></mesh>
    </group>
  </Base>
}

function CncCell({ color, accent }: { color: string; accent: string }) {
  return <Base width={1.75} depth={1.75}>
    <group position={[0, 0.18, 0]}>
      <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[1.38, 1.2, 1.3]} /><Metal color={color} /></mesh>
      <mesh position={[0, 0.72, 0.67]}><planeGeometry args={[0.68, 0.55]} /><meshStandardMaterial color="#1e302f" roughness={0.2} metalness={0.35} /></mesh>
      <mesh position={[0, 0.72, 0.685]}><boxGeometry args={[0.58, 0.04, 0.02]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.3} /></mesh>
      <mesh position={[0, 1.38, 0]} castShadow><boxGeometry args={[0.72, 0.16, 0.7]} /><Metal color="#3a4543" /></mesh>
      <mesh position={[0, 1.5, 0]} castShadow><cylinderGeometry args={[0.11, 0.14, 0.28, 12]} /><Metal color="#a1aca7" /></mesh>
      <mesh position={[0.66, 0.66, 0.08]}><boxGeometry args={[0.08, 0.78, 0.7]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.14} /></mesh>
      <mesh position={[0.71, 0.79, 0.08]}><boxGeometry args={[0.02, 0.14, 0.3]} /><meshStandardMaterial color="#d9ded9" /></mesh>
      <ControlCabinet position={[0.95, 0.55, 0.28]} accent={accent} />
    </group>
  </Base>
}

function Press({ color, accent, runtime }: { color: string; accent: string; runtime?: MachineRuntime }) {
  const ramRef = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ramRef.current) return
    const working = runtime?.state === 'processing' || runtime?.state === 'loading'
    const pulse = working ? 0.08 * (0.5 + 0.5 * Math.sin(clock.getElapsedTime() * 8)) : 0
    ramRef.current.position.y = pulse
  })
  return <Base width={1.8} depth={1.75}>
    <group position={[0, 0.15, 0]}>
      {[-0.55, 0.55].map((x) => <mesh key={x} position={[x, 0.78, 0]} castShadow><cylinderGeometry args={[0.08, 0.08, 1.35, 10]} /><Metal color="#9ba7a1" /></mesh>)}
      <group ref={ramRef}>
        <mesh position={[0, 1.38, 0]} castShadow><boxGeometry args={[1.45, 0.25, 1.2]} /><Metal color={color} /></mesh>
        <mesh position={[0, 1.51, 0]}><boxGeometry args={[1.18, 0.025, 0.92]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.18} /></mesh>
        <mesh position={[0, 0.95, 0]} castShadow><boxGeometry args={[0.95, 0.14, 0.72]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.12} /></mesh>
      </group>
      <mesh position={[0, 0.38, 0]}><boxGeometry args={[0.55, 0.08, 0.5]} /><Metal color="#2a3432" /></mesh>
      <mesh position={[0, 0.56, 0.44]}><cylinderGeometry args={[0.18, 0.18, 0.26, 16]} /><Metal color="#b4bfba" /></mesh>
      <mesh position={[0.72, 0.55, -0.3]}><boxGeometry args={[0.16, 0.7, 0.42]} /><Metal color="#3b4744" /></mesh>
      <mesh position={[0.74, 0.92, -0.085]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.09, 0.018, 8, 20]} /><Metal color="#d9e0dc" /></mesh>
      <mesh position={[0.74, 0.92, -0.11]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.014, 0.014, 0.025, 10]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.3} /></mesh>
      <ControlCabinet position={[0.82, 0.56, 0.34]} accent={accent} />
    </group>
  </Base>
}

function InspectionCell({ color, accent }: { color: string; accent: string }) {
  return <Base width={1.75} depth={1.75}>
    <group position={[0, 0.22, 0]}>
      <mesh position={[0, 0.68, 0]} castShadow><boxGeometry args={[1.25, 1.08, 1.1]} /><Metal color={color} /></mesh>
      <mesh position={[0, 1.31, 0]}><boxGeometry args={[0.78, 0.12, 0.62]} /><Metal color="#252e2d" /></mesh>
      <mesh position={[0, 1.22, 0.25]}><cylinderGeometry args={[0.12, 0.12, 0.18, 12]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.28} /></mesh>
      <mesh position={[0, 0.65, 0.58]}><planeGeometry args={[0.65, 0.42]} /><meshStandardMaterial color="#1b2726" emissive={accent} emissiveIntensity={0.2} /></mesh>
      {[-0.42, 0, 0.42].map((x) => <mesh key={x} position={[x, 0.38, 0.42]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.055, 0.055, 0.74, 12]} /><Metal color="#98a49f" /></mesh>)}
      <ControlCabinet position={[0.72, 0.58, 0.22]} accent={accent} />
    </group>
  </Base>
}

function WashCell({ color, accent, runtime }: { color: string; accent: string; runtime?: MachineRuntime }) {
  const brushRef = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (!brushRef.current) return
    const working = runtime?.state === 'processing' || runtime?.state === 'loading'
    brushRef.current.rotation.y += delta * (working ? 5 : 0.25)
  })
  return <Base width={1.75} depth={1.75}>
    <group position={[0, 0.2, 0]}>
      <mesh position={[0, 0.62, 0]} castShadow><boxGeometry args={[1.3, 1.0, 1.18]} /><Metal color={color} /></mesh>
      <mesh position={[0, 0.86, 0.61]}><boxGeometry args={[0.92, 0.025, 0.025]} /><meshStandardMaterial color="#6faeb0" emissive="#6faeb0" emissiveIntensity={0.22} /></mesh>
      <group ref={brushRef}>
        <mesh position={[-0.48, 1.18, 0]}><cylinderGeometry args={[0.22, 0.25, 0.42, 12]} /><Metal color="#2e3b38" /></mesh>
        <mesh position={[0.48, 1.18, 0]}><cylinderGeometry args={[0.22, 0.25, 0.42, 12]} /><Metal color="#2e3b38" /></mesh>
      </group>
      <mesh position={[0, 0.66, 0.61]}><planeGeometry args={[0.72, 0.42]} /><meshStandardMaterial color="#1a2927" emissive={accent} emissiveIntensity={0.16} /></mesh>
      <mesh position={[-0.62, 0.76, 0.48]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.12, 0.035, 8, 16]} /><Metal color="#aab5ae" /></mesh>
      <mesh position={[0.62, 0.76, 0.48]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.12, 0.035, 8, 16]} /><Metal color="#aab5ae" /></mesh>
      {[-0.28, 0, 0.28].map((x) => <mesh key={x} position={[x, 1.14, 0.3]}><cylinderGeometry args={[0.035, 0.035, 0.16, 12]} /><meshStandardMaterial color="#6faeb0" emissive="#6faeb0" emissiveIntensity={0.28} /></mesh>)}
      <ControlCabinet position={[0.72, 0.55, -0.2]} accent={accent} />
    </group>
  </Base>
}

function Storage({ color, accent }: { color: string; accent: string }) {
  return <Base width={1.75} depth={1.75}>
    <group position={[0, 0.18, 0]}>
      {[-0.68, 0.68].flatMap((x) => [-0.58, 0.58].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.82, z]} castShadow><boxGeometry args={[0.07, 1.52, 0.07]} /><Metal color="#9da9a3" /></mesh>))}
      {[0.28, 0.78, 1.28].map((y) => <group key={y}>
        <mesh position={[0, y, 0]} castShadow><boxGeometry args={[1.5, 0.07, 1.24]} /><Metal color={color} /></mesh>
        {[-0.47, 0.47].map((x) => <mesh key={x} position={[x, y + 0.065, 0]}><boxGeometry args={[0.045, 0.025, 1.18]} /><Metal color="#d1d9d3" /></mesh>)}
      </group>)}
      {[0.47, 0.97].map((y) => <group key={y}>
        <mesh position={[-0.34, y, -0.12]} castShadow><boxGeometry args={[0.52, 0.3, 0.62]} /><meshStandardMaterial color="#b7864f" roughness={0.78} /></mesh>
        <mesh position={[0.34, y, -0.12]} castShadow><boxGeometry args={[0.52, 0.3, 0.62]} /><meshStandardMaterial color="#a87342" roughness={0.78} /></mesh>
        <mesh position={[0, y + 0.16, -0.12]}><boxGeometry args={[1.08, 0.025, 0.66]} /><meshStandardMaterial color="#e1b152" emissive="#e1b152" emissiveIntensity={0.08} /></mesh>
      </group>)}
      {[-0.5, 0.5].map((x) => <mesh key={x} position={[x, 0.82, -0.61]} rotation={[0, 0, x < 0 ? -0.34 : 0.34]}><boxGeometry args={[0.035, 1.22, 0.035]} /><Metal color="#d1d9d3" /></mesh>)}
      <mesh position={[0, 1.56, 0]}><boxGeometry args={[1.48, 0.08, 1.3]} /><Metal color="#6d7a75" /></mesh>
      <mesh position={[0, 1.61, 0.67]}><boxGeometry args={[0.84, 0.035, 0.025]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.65} /></mesh>
      <mesh position={[0.73, 0.94, 0.64]}><boxGeometry args={[0.04, 0.72, 0.04]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.24} /></mesh>
    </group>
  </Base>
}

function FlowNode({ color, accent, branches, merger = false, scale = 1, active = false }: { color: string; accent: string; branches: number; merger?: boolean; scale?: number; active?: boolean }) {
  const pulseRef = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!pulseRef.current) return
    const pulse = active ? 1 + Math.sin(clock.getElapsedTime() * 6) * 0.12 : 1
    pulseRef.current.scale.set(pulse, 1, pulse)
  })
  const arms = merger ? [[-0.55, 0, 0], [0, 0, -0.55], [0.55, 0, 0]] : [[0.55, 0, 0], [0, 0, -0.55], [0, 0, 0.55]]
  return <group scale={scale}>
    <Base width={1.75} depth={1.75}>
      <group position={[0, 0.25, 0]}>
        <mesh ref={pulseRef} castShadow><cylinderGeometry args={[0.45, 0.5, 0.42, 8]} /><Metal color={color} /></mesh>
        {arms.slice(0, branches).map(([x, y, z], index) => <group key={index} position={[x, y, z]} rotation={[0, index === 1 ? Math.PI / 2 : 0, 0]}><mesh position={[x === 0 ? 0 : -x / 2, 0, z === 0 ? 0 : -z / 2]}><boxGeometry args={[x === 0 ? 0.12 : Math.abs(x) * 2, 0.12, z === 0 ? 0.12 : Math.abs(z) * 2]} /><Metal color="#273432" /></mesh><mesh position={[0, 0.05, 0]}><boxGeometry args={[0.22, 0.06, 0.22]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.12} /></mesh></group>)}
      </group>
    </Base>
  </group>
}

function Belt({ color, accent, active = false }: { color: string; accent: string; active?: boolean }) {
  const rollerRef = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (rollerRef.current) rollerRef.current.rotation.x += delta * (active ? 4 : 0.2)
  })
  return <Base width={1.1} depth={1.1}>
    <group position={[0, 0.25, 0]}>
      <mesh rotation={[0, 0, 0]}><boxGeometry args={[0.82, 0.1, 0.82]} /><Metal color="#202b29" /></mesh>
      <group ref={rollerRef}>{[-0.3, 0, 0.3].map((z) => <mesh key={z} position={[0, 0.08, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.07, 0.07, 0.86, 12]} /><Metal color="#94a19c" /></mesh>)}</group>
      <mesh position={[0, 0.16, 0]}><boxGeometry args={[0.68, 0.025, 0.72]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0, 0.18, 0]}><boxGeometry args={[0.16, 0.025, 0.16]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.2} /></mesh>
    </group>
  </Base>
}

function ConveyorCorner({ accent, height, inputSide }: { accent: string; height: number; inputSide: 'left' | 'right' }) {
  const beltColor = '#182321'
  const railColor = '#687570'
  const inputZ = inputSide === 'left' ? 1 : -1
  const deckHeight = Math.max(0.25, height * 0.58)

  return <group>
    <mesh position={[0.25, 0.13, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.5, 0.18, 0.42]} />
      <meshStandardMaterial color="#202b29" roughness={0.58} metalness={0.52} />
    </mesh>
    <mesh position={[0, 0.13, inputZ * 0.25]} castShadow receiveShadow>
      <boxGeometry args={[0.42, 0.18, 0.5]} />
      <meshStandardMaterial color="#202b29" roughness={0.58} metalness={0.52} />
    </mesh>
    <mesh position={[0.25, deckHeight, 0]} receiveShadow>
      <boxGeometry args={[0.5, 0.035, 0.36]} />
      <meshStandardMaterial color={beltColor} roughness={0.78} metalness={0.18} />
    </mesh>
    <mesh position={[0, deckHeight, inputZ * 0.25]} receiveShadow>
      <boxGeometry args={[0.36, 0.035, 0.5]} />
      <meshStandardMaterial color={beltColor} roughness={0.78} metalness={0.18} />
    </mesh>
    <mesh position={[0, deckHeight, 0]} receiveShadow>
      <boxGeometry args={[0.36, 0.035, 0.36]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.1} roughness={0.65} metalness={0.22} />
    </mesh>
    <mesh position={[0.25, 0.24, -0.22]}>
      <boxGeometry args={[0.5, 0.09, 0.035]} />
      <meshStandardMaterial color={railColor} roughness={0.48} metalness={0.68} />
    </mesh>
    <mesh position={[-0.22, 0.24, inputZ * 0.25]}>
      <boxGeometry args={[0.035, 0.09, 0.5]} />
      <meshStandardMaterial color={railColor} roughness={0.48} metalness={0.68} />
    </mesh>
  </group>
}

function ImportedAssemblyCell({ targetFootprint, targetHeight, active }: { targetFootprint: number; targetHeight: number; active: boolean }) {
  void targetFootprint
  void targetHeight
  return <group><WorkcellPlinth /><PandaArmModel active={active} /></group>
}

function WorkcellPlinth() {
  return <group>
    <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
      <boxGeometry args={[2.55, 0.16, 2.55]} />
      <meshStandardMaterial color="#73827d" roughness={0.68} metalness={0.35} />
    </mesh>
    <mesh position={[0, 0.17, 0]} receiveShadow>
      <boxGeometry args={[2.25, 0.018, 2.25]} />
      <meshStandardMaterial color="#b6c0bb" roughness={0.5} metalness={0.28} />
    </mesh>
    <mesh position={[0, 0.185, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.62, 0.68, 32]} />
      <meshBasicMaterial color="#e4b52b" transparent opacity={0.75} />
    </mesh>
  </group>
}

function ImportedInspectionCell({ color, accent, targetFootprint, targetHeight }: { color: string; accent: string; targetFootprint: number; targetHeight: number }) {
  return <group>
    <InspectionCell color={color} accent={accent} />
    <group position={[0, 0.04, 0]}>
      <ImportedModel path="/models/industrial/sensor_pack.glb" targetFootprint={targetFootprint * 0.72} targetHeight={targetHeight * 0.66} />
      <group position={[0.62, 0, -0.3]}>
        <ImportedModel path="/models/industrial/control_cabinet.glb" targetFootprint={targetFootprint * 0.26} targetHeight={targetHeight * 0.72} />
      </group>
    </group>
  </group>
}

function ImportedModel({ path, targetFootprint, targetHeight, rotationOffsetY = 0, stripDirectionTexture = false }: { path: string; targetFootprint: number; targetHeight: number; rotationOffsetY?: number; stripDirectionTexture?: boolean }) {
  const gltf = useGLTF(path)
  const normalized = useMemo(() => {
    const scene = gltf.scene.clone(true)
    // Apply the asset correction before measuring its bounds. Rotating the
    // primitive after centering leaves an internal GLB translation orbiting
    // around the cell origin, which makes the belt drift away from its arrow.
    scene.position.set(0, 0, 0)
    scene.rotation.set(0, rotationOffsetY, 0)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const scale = Math.min(targetFootprint / Math.max(size.x, size.z, 0.0001), targetHeight / Math.max(size.y, 0.0001))
    scene.scale.setScalar(scale)
    scene.updateMatrixWorld(true)
    const normalizedBox = new THREE.Box3().setFromObject(scene)
    const center = normalizedBox.getCenter(new THREE.Vector3())
    scene.position.set(-center.x, -normalizedBox.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true
        node.receiveShadow = true
        if (stripDirectionTexture && (node.name.toLowerCase().includes('belt') || (Array.isArray(node.material) ? node.material : [node.material]).some((material) => material?.name?.toLowerCase().includes('conveyorbelt') || material?.name?.toLowerCase().includes('rubber')))) {
          const replaceDirectionTexture = (material: THREE.Material) => {
            const next = material.clone() as THREE.MeshStandardMaterial
            next.map = null
            next.color.set('#172321')
            next.needsUpdate = true
            return next
          }
          node.material = Array.isArray(node.material)
            ? node.material.map(replaceDirectionTexture)
            : replaceDirectionTexture(node.material)
        }
      }
    })
    return scene
  }, [gltf, rotationOffsetY, stripDirectionTexture, targetFootprint, targetHeight])
  return <primitive object={normalized} />
}

function DetailedAsset({ path, targetFootprint, targetHeight, accent, active, kind }: { path: string; targetFootprint: number; targetHeight: number; accent: string; active: boolean; kind: 'press' | 'wash' | 'storage' | 'flow' }) {
  return <group><ImportedModel path={path} targetFootprint={targetFootprint} targetHeight={targetHeight} /><RuntimeDetailSignal accent={accent} active={active} kind={kind} /></group>
}

function RuntimeDetailSignal({ accent, active, kind }: { accent: string; active: boolean; kind: 'press' | 'wash' | 'storage' | 'flow' }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const pulse = active ? 0.78 + Math.sin(clock.getElapsedTime() * 8) * 0.2 : 0.22
    const material = ref.current.material as THREE.MeshBasicMaterial
    material.opacity = pulse
    ref.current.scale.x = active ? 1 + Math.sin(clock.getElapsedTime() * 5) * 0.08 : 0.72
  })
  if (kind === 'storage') return <mesh ref={ref} position={[0, targetSignalHeight(kind), 0.84]}><boxGeometry args={[0.75, 0.018, 0.018]} /><meshBasicMaterial color={accent} transparent opacity={0.22} /></mesh>
  if (kind === 'flow') return <mesh ref={ref} position={[0, targetSignalHeight(kind), 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.28, 0.31, 24]} /><meshBasicMaterial color={accent} transparent opacity={0.22} /></mesh>
  return <mesh ref={ref} position={[0, targetSignalHeight(kind), 0]}><boxGeometry args={[0.9, 0.018, 0.028]} /><meshBasicMaterial color={accent} transparent opacity={0.22} /></mesh>
}

function targetSignalHeight(kind: 'press' | 'wash' | 'storage' | 'flow') {
  if (kind === 'press') return 0.92
  if (kind === 'wash') return 0.94
  if (kind === 'storage') return 1.62
  return 0.67
}

useGLTF.preload('/models/forklift_agv.glb')
useGLTF.preload('/models/industrial/cnc_machining_center.glb')
useGLTF.preload('/models/industrial/robot_cell.glb')
useGLTF.preload('/models/industrial/roller_conveyor.glb')
useGLTF.preload('/models/industrial/roller_conveyor_segment.glb')
useGLTF.preload('/models/industrial/safety_fence.glb')
useGLTF.preload('/models/industrial/control_cabinet.glb')
useGLTF.preload('/models/industrial/sensor_pack.glb')
useGLTF.preload('/models/industrial/hydraulic_press_detail.glb')
useGLTF.preload('/models/industrial/wash_deburr_detail.glb')
useGLTF.preload('/models/industrial/pallet_buffer_detail.glb')
useGLTF.preload('/models/industrial/flow_node_detail.glb')
