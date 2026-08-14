import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { GridFloor } from './GridFloor'
import { BuildPlacer } from './BuildPlacer'
import { GhostPreview } from './GhostPreview'
import { FactoryObjectMesh } from './FactoryObjectMesh'
import { ItemLotMesh } from './ItemLotMesh'
import { ElevatorCabin } from './ElevatorCabin'
import { LoginCameraRig } from './LoginCameraRig'
import { useForgeMindStore } from '../store/forgeMind'
import { useAuthStore } from '../store/auth'

/**
 * 3D 工厂视口 —— 主画布。
 * Day 1：相机 + 灯光 + 网格地面 + OrbitControls。
 * Day 2：叠加建造交互（放置/旋转/ghost）与已放置对象渲染。
 * 登录后：电梯舱（ElevatorCabin）在未进厂阶段挂载，登录成功相机从舱内推镜进厂，
 * 相机控制（CameraRig/OrbitControls）仅在 factory 阶段挂载，避免与推镜抢相机。
 */
export type FactoryView = 'overview' | 'build' | 'flow' | 'diagnostics'

const CABIN_CAM: [number, number, number] = [-15.75, 1.88, 0]

export const CAMERA_PRESETS: Record<FactoryView, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [25, 31, 29], target: [-2, 0, 0] },
  build: { position: [-2, 43, 0.01], target: [-2, 0, 0] },
  flow: { position: [30, 17, 20], target: [-2, 0, 0] },
  diagnostics: { position: [-2, 43, 0.01], target: [-2, 0, 0] },
}

/** 工厂场景内容（无 Canvas 包装，供 FactoryCanvas 复用）。 */
export function FactoryScene({ view }: { view: FactoryView }) {
  const objects = useForgeMindStore((s) => s.objects)
  const ghost = useForgeMindStore((s) => s.ghost)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const select = useForgeMindStore((s) => s.select)
  const simSnapshot = useForgeMindStore((s) => s.simSnapshot)

  // 机器运行时态索引：objectId -> runtime
  const runtimeMap = new Map(
    simSnapshot.machines.map((m) => [m.objectId, m]),
  )
  const sourceRuntimeMap = new Map(
    simSnapshot.sources.map((s) => [s.objectId, s]),
  )

  return (
    <>
      {/* 背景雾 —— 让远处网格淡出，工业纵深感 */}
      <color attach="background" args={['#c4ceca']} />
      <fog attach="fog" args={['#c4ceca', 60, 180]} />

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
        cellColor="#879790"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#657873"
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
          active={simSnapshot.itemLots.some((lot) => lot.conveyorId === o.id) || sourceRuntimeMap.get(o.id)?.state === 'picking' || sourceRuntimeMap.get(o.id)?.state === 'placing'}
          runtime={runtimeMap.get(o.id)}
          sourceRuntime={sourceRuntimeMap.get(o.id)}
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
    </>
  )
}

export function FactoryCanvas({ view = 'overview' }: { view?: FactoryView }) {
  const phase = useAuthStore((s) => s.phase)
  const buildType = useForgeMindStore((s) => s.buildType)
  const inFactory = phase === 'factory'
  const isPlacing = buildType !== null

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: inFactory ? CAMERA_PRESETS[view].position : CABIN_CAM, fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
    >
      <FactoryScene view={view} />

      {/* 未进厂：电梯舱 + 登录相机推镜（独占相机） */}
      {!inFactory && <ElevatorCabin />}
      {!inFactory && <LoginCameraRig />}

      {/* 已进厂：视图切换 + 用户相机控制 */}
      {inFactory && <FactoryCameraController view={view} isPlacing={isPlacing} />}
    </Canvas>
  )
}

function FactoryCameraController({ view, isPlacing }: { view: FactoryView; isPlacing: boolean }) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const preset = CAMERA_PRESETS[view]
  const destination = useMemo(() => new THREE.Vector3(...preset.position), [preset])
  const destinationTarget = useMemo(() => new THREE.Vector3(...preset.target), [preset])
  const transition = useRef({
    active: false,
    startedAt: 0,
    duration: 1100,
    fromPosition: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    distance: 0,
  })

  useEffect(() => {
    const state = transition.current
    const controls = controlsRef.current
    state.startedAt = performance.now()
    state.fromPosition.copy(camera.position)
    state.fromTarget.copy(controls?.target ?? destinationTarget)
    state.distance = state.fromPosition.distanceTo(destination)
    state.duration = THREE.MathUtils.clamp(780 + state.distance * 22, 960, 1380)
    state.active = state.distance > 0.015 || state.fromTarget.distanceTo(destinationTarget) > 0.015
    if (controls && state.active) controls.enabled = false
  }, [camera, destination, destinationTarget, view])

  useFrame(() => {
    const state = transition.current
    const controls = controlsRef.current
    if (!controls) return

    if (!state.active) {
      controls.enabled = !isPlacing
      return
    }

    const t = Math.min((performance.now() - state.startedAt) / state.duration, 1)
    const eased = t * t * t * (t * (t * 6 - 15) + 10)
    camera.position.lerpVectors(state.fromPosition, destination, eased)
    camera.position.y += Math.sin(Math.PI * eased) * Math.min(state.distance * 0.055, 1.25)
    controls.target.lerpVectors(state.fromTarget, destinationTarget, eased)
    controls.update()

    if (t >= 1) {
      camera.position.copy(destination)
      controls.target.copy(destinationTarget)
      controls.update()
      state.active = false
      controls.enabled = !isPlacing
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!isPlacing}
      enablePan
      screenSpacePanning
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={view === 'build' ? Math.PI / 2.02 : Math.PI / 2.05}
      minDistance={6}
      maxDistance={120}
    />
  )
}
