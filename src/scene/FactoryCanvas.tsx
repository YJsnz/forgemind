import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, PerformanceMonitor } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { GridFloor } from './GridFloor'
import { BuildPlacer } from './BuildPlacer'
import { GhostPreview } from './GhostPreview'
import { FactoryObjectMesh, getConveyorLinks } from './FactoryObjectMesh'
import { ItemLotMesh } from './ItemLotMesh'
import { ElevatorCabin } from './ElevatorCabin'
import { LoginCameraRig } from './LoginCameraRig'
import { preloadPandaArm } from './PandaArmModel'
import { useForgeMindStore } from '../store/forgeMind'
import { useAuthStore } from '../store/auth'
import { DaiyuConveyorBatch, DaiyuEmbeddedModelBatch, DaiyuPandaBatch, DaiyuRuntime, DaiyuScenePrewarmer, DaiyuStaticModelBatch } from '../engine/daiyu'
import type { BuildType, FactoryObject } from '../game/types'
import { AgvRouteVisual } from './AgvRouteVisual'
import { WarehouseZone } from './WarehouseZone'

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
export function FactoryScene({ view, visible = true }: { view: FactoryView; visible?: boolean }) {
  const storedObjects = useForgeMindStore((s) => s.objects)
  const objects = useMemo(() => getDaiyuStressObjects(storedObjects), [storedObjects])
  const ghost = useForgeMindStore((s) => s.ghost)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const select = useForgeMindStore((s) => s.select)
  const simSnapshot = useForgeMindStore((s) => s.simSnapshot)
  const contentRef = useRef<THREE.Group>(null)

  // 机器运行时态索引：objectId -> runtime
  const runtimeMap = useMemo(
    () => new Map(simSnapshot.machines.map((machine) => [machine.objectId, machine])),
    [simSnapshot.machines],
  )
  const sourceRuntimeMap = useMemo(
    () => new Map(simSnapshot.sources.map((source) => [source.objectId, source])),
    [simSnapshot.sources],
  )
  const conveyorActiveIds = useMemo(
    () => new Set(simSnapshot.itemLots.map((lot) => lot.conveyorId)),
    [simSnapshot.itemLots],
  )
  const agvRuntimeMap = useMemo(
    () => new Map(simSnapshot.agvs.map((agv) => [agv.objectId, agv])),
    [simSnapshot.agvs],
  )
  const batchedConveyors = useMemo(
    () => objects.filter((object) => object.type === 'conveyor' && !getConveyorLinks(object, objects).corner),
    [objects],
  )
  const individuallyRenderedObjects = useMemo(() => {
    const batchedIds = new Set(batchedConveyors.map((object) => object.id))
    return objects.filter((object) => !batchedIds.has(object.id))
  }, [batchedConveyors, objects])
  const staticMachineObjects = useMemo(() => objects.filter((object) => object.type === 'machine'), [objects])
  const staticAgvObjects = useMemo(() => objects.filter((object) => object.type === 'agv'), [objects])
  const staticDroneObjects = useMemo(() => objects.filter((object) => object.type === 'drone'), [objects])
  const staticPressObjects = useMemo(() => objects.filter((object) => object.type === 'press'), [objects])
  const staticWashingObjects = useMemo(() => objects.filter((object) => object.type === 'washing'), [objects])
  const staticStorageObjects = useMemo(() => objects.filter((object) => object.type === 'storage'), [objects])
  const sourceObjects = useMemo(() => objects.filter((object) => object.type === 'source'), [objects])
  const sourceIds = useMemo(() => new Set(sourceObjects.map((object) => object.id)), [sourceObjects])
  const batchedPandaObjects = useMemo(
    () => objects.filter((object) => {
      if (object.type !== 'source') return false
      const state = sourceRuntimeMap.get(object.id)?.state
      return state !== 'picking' && state !== 'placing'
    }),
    [objects, sourceRuntimeMap],
  )
  const batchedPandaIds = useMemo(() => new Set(batchedPandaObjects.map((object) => object.id)), [batchedPandaObjects])
  const staticBatchedIds = useMemo(
    () => new Set([...staticMachineObjects, ...staticAgvObjects, ...staticDroneObjects, ...staticPressObjects, ...staticWashingObjects, ...staticStorageObjects].map((object) => object.id)),
    [staticAgvObjects, staticDroneObjects, staticMachineObjects, staticPressObjects, staticStorageObjects, staticWashingObjects],
  )
  const castDetailedShadows = objects.length <= 120

  return (
    <>
      {/* 背景雾 —— 让远处网格淡出，工业纵深感 */}
      {visible && <color attach="background" args={['#c4ceca']} />}
      {visible && <fog attach="fog" args={['#c4ceca', 60, 180]} />}

      <DaiyuScenePrewarmer rootRef={contentRef} enabled={!visible} preload={preloadPandaArm} />
      <group ref={contentRef} visible={visible}>
        {/* 灯光 */}
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#edf1f0', '#8d9794', 0.55]} />
        <directionalLight
          position={[20, 30, 15]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-normalBias={0.025}
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

        <WarehouseZone />
        <AgvRouteVisual agvs={simSnapshot.agvs} />

        {/* 已放置对象 */}
        <DaiyuConveyorBatch
          objects={batchedConveyors}
          activeIds={conveyorActiveIds}
          selectedId={selectedId}
          castShadows={castDetailedShadows}
          onSelect={select}
        />
        <DaiyuStaticModelBatch type="machine" objects={staticMachineObjects} castShadows={castDetailedShadows} onSelect={select} />
        <DaiyuStaticModelBatch type="agv" objects={staticAgvObjects} motion={agvRuntimeMap} castShadows={castDetailedShadows} onSelect={select} />
        <DaiyuStaticModelBatch type="drone" objects={staticDroneObjects} castShadows={castDetailedShadows} onSelect={select} />
        <DaiyuStaticModelBatch type="press" objects={staticPressObjects} castShadows={castDetailedShadows} onSelect={select} />
        <DaiyuStaticModelBatch type="washing" objects={staticWashingObjects} castShadows={castDetailedShadows} onSelect={select} />
        <DaiyuStaticModelBatch type="storage" objects={staticStorageObjects} castShadows={castDetailedShadows} onSelect={select} />
        <DaiyuPandaBatch objects={batchedPandaObjects} castShadows={castDetailedShadows} onSelect={select} />
        <DaiyuEmbeddedModelBatch batchName="source-conveyor" path="/models/industrial/roller_conveyor_segment.glb" targetFootprint={1.05} targetHeight={0.52} localPosition={[0.92, 0.17, -0.5]} rotationOffsetY={Math.PI / 2} stripDirectionTexture objects={sourceObjects} castShadows={castDetailedShadows} onSelect={select} />
        {individuallyRenderedObjects.map((o) => (
          <FactoryObjectMesh
            key={o.id}
            obj={o}
            objects={objects}
            selected={o.id === selectedId}
            active={conveyorActiveIds.has(o.id) || sourceRuntimeMap.get(o.id)?.state === 'picking' || sourceRuntimeMap.get(o.id)?.state === 'placing'}
            runtime={runtimeMap.get(o.id)}
            sourceRuntime={sourceRuntimeMap.get(o.id)}
            suppressEquipmentModel={staticBatchedIds.has(o.id)}
            showPortMarkers={objects.length <= 120 || o.id === selectedId}
            castShadows={castDetailedShadows}
            suppressPanda={batchedPandaIds.has(o.id)}
            suppressConveyor={sourceIds.has(o.id)}
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
        <BuildPlacer enabled={visible && view === 'build'} />
      </group>
    </>
  )
}

/** 仅开发环境：?daiyuStress=300，不写入 store，也不参与保存。 */
function getDaiyuStressObjects(storedObjects: FactoryObject[]) {
  if (!import.meta.env.DEV) return storedObjects
  const requested = Number(new URLSearchParams(window.location.search).get('daiyuStress'))
  if (!Number.isFinite(requested) || requested < 1) return storedObjects
  const count = Math.min(Math.floor(requested), 600)
  const pattern: BuildType[] = [
    'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor',
    'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor',
    'machine', 'machine', 'agv', 'storage', 'source', 'press', 'washing', 'inspection',
  ]
  const columns = Math.ceil(Math.sqrt(count * 1.45))
  const rows = Math.ceil(count / columns)
  return Array.from({ length: count }, (_, index): FactoryObject => {
    const type = pattern[index % pattern.length]
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      id: `daiyu-stress-${index}`,
      type,
      pos: {
        x: column * 3 - Math.floor(columns * 1.5),
        z: row * 3 - Math.floor(rows * 1.5),
      },
      rotation: ([0, 90, 180, 270] as const)[(column + row) % 4],
    }
  })
}

export function FactoryCanvas({ view = 'overview' }: { view?: FactoryView }) {
  const phase = useAuthStore((s) => s.phase)
  const buildType = useForgeMindStore((s) => s.buildType)
  const inFactory = phase === 'factory'
  const showFactory = phase !== 'elevator'
  const isPlacing = buildType !== null
  const forcedDevelopmentDpr = getForcedDevelopmentDpr()
  const [dpr, setDpr] = useState(() => forcedDevelopmentDpr ?? Math.min(window.devicePixelRatio, 1.2))

  return (
    <Canvas
      shadows="basic"
      dpr={dpr}
      performance={{ min: 0.55, debounce: 650 }}
      camera={{ position: inFactory ? CAMERA_PRESETS[view].position : CABIN_CAM, fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
      style={{ background: 'transparent' }}
    >
      <PerformanceMonitor
        flipflops={3}
        onChange={({ factor }) => {
          if (forcedDevelopmentDpr === null && phase !== 'entering') setDpr(Math.max(1, Math.round((0.78 + factor * 0.62) * 100) / 100))
        }}
        onFallback={() => {
          if (forcedDevelopmentDpr === null) setDpr(1)
        }}
      />
      <DaiyuRuntime running={inFactory} />
      <Suspense fallback={null}>
        <FactoryScene view={view} visible={showFactory} />
      </Suspense>

      {/* 未进厂：电梯舱 + 登录相机推镜（独占相机） */}
      {!inFactory && <ElevatorCabin />}
      {!inFactory && <LoginCameraRig />}

      {/* 已进厂：视图切换 + 用户相机控制 */}
      {inFactory && <FactoryCameraController view={view} isPlacing={isPlacing} />}
    </Canvas>
  )
}

function getForcedDevelopmentDpr() {
  if (!import.meta.env.DEV) return null
  const value = Number(new URLSearchParams(window.location.search).get('daiyuDpr'))
  return Number.isFinite(value) && value >= 1 && value <= 2 ? value : null
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
