import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GridFloor } from './GridFloor'
import { BuildPlacer } from './BuildPlacer'
import { GhostPreview } from './GhostPreview'
import { FactoryObjectMesh } from './FactoryObjectMesh'
import { ItemLotMesh } from './ItemLotMesh'
import { useForgeMindStore } from '../store/forgeMind'

/**
 * 3D 工厂视口 —— 主画布。
 * Day 1：相机 + 灯光 + 网格地面 + OrbitControls。
 * Day 2：叠加建造交互（放置/旋转/ghost）与已放置对象渲染。
 */
export type FactoryView = 'overview' | 'build' | 'flow' | 'diagnostics'

const CAMERA_PRESETS: Record<FactoryView, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [17, 19, 17], target: [0, 0, 0] },
  build: { position: [0, 28, 0.01], target: [0, 0, 0] },
  flow: { position: [23, 10, 6], target: [0, 0, 0] },
  diagnostics: { position: [0, 28, 0.01], target: [0, 0, 0] },
}

export function FactoryCanvas({ view = 'overview' }: { view?: FactoryView }) {
  const objects = useForgeMindStore((s) => s.objects)
  const ghost = useForgeMindStore((s) => s.ghost)
  const buildType = useForgeMindStore((s) => s.buildType)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const select = useForgeMindStore((s) => s.select)
  const simSnapshot = useForgeMindStore((s) => s.simSnapshot)

  const isPlacing = buildType !== null

  // 机器运行时态索引：objectId -> runtime
  const runtimeMap = new Map(
    simSnapshot.machines.map((m) => [m.objectId, m]),
  )

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: CAMERA_PRESETS[view].position, fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
    >
      {/* 背景雾 —— 让远处网格淡出，工业纵深感 */}
      <color attach="background" args={['#dfe2e0']} />
      <fog attach="fog" args={['#dfe2e0', 60, 180]} />
      <CameraRig view={view} />

      {/* 灯光 */}
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#edf1f0', '#8d9794', 0.55]} />
      <directionalLight
        position={[20, 30, 15]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />

      {/* 场景内容 */}
      <GridFloor />

      {/* 细网格叠加 —— CAD 参考线质感 */}
      <Grid
        infiniteGrid
        cellSize={1}
        cellThickness={0.8}
        cellColor="#9da7a3"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#7f8c87"
        fadeDistance={120}
        fadeStrength={1}
        position={[0, 0.005, 0]}
      />

      {/* 已放置对象 */}
      {objects.map((o) => (
        <FactoryObjectMesh
          key={o.id}
          obj={o}
          objects={objects}
          selected={o.id === selectedId}
          active={simSnapshot.itemLots.some((lot) => lot.conveyorId === o.id)}
          runtime={runtimeMap.get(o.id)}
          onClick={select}
        />
      ))}

      {/* 在途物品（ItemLot） */}
      {simSnapshot.itemLots.map((lot) => (
        <ItemLotMesh key={lot.id} lot={lot} />
      ))}

      {/* ghost 预览 */}
      <GhostPreview ghost={ghost} />

      {/* 建造指针交互（挂 window 键盘） */}
      <BuildPlacer enabled={view === 'build'} />

      {/* 相机操控：建造模式禁用，避免拖动旋转与放置冲突 */}
      <OrbitControls
        makeDefault
        enabled={!isPlacing}
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={view === 'build' ? Math.PI / 2.02 : Math.PI / 2.05}
        minDistance={6}
        maxDistance={120}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}

function CameraRig({ view }: { view: FactoryView }) {
  const { camera } = useThree()
  const preset = CAMERA_PRESETS[view]
  const destination = useMemo(() => new THREE.Vector3(...preset.position), [preset])
  const target = useMemo(() => new THREE.Vector3(...preset.target), [preset])
  const transition = useRef({ startedAt: 0, from: new THREE.Vector3(), zoom: new THREE.Vector3(), fromTarget: new THREE.Vector3() })

  useEffect(() => {
    const state = transition.current
    state.startedAt = performance.now()
    state.from.copy(camera.position)
    state.fromTarget.set(0, 0, 0)
    state.zoom.copy(camera.position).lerp(target, 0.12)
  }, [camera, view, target])

  useFrame(() => {
    const state = transition.current
    const t = Math.min((performance.now() - state.startedAt) / 900, 1)
    const ease = (value: number) => value * value * (3 - 2 * value)
    if (t < 0.33) {
      camera.position.lerpVectors(state.from, state.zoom, ease(t / 0.33))
    } else {
      camera.position.lerpVectors(state.zoom, destination, ease((t - 0.33) / 0.67))
    }
    camera.lookAt(target)
  })

  return null
}
