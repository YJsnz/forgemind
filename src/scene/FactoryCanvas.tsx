import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerformanceMonitor } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { GridFloor } from './GridFloor'
import { BuildPlacer } from './BuildPlacer'
import { GhostPreview } from './GhostPreview'
import { FactoryObjectMesh, getConveyorLinks, PortMarkerPulseTicker } from './FactoryObjectMesh'
import { ItemLotMesh, ItemLotMotionTicker } from './ItemLotMesh'
import { RuntimeDetailSignalTicker } from './EquipmentModel'
import { ElevatorCabin } from './ElevatorCabin'
import { LoginCameraRig } from './LoginCameraRig'
import { useForgeMindStore } from '../store/forgeMind'
import { useAuthStore } from '../store/auth'
import { DaiyuConveyorBatch, DaiyuEmbeddedModelBatch, DaiyuPandaBatch, DaiyuRuntime, DaiyuScenePrewarmer, DaiyuStaticModelBatch } from '../engine/daiyu'
import { canBatchAsGenericMachine, type BuildType, type FactoryFloorId, type FactoryObject } from '../game/types'
import { AgvRouteVisual } from './AgvRouteVisual'
import { BASE_CONVEYOR_CROSS_SECTION_SCALE, NON_VEHICLE_BUILDING_VISUAL_SCALE, SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION } from './industrialVisualScale'
import { WarehouseZone } from './WarehouseZone'
import { FactoryFloorSystem, getFloorElevation, getObjectFloor } from './FactoryFloorSystem'
import { inclineTouchesFloor, isInclineConveyorType, objectsTouchingFloor } from '../game/inclineConveyor'
import { InclineConveyorMesh } from './InclineConveyorMesh'
import { DroneRouteVisual } from './DroneRouteVisual'
import { floorIsInteractive, floorObjectsVisible, gridVisibleOnFloor, inclineVisible } from '../game/floorVisibility'
import { getFactoryFloors } from '../game/floorConfig'
import { SelectionController } from './SelectionController'
import { RackInventoryLabels } from './RackInventoryLabels'
import type { DaiyuTargetFps } from '../engine/daiyu/config'
import { daiyuEngine, type DaiyuSnapshot } from '../engine/daiyu/DaiyuEngine'
import { isUnityBridgeAvailable, requestUnitySurface, sendUnityCamera, sendUnityFloor, sendUnityRenderConfig, sendUnityScene, sendUnitySelection, sendUnitySnapshot, sendUnityViewport, subscribeUnityBridge } from '../platform/unityBridge'
import type { FactorySave } from '../game/save'

/**
 * 3D 工厂视口 —— 主画布。
 * Day 1：相机 + 灯光 + 网格地面 + OrbitControls。
 * Day 2：叠加建造交互（放置/旋转/ghost）与已放置对象渲染。
 * 登录后：电梯舱（ElevatorCabin）在未进厂阶段挂载，登录成功相机从舱内推镜进厂，
 * 相机控制（CameraRig/OrbitControls）仅在 factory 阶段挂载，避免与推镜抢相机。
 */
export type FactoryView = 'overview' | 'build' | 'flow' | 'diagnostics'
const DEFAULT_FACTORY_FLOORS: FactoryFloorId[] = [1]

const CABIN_CAM: [number, number, number] = [-15.75, 1.88, 0]

export const CAMERA_PRESETS: Record<FactoryView, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [25, 31, 29], target: [-2, 0, 0] },
  build: { position: [-2, 43, 0.01], target: [-2, 0, 0] },
  flow: { position: [30, 17, 20], target: [-2, 0, 0] },
  diagnostics: { position: [-2, 43, 0.01], target: [-2, 0, 0] },
}

/** 工厂场景内容（无 Canvas 包装，供 FactoryCanvas 复用）。 */
export function FactoryScene({
  view,
  visible = true,
  shadowsEnabled = true,
  activeFloor = 1,
  visibleFloors = DEFAULT_FACTORY_FLOORS,
  floorCount = 1,
  showRackLabels = true,
  }: {
  view: FactoryView
  visible?: boolean
  shadowsEnabled?: boolean
  activeFloor?: FactoryFloorId
  visibleFloors?: readonly FactoryFloorId[]
  floorCount?: number
    showRackLabels?: boolean
  }) {
  const floorElevation = getFloorElevation(activeFloor)
  const storedObjects = useForgeMindStore((s) => s.objects)
  const allObjects = useMemo(() => getDaiyuStressObjects(storedObjects), [storedObjects])
  const visibleFloorSet = useMemo(() => new Set(visibleFloors), [visibleFloors])
  const factoryFloorIds = useMemo(() => getFactoryFloors(floorCount).map((floor) => floor.id), [floorCount])
  const objects = useMemo(
    () => selectableObjectsForFloor(allObjects, activeFloor, visibleFloorSet),
    [activeFloor, allObjects, visibleFloorSet],
  )
  const ghost = useForgeMindStore((s) => s.ghost)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const selectedIds = useForgeMindStore((s) => s.selectedIds)
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const select = useForgeMindStore((s) => s.select)
  const simSnapshot = useForgeMindStore((s) => s.simSnapshot)
  const items = useForgeMindStore((s) => s.items)
  const simPlaying = useForgeMindStore((s) => s.simPlaying)
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
  const visibleItemLots = useMemo(() => {
    const objectsById = new Map(allObjects.map((object) => [object.id, object]))
    return simSnapshot.itemLots.filter((lot) => {
      const conveyor = objectsById.get(lot.conveyorId)
      return conveyor && isInclineConveyorType(conveyor.type)
        ? inclineTouchesFloor(conveyor, activeFloor)
          && Boolean(conveyor.incline && inclineVisible(conveyor.incline, activeFloor, visibleFloorSet))
        : lot.floorId === activeFloor
    })
  }, [activeFloor, allObjects, simSnapshot.itemLots, visibleFloorSet])
  const agvRuntimeMap = useMemo(
    () => new Map(simSnapshot.agvs.map((agv) => [agv.objectId, agv])),
    [simSnapshot.agvs],
  )
  const droneRuntimeMap = useMemo(
    () => new Map(simSnapshot.drones.map((drone) => [drone.objectId, drone])),
    [simSnapshot.drones],
  )
  const visibleDroneObjects = useMemo(
    () => allObjects.filter((object) => {
      if (object.type !== 'drone') return false
      const runtime = droneRuntimeMap.get(object.id)
      return floorObjectsVisible(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor, visibleFloorSet)
    }),
    [activeFloor, allObjects, droneRuntimeMap, factoryFloorIds, visibleFloorSet],
  )
  const contextFloorIds = useMemo(
    () => factoryFloorIds.filter((floorId) => floorId !== activeFloor && visibleFloorSet.has(floorId)),
    [activeFloor, factoryFloorIds, visibleFloorSet],
  )
  const contextInclines = useMemo(
    () => allObjects.filter((object) => isInclineConveyorType(object.type)
      && Boolean(object.incline)
      && !inclineTouchesFloor(object, activeFloor)
      && inclineVisible(object.incline!, activeFloor, visibleFloorSet)),
    [activeFloor, allObjects, visibleFloorSet],
  )
  const activeFloorObjects = useMemo(
    () => objects.filter((object) => floorIsInteractive(getObjectFloor(object), activeFloor)),
    [objects, activeFloor],
  )
  const batchedConveyors = useMemo(
    () => activeFloorObjects.filter((object) => object.type === 'conveyor' && !getConveyorLinks(object, objects).corner),
    [activeFloorObjects, objects],
  )
  const inclineObjects = useMemo(() => activeFloorObjects.filter((object) => isInclineConveyorType(object.type)), [activeFloorObjects])
  const individuallyRenderedObjects = useMemo(() => {
    const batchedIds = new Set([...batchedConveyors, ...inclineObjects].map((object) => object.id))
    return activeFloorObjects.filter((object) => !batchedIds.has(object.id))
  }, [activeFloorObjects, batchedConveyors, inclineObjects])
  const staticMachineObjects = useMemo(() => activeFloorObjects.filter(canBatchAsGenericMachine), [activeFloorObjects])
  const staticAgvObjects = useMemo(() => activeFloorObjects.filter((object) => object.type === 'agv'), [activeFloorObjects])
  const staticPressObjects = useMemo(() => activeFloorObjects.filter((object) => object.type === 'press'), [activeFloorObjects])
  const staticWashingObjects = useMemo(() => activeFloorObjects.filter((object) => object.type === 'washing'), [activeFloorObjects])
  const staticStorageObjects = useMemo(() => activeFloorObjects.filter((object) => object.type === 'storage'), [activeFloorObjects])
  const sourceObjects = useMemo(() => activeFloorObjects.filter((object) => object.type === 'source'), [activeFloorObjects])
  const sourceIds = useMemo(() => new Set(sourceObjects.map((object) => object.id)), [sourceObjects])
  const batchedPandaObjects = useMemo(
    () => activeFloorObjects.filter((object) => {
      if (object.type !== 'source') return false
      const state = sourceRuntimeMap.get(object.id)?.state
      return state !== 'picking' && state !== 'placing'
    }),
    [activeFloorObjects, sourceRuntimeMap],
  )
  const batchedPandaIds = useMemo(() => new Set(batchedPandaObjects.map((object) => object.id)), [batchedPandaObjects])
  const staticBatchedIds = useMemo(
    () => new Set([...staticMachineObjects, ...staticAgvObjects, ...staticPressObjects, ...staticWashingObjects, ...staticStorageObjects].map((object) => object.id)),
    [staticAgvObjects, staticMachineObjects, staticPressObjects, staticStorageObjects, staticWashingObjects],
  )
  const castDetailedShadows = shadowsEnabled && allObjects.length <= 120

  return (
    <>
      {/* 背景雾 —— 让远处网格淡出，工业纵深感 */}
      {visible && <color attach="background" args={['#c4ceca']} />}
      {visible && <fog attach="fog" args={['#c4ceca', 60, 180]} />}

      {/* 空白电梯页不再主动唤醒 Panda/GLB；有真实工厂对象时才允许后台编译。 */}
      <DaiyuScenePrewarmer rootRef={contentRef} enabled={!visible && allObjects.length > 0} />
      <group ref={contentRef} visible={visible}>
        {/* 逐件物料和端口标记仍保留原视觉动画，但由共享帧调度器统一更新。 */}
        <ItemLotMotionTicker />
        <PortMarkerPulseTicker />
        <RuntimeDetailSignalTicker />
        {/* 灯光 */}
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#edf1f0', '#8d9794', 0.55]} />
        <directionalLight
          position={[20, 30, 15]}
          intensity={1.2}
          castShadow={shadowsEnabled}
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
        <FactoryFloorSystem floorCount={floorCount} />
        {factoryFloorIds.filter((floorId) => gridVisibleOnFloor(floorId, activeFloor)).map((floorId) => (
          <group key={floorId} name={`active-floor-grid:L${floorId}`} position={[0, getFloorElevation(floorId), 0]}>
            <GridFloor showZones={floorId === 1} />
            {floorId === 1 && <WarehouseZone />}
          </group>
        ))}

        {visibleDroneObjects.length > 0 && <group name="cargo-drone-vehicles">
          {visibleDroneObjects.some((object) => {
            const runtime = droneRuntimeMap.get(object.id)
            return floorIsInteractive(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor)
          }) && <DaiyuStaticModelBatch
            type="drone"
            objects={visibleDroneObjects.filter((object) => {
              const runtime = droneRuntimeMap.get(object.id)
              return floorIsInteractive(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor)
            })}
            motion={droneRuntimeMap}
            running={simPlaying}
            castShadows={castDetailedShadows}
            onSelect={select}
          />}
          {visibleDroneObjects.some((object) => {
            const runtime = droneRuntimeMap.get(object.id)
            return !floorIsInteractive(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor)
          }) && <DaiyuStaticModelBatch
            type="drone"
            objects={visibleDroneObjects.filter((object) => {
              const runtime = droneRuntimeMap.get(object.id)
              return !floorIsInteractive(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor)
            })}
            motion={droneRuntimeMap}
            running={simPlaying}
            castShadows={false}
          />}
        </group>}
        <DroneRouteVisual drones={simSnapshot.drones.filter((drone) => visibleDroneObjects.some((object) => object.id === drone.objectId))} />

        {contextFloorIds.map((floorId) => <ContextFloorLayer key={floorId} floorId={floorId} allObjects={allObjects} />)}
        {contextInclines.map((object) => (
          <group key={object.id} position={[0, getFloorElevation(object.incline!.lowerFloorId), 0]}>
            <InclineConveyorMesh
              object={object}
              renderFloorId={object.incline!.lowerFloorId}
              selected={selectedIdSet.has(object.id)}
              running={simPlaying}
            />
            {simSnapshot.itemLots.filter((lot) => lot.conveyorId === object.id).map((lot) => <ItemLotMesh key={lot.id} lot={lot} renderFloorId={object.incline!.lowerFloorId} />)}
          </group>
        ))}

        {/* 已放置对象 */}
        <group position={[0, floorElevation, 0]}>
          {batchedConveyors.length > 0 && <DaiyuConveyorBatch
            objects={batchedConveyors}
            running={simPlaying}
            selectedIds={selectedIds}
            castShadows={castDetailedShadows}
            onSelect={select}
          />}
          {staticMachineObjects.length > 0 && <DaiyuStaticModelBatch type="machine" objects={staticMachineObjects} castShadows={castDetailedShadows} onSelect={select} />}
          {staticAgvObjects.length > 0 && <DaiyuStaticModelBatch type="agv" objects={staticAgvObjects} motion={agvRuntimeMap} running={simPlaying} castShadows={castDetailedShadows} onSelect={select} />}
          {staticPressObjects.length > 0 && <DaiyuStaticModelBatch type="press" objects={staticPressObjects} castShadows={castDetailedShadows} onSelect={select} />}
          {staticWashingObjects.length > 0 && <DaiyuStaticModelBatch type="washing" objects={staticWashingObjects} castShadows={castDetailedShadows} onSelect={select} />}
          {staticStorageObjects.length > 0 && <DaiyuStaticModelBatch type="storage" objects={staticStorageObjects} castShadows={castDetailedShadows} onSelect={select} />}
          {batchedPandaObjects.length > 0 && <DaiyuPandaBatch objects={batchedPandaObjects} castShadows={castDetailedShadows} onSelect={select} />}
          {sourceObjects.length > 0 && <DaiyuEmbeddedModelBatch batchName="source-conveyor" path="/models/industrial/roller_conveyor_segment.glb" targetFootprint={1.05} targetHeight={0.52} localPosition={SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION} rotationOffsetY={Math.PI / 2} stripDirectionTexture crossSectionScale={BASE_CONVEYOR_CROSS_SECTION_SCALE} visualScale={NON_VEHICLE_BUILDING_VISUAL_SCALE} objects={sourceObjects} castShadows={castDetailedShadows} onSelect={select} />}
          {inclineObjects.map((object) => (
            <InclineConveyorMesh
              key={object.id}
              object={object}
              renderFloorId={activeFloor}
              selected={selectedIdSet.has(object.id)}
              running={simPlaying}
              onSelect={select}
            />
          ))}
          {individuallyRenderedObjects.map((o) => (
            <FactoryObjectMesh
              key={o.id}
              obj={o}
              objects={objects}
              selected={selectedIdSet.has(o.id)}
              active={conveyorActiveIds.has(o.id) || sourceRuntimeMap.get(o.id)?.state === 'picking' || sourceRuntimeMap.get(o.id)?.state === 'placing'}
              running={simPlaying}
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
          {visibleItemLots.map((lot) => (
            <ItemLotMesh key={lot.id} lot={lot} renderFloorId={activeFloor} />
          ))}

          <RackInventoryLabels visible={showRackLabels} objects={objects} racks={simSnapshot.racks} items={items} />

          {/* ghost 预览 */}
          <GhostPreview ghost={ghost} />

          {/* 建造指针交互（挂 window 键盘） */}
          <BuildPlacer enabled={visible && view === 'build'} floorId={activeFloor} />
        </group>
        {floorObjectsVisible(1, activeFloor, visibleFloorSet) && <AgvRouteVisual agvs={simSnapshot.agvs} />}
      </group>
    </>
  )
}

function CanvasSelectionController({
  enabled,
  activeFloor,
  visibleFloors,
}: {
  enabled: boolean
  activeFloor: FactoryFloorId
  visibleFloors: readonly FactoryFloorId[]
}) {
  const storedObjects = useForgeMindStore((state) => state.objects)
  const allObjects = useMemo(() => getDaiyuStressObjects(storedObjects), [storedObjects])
  const visibleFloorSet = useMemo(() => new Set(visibleFloors), [visibleFloors])
  const selectableObjects = useMemo(
    () => selectableObjectsForFloor(allObjects, activeFloor, visibleFloorSet),
    [activeFloor, allObjects, visibleFloorSet],
  )
  return <SelectionController enabled={enabled} selectableObjects={selectableObjects} />
}

function selectableObjectsForFloor(allObjects: FactoryObject[], activeFloor: FactoryFloorId, visibleFloorSet: ReadonlySet<FactoryFloorId>) {
  return allObjects.filter((object) => {
    if (object.type === 'drone') return false
    if (isInclineConveyorType(object.type) && object.incline) {
      return inclineTouchesFloor(object, activeFloor) && inclineVisible(object.incline, activeFloor, visibleFloorSet)
    }
    return floorObjectsVisible(activeFloor, activeFloor, visibleFloorSet) && getObjectFloor(object) === activeFloor
  })
}

function ContextFloorLayer({ floorId, allObjects }: { floorId: FactoryFloorId; allObjects: FactoryObject[] }) {
  const snapshot = useForgeMindStore((state) => state.simSnapshot)
  const floorObjects = useMemo(
    () => allObjects.filter((object) => getObjectFloor(object) === floorId && object.type !== 'drone' && !isInclineConveyorType(object.type)),
    [allObjects, floorId],
  )
  const touchingObjects = useMemo(() => objectsTouchingFloor(allObjects, floorId), [allObjects, floorId])
  const runtimeMap = useMemo(() => new Map(snapshot.machines.map((runtime) => [runtime.objectId, runtime])), [snapshot.machines])
  const sourceRuntimeMap = useMemo(() => new Map(snapshot.sources.map((runtime) => [runtime.objectId, runtime])), [snapshot.sources])
  const activeIds = useMemo(() => new Set(snapshot.itemLots.map((lot) => lot.conveyorId)), [snapshot.itemLots])
  const itemLots = useMemo(() => snapshot.itemLots.filter((lot) => lot.floorId === floorId && !isInclineConveyorType(allObjects.find((object) => object.id === lot.conveyorId)?.type ?? 'conveyor')), [allObjects, floorId, snapshot.itemLots])
  return (
    <group name={`context-floor:L${floorId}`} position={[0, getFloorElevation(floorId), 0]}>
      <ContextFloorDeck visible={floorObjects.length > 0} />
      {floorObjects.map((object) => (
        <FactoryObjectMesh
          key={object.id}
          obj={object}
          objects={touchingObjects}
          selected={false}
          active={activeIds.has(object.id) || sourceRuntimeMap.get(object.id)?.state === 'picking' || sourceRuntimeMap.get(object.id)?.state === 'placing'}
          running={false}
          runtime={runtimeMap.get(object.id)}
          sourceRuntime={sourceRuntimeMap.get(object.id)}
          castShadows={false}
          showPortMarkers={false}
          simplified
        />
      ))}
      {itemLots.map((lot) => <ItemLotMesh key={lot.id} lot={lot} renderFloorId={floorId} />)}
    </group>
  )
}

/**
 * Context floors are read-only, but their buildings must visibly stand on a
 * floor slab — a near-transparent deck made elevated equipment look like it
 * was floating in mid-air. The deck stays quiet (no grid, zones, or
 * interaction) but is now opaque with a darker rim so the floor level reads.
 */
function ContextFloorDeck({ visible }: { visible: boolean }) {
  return (
    <group visible={visible}>
      <mesh name="context-floor-deck-edge" position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[50.5, 34.5]} />
        <meshStandardMaterial color="#93a49d" roughness={0.96} metalness={0.02} />
      </mesh>
      <mesh
        name="context-floor-deck"
        position={[0, -0.015, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[50, 34]} />
        <meshStandardMaterial color="#c7d2cc" roughness={0.94} metalness={0.02} />
      </mesh>
    </group>
  )
}

function nearestFloorForDrone(y: number, floorIds: readonly FactoryFloorId[]): FactoryFloorId {
  return floorIds.reduce((nearest, floorId) => {
    const nearestDistance = Math.abs(y - (getFloorElevation(nearest) + 2.2))
    const distance = Math.abs(y - (getFloorElevation(floorId) + 2.2))
    return distance < nearestDistance ? floorId : nearest
  }, 1 as FactoryFloorId)
}

/** 仅开发环境：?daiyuStress=300，不写入 store，也不参与保存。 */
function getDaiyuStressObjects(storedObjects: FactoryObject[]) {
  const count = getDaiyuStressCount()
  if (count === 0) return storedObjects
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

function getDaiyuStressCount() {
  if (!import.meta.env.DEV) return 0
  const requested = Number(new URLSearchParams(window.location.search).get('daiyuStress'))
  return Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), 600) : 0
}

function UnitySceneBridge({
  enabled,
  view,
  targetFps,
  activeFloor,
  visibleFloors,
  floorCount,
}: {
  enabled: boolean
  view: FactoryView
  targetFps: DaiyuTargetFps
  activeFloor: FactoryFloorId
  visibleFloors: readonly FactoryFloorId[]
  floorCount: number
}) {
  const storedObjects = useForgeMindStore((s) => s.objects)
  const factoryName = useForgeMindStore((s) => s.factoryName)
  const floorNames = useForgeMindStore((s) => s.floorNames)
  const items = useForgeMindStore((s) => s.items)
  const recipes = useForgeMindStore((s) => s.recipes)
  const machineDefinitions = useForgeMindStore((s) => s.machineDefinitions)
  const simSnapshot = useForgeMindStore((s) => s.simSnapshot)
  const simPlaying = useForgeMindStore((s) => s.simPlaying)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const selectedIds = useForgeMindStore((s) => s.selectedIds)
  const visibleFloorKey = visibleFloors.join(',')
  const bridgeSave = useMemo<FactorySave>(() => ({
    version: 6,
    name: factoryName,
    floorCount,
    floorNames: [...floorNames],
    objects: storedObjects,
    items,
    recipes,
    machineDefinitions,
  }), [factoryName, floorCount, floorNames, items, machineDefinitions, recipes, storedObjects])

  useEffect(() => {
    if (!enabled) return
    sendUnityScene(bridgeSave, activeFloor, visibleFloors)
  }, [bridgeSave, enabled])

  useEffect(() => {
    if (!enabled) return
    sendUnityFloor(activeFloor, visibleFloors)
  }, [activeFloor, enabled, visibleFloorKey])

  useEffect(() => {
    if (!enabled) return
    sendUnityRenderConfig(targetFps)
  }, [enabled, targetFps])

  useEffect(() => {
    if (!enabled) return
    const preset = CAMERA_PRESETS[view]
    const elevation = getFloorElevation(activeFloor)
    sendUnityCamera({
      position: { x: preset.position[0], y: preset.position[1] + elevation, z: preset.position[2] },
      target: { x: preset.target[0], y: preset.target[1] + elevation, z: preset.target[2] },
      fov: 45,
      distance: Math.hypot(
        preset.position[0] - preset.target[0],
        preset.position[1] - preset.target[1],
        preset.position[2] - preset.target[2],
      ),
      animate: true,
    })
  }, [activeFloor, enabled, view])

  useEffect(() => {
    if (enabled) sendUnitySnapshot({ ...simSnapshot, running: simPlaying })
  }, [enabled, simPlaying, simSnapshot])

  useEffect(() => {
    if (enabled) sendUnitySelection(selectedIds, selectedId)
  }, [enabled, selectedId, selectedIds])

  return null
}

export function FactoryCanvas({ view = 'overview', targetFps = 60, activeFloor = 1, visibleFloors = DEFAULT_FACTORY_FLOORS, floorCount = 1, showRackLabels = true, nativeSurfaceEnabled = false }: { view?: FactoryView; targetFps?: DaiyuTargetFps; activeFloor?: FactoryFloorId; visibleFloors?: readonly FactoryFloorId[]; floorCount?: number; showRackLabels?: boolean; nativeSurfaceEnabled?: boolean }) {
  const phase = useAuthStore((s) => s.phase)
  const buildType = useForgeMindStore((s) => s.buildType)
  const storedObjectCount = useForgeMindStore((s) => s.objects.length)
  const sceneObjectCount = Math.max(storedObjectCount, getDaiyuStressCount())
  const simPlaying = useForgeMindStore((s) => s.simPlaying)
  const selectObject = useForgeMindStore((s) => s.select)
  const inFactory = phase === 'factory'
  const showFactory = phase !== 'elevator'
  const isPlacing = buildType !== null
  const floorElevation = getFloorElevation(activeFloor)
  const cameraPreset = CAMERA_PRESETS[view]
  const forcedDevelopmentDpr = getForcedDevelopmentDpr()
  // 25 个对象已经可能包含多个 40–700k 三角形的工艺 GLB；该标记只用于
  // PerformanceMonitor 的自适应下限，正常首帧仍保留原有高质量画面。
  const geometryHeavyScene = sceneObjectCount > 24
  const largeScene = sceneObjectCount > 120
  const [dpr, setDpr] = useState(() => forcedDevelopmentDpr ?? initialDprForScene(sceneObjectCount, targetFps))
  const [shadowsEnabled, setShadowsEnabled] = useState(() => shouldEnableShadows(sceneObjectCount, targetFps))
  // 大场景运行时改用跟随目标档位的受控按需帧，避免 500+ 对象在没有必要时持续推满 GPU；
  // 小场景仍保持连续帧，保证原有运行态流畅度。
  const [cameraMoving, setCameraMoving] = useState(false)
  const [unityNativeReady, setUnityNativeReady] = useState(false)
  const [unityGraphicsApi, setUnityGraphicsApi] = useState('NATIVE')
  const [unityFps, setUnityFps] = useState<number | null>(null)
  const unitySurfaceSlotRef = useRef<HTMLDivElement>(null)
  const largeSceneRunning = inFactory && largeScene && simPlaying && !isPlacing && !cameraMoving
  const needsContinuousFrames = !inFactory || isPlacing || cameraMoving || (simPlaying && !largeScene)
  const shadowRevision = `${sceneObjectCount}|${shadowsEnabled}|${dpr}|${floorCount}|${visibleFloors.join(',')}|${activeFloor}`

  useEffect(() => {
    if (!inFactory || !nativeSurfaceEnabled || !isUnityBridgeAvailable()) return
    const unsubscribe = subscribeUnityBridge((message) => {
      if (message.type === 'bridge.ready') {
        setUnityNativeReady(true)
        const payload = message.payload as { graphicsApi?: unknown } | undefined
        if (typeof payload?.graphicsApi === 'string' && payload.graphicsApi.length > 0) setUnityGraphicsApi(payload.graphicsApi)
        document.documentElement.dataset.unityRenderer = 'native'
      }
      if (message.type === 'bridge.error') {
        setUnityNativeReady(false)
        document.documentElement.dataset.unityRenderer = 'webgl'
      }
      if (message.type === 'object.selected') {
        const payload = message.payload as { objectId?: unknown } | undefined
        const objectId = typeof payload?.objectId === 'string' && payload.objectId.length > 0 ? payload.objectId : null
        selectObject(objectId)
      }
      if (message.type === 'render.stats') {
        const payload = message.payload as { fps?: unknown } | undefined
        if (typeof payload?.fps === 'number' && Number.isFinite(payload.fps)) setUnityFps(payload.fps)
      }
    })
    requestUnitySurface()
    return () => {
      unsubscribe()
      setUnityNativeReady(false)
      delete document.documentElement.dataset.unityRenderer
    }
  }, [inFactory, nativeSurfaceEnabled, selectObject])

  useEffect(() => {
    if (!inFactory || !nativeSurfaceEnabled || !isUnityBridgeAvailable()) return
    const viewport = document.querySelector<HTMLElement>('.fm-viewport')
    const slot = unitySurfaceSlotRef.current
    if (!viewport || !slot) return
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) >= 0.01
    }
    const publish = () => {
      const blockingWorkspace = viewport.querySelector<HTMLElement>([
        '.fm-production-workspace',
        '.fm-route-workspace',
        '.fm-manufacturing-workspace',
        '.fm-item-detail-workspace',
        '.fm-warehouse-workspace',
      ].join(','))
      if (document.querySelector('[role="dialog"]') || (blockingWorkspace && isVisible(blockingWorkspace))) {
        sendUnityViewport({ x: 0, y: 0, width: 0, height: 0, devicePixelRatio: window.devicePixelRatio || 1, visible: false, occlusions: '' })
        return
      }
      const slotRect = slot.getBoundingClientRect()
      let left = slotRect.left
      let right = slotRect.right
      const sidePanels = Array.from(viewport.querySelectorAll<HTMLElement>('.fm-device-drawer, .fm-mode-panel, .fm-build-menu'))
        .filter(isVisible)
      for (const panel of sidePanels) {
        const panelRect = panel.getBoundingClientRect()
        if (panelRect.right <= left || panelRect.left >= right || panelRect.bottom <= slotRect.top || panelRect.top >= slotRect.bottom) continue
        if (panelRect.left >= (left + right) * 0.5) right = Math.min(right, panelRect.left - 8)
        else left = Math.max(left, panelRect.right + 8)
      }
      const width = Math.max(0, right - left)
      const height = Math.max(0, slotRect.height)
      sendUnityViewport({
        x: left,
        y: slotRect.top,
        width,
        height,
        devicePixelRatio: window.devicePixelRatio || 1,
        visible: width > 80 && height > 80,
        occlusions: '',
      })
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(viewport)
    observer.observe(slot)
    const dialogObserver = new MutationObserver(publish)
    dialogObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    window.addEventListener('resize', publish)
    return () => {
      observer.disconnect()
      dialogObserver.disconnect()
      window.removeEventListener('resize', publish)
      sendUnityViewport({ x: 0, y: 0, width: 0, height: 0, devicePixelRatio: window.devicePixelRatio || 1, visible: false, occlusions: '' })
    }
  }, [inFactory, nativeSurfaceEnabled])

  useEffect(() => {
    if (forcedDevelopmentDpr !== null) return
    setDpr(initialDprForScene(sceneObjectCount, targetFps))
    setShadowsEnabled(shouldEnableShadows(sceneObjectCount, targetFps))
  }, [forcedDevelopmentDpr, sceneObjectCount, targetFps])

  return (
    <>
      {nativeSurfaceEnabled && <div ref={unitySurfaceSlotRef} className="fm-unity-surface-slot" aria-hidden="true" />}
      <UnitySceneBridge enabled={inFactory && nativeSurfaceEnabled && unityNativeReady} view={view} targetFps={targetFps} activeFloor={activeFloor} visibleFloors={visibleFloors} floorCount={floorCount} />
      {/* Web always owns the WebGL surface. Desktop may hand it to Unity only
          after bridge.ready; a missing/failed native handshake keeps WebGL. */}
      {(!nativeSurfaceEnabled || !unityNativeReady) && <Canvas
        className={unityNativeReady ? 'fm-webgl-renderer-hidden' : undefined}
        frameloop={unityNativeReady ? 'never' : needsContinuousFrames ? 'always' : 'demand'}
        shadows={shadowsEnabled ? 'basic' : false}
        dpr={dpr}
        performance={{ min: targetFps === 120 ? (largeScene ? 0.32 : geometryHeavyScene ? 0.4 : 0.48) : (largeScene ? 0.38 : geometryHeavyScene ? 0.46 : 0.55), debounce: 650 }}
        camera={{ position: inFactory ? [cameraPreset.position[0], cameraPreset.position[1] + floorElevation, cameraPreset.position[2]] : CABIN_CAM, fov: 45, near: 0.1, far: 500 }}
        gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
        style={{ background: 'transparent' }}
      >
      <PerformanceMonitor
        flipflops={3}
        onChange={({ factor }) => {
          if (forcedDevelopmentDpr === null && phase !== 'entering') {
            const low = targetFps === 120
              ? (largeScene ? 0.62 : geometryHeavyScene ? 0.7 : 0.76)
              : (largeScene ? 0.72 : geometryHeavyScene ? 0.82 : 0.84)
            const high = targetFps === 120
              ? (largeScene ? 0.95 : geometryHeavyScene ? 0.9 : 1.0)
              : (largeScene ? 1.0 : geometryHeavyScene ? 0.98 : Math.min(window.devicePixelRatio, 1.25))
            setDpr(Math.round((low + (high - low) * factor) * 100) / 100)
            if (!largeScene && factor < (targetFps === 120 ? 0.68 : 0.55)) setShadowsEnabled(false)
            if (!largeScene && factor > (targetFps === 120 ? 0.9 : 0.86)) setShadowsEnabled(true)
          }
        }}
        onFallback={() => {
          if (forcedDevelopmentDpr === null) {
            setDpr(targetFps === 120 ? (largeScene ? 0.62 : 0.76) : (largeScene ? 0.72 : 0.84))
            setShadowsEnabled(false)
          }
        }}
      />
      <DaiyuRuntime running={inFactory} targetFps={targetFps} />
      <ShadowMapGovernor active={simPlaying && shadowsEnabled} revision={shadowRevision} />
      <RunningFrameScheduler enabled={largeSceneRunning} fps={targetFps} />
      <DemandInvalidator />
      <Suspense fallback={null}>
        <FactoryScene view={view} visible={showFactory} shadowsEnabled={shadowsEnabled} activeFloor={activeFloor} visibleFloors={visibleFloors} floorCount={floorCount} showRackLabels={showRackLabels} />
      </Suspense>
      <CanvasSelectionController enabled={showFactory && view !== 'flow'} activeFloor={activeFloor} visibleFloors={visibleFloors} />

      {/* 未进厂：电梯舱 + 登录相机推镜（独占相机） */}
      {!inFactory && <ElevatorCabin />}
      {!inFactory && <LoginCameraRig />}

      {/* 已进厂：视图切换 + 用户相机控制 */}
      {inFactory && <FactoryCameraController view={view} isPlacing={isPlacing} activeFloor={activeFloor} onTransitionChange={setCameraMoving} />}
      </Canvas>}
      {unityNativeReady && <div className="fm-renderer-status" aria-label="当前三维渲染器">UNITY / {unityGraphicsApi}{unityFps === null ? '' : ` · ${Math.round(unityFps)} FPS`}</div>}
      {isDaiyuPerfOverlayEnabled() && <DaiyuPerfOverlay />}
    </>
  )
}

function isDaiyuPerfOverlayEnabled() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('daiyuPerf') === '1'
}

/** 开发压测仪表盘：通过 ?daiyuStress=500&daiyuPerf=1 开启，不进入正式界面。 */
function DaiyuPerfOverlay() {
  const [snapshot, setSnapshot] = useState<DaiyuSnapshot>(() => daiyuEngine.getSnapshot())

  useEffect(() => {
    const unsubscribe = daiyuEngine.subscribe(setSnapshot)
    return () => { unsubscribe() }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        zIndex: 10000,
        minWidth: 240,
        padding: '10px 12px',
        border: '1px solid rgba(64, 207, 188, 0.55)',
        borderRadius: 8,
        background: 'rgba(4, 24, 27, 0.88)',
        color: '#d9fff7',
        font: '12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace',
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#53e0c5', fontWeight: 700 }}>DAIYU RENDER BENCH</div>
      <div title={snapshot.gpuRenderer}>GPU {snapshot.gpuRenderer}</div>
      <div>FPS {snapshot.fps.toFixed(1)} · p95 {snapshot.p95FrameMs.toFixed(1)}ms</div>
      <div>draw {snapshot.drawCalls} · tris {formatMetric(snapshot.triangles)}</div>
      <div>geo {snapshot.geometries} · tex {snapshot.textures}</div>
      <div>detail {document.documentElement.dataset.daiyuDetailedObjects ?? '-'} · proxy {document.documentElement.dataset.daiyuProxyObjects ?? '-'}</div>
      <div style={{ color: snapshot.overBudget.length > 0 ? '#ffcf5a' : '#91f2a2' }}>
        {snapshot.overBudget.length > 0 ? `over: ${snapshot.overBudget.join(', ')}` : 'within budget'}
      </div>
    </div>
  )
}

function formatMetric(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}m` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value)
}

function ShadowMapGovernor({ active, revision }: { active: boolean; revision: string }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => { gl.shadowMap.autoUpdate = true }
  }, [gl])
  useEffect(() => { gl.shadowMap.needsUpdate = true }, [gl, revision])
  useFrame(() => { if (active) gl.shadowMap.needsUpdate = true })
  return null
}

function DemandInvalidator() {
  const invalidate = useThree((state) => state.invalidate)
  const gl = useThree((state) => state.gl)
  useEffect(() => useForgeMindStore.subscribe(() => invalidate()), [invalidate])
  useEffect(() => {
    const element = gl.domElement
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const bump = () => {
      invalidate()
      clearTimeout(graceTimer)
      graceTimer = setTimeout(() => invalidate(), 140)
      graceTimer = setTimeout(() => invalidate(), 320)
    }
    const events = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu'] as const
    for (const name of events) element.addEventListener(name, bump, { passive: true })
    return () => {
      clearTimeout(graceTimer)
      for (const name of events) element.removeEventListener(name, bump)
    }
  }, [gl, invalidate])
  return null
}

function getForcedDevelopmentDpr() {
  if (!import.meta.env.DEV) return null
  const value = Number(new URLSearchParams(window.location.search).get('daiyuDpr'))
  return Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : null
}

function RunningFrameScheduler({ enabled, fps }: { enabled: boolean; fps: number }) {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (!enabled) return
    const interval = window.setInterval(() => invalidate(), 1000 / fps)
    invalidate()
    return () => window.clearInterval(interval)
  }, [enabled, fps, invalidate])
  return null
}

function initialDprForScene(objectCount: number, targetFps: DaiyuTargetFps) {
  const native = Math.min(window.devicePixelRatio, targetFps === 120 ? 1.0 : 1.2)
  return objectCount > 120 ? Math.min(native, targetFps === 120 ? 0.85 : 0.9) : native
}

function shouldEnableShadows(objectCount: number, targetFps: DaiyuTargetFps) {
  return objectCount <= (targetFps === 120 ? 80 : 120)
}

function FactoryCameraController({ view, isPlacing, activeFloor, onTransitionChange }: { view: FactoryView; isPlacing: boolean; activeFloor: FactoryFloorId; onTransitionChange?: (moving: boolean) => void }) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const preset = CAMERA_PRESETS[view]
  const floorElevation = getFloorElevation(activeFloor)
  const destination = useMemo(() => new THREE.Vector3(preset.position[0], preset.position[1] + floorElevation, preset.position[2]), [floorElevation, preset])
  const destinationTarget = useMemo(() => new THREE.Vector3(preset.target[0], preset.target[1] + floorElevation, preset.target[2]), [floorElevation, preset])
  const transition = useRef({ active: false, startedAt: 0, duration: 1100, fromPosition: new THREE.Vector3(), fromTarget: new THREE.Vector3(), distance: 0 })

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
    onTransitionChange?.(state.active)
    return () => onTransitionChange?.(false)
  }, [activeFloor, camera, destination, destinationTarget, view, onTransitionChange])

  useFrame(() => {
    const state = transition.current
    const controls = controlsRef.current
    if (!controls) return
    if (!state.active) { controls.enabled = !isPlacing; return }
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
      onTransitionChange?.(false)
    }
  })

  return <OrbitControls ref={controlsRef} makeDefault enabled={!isPlacing} enablePan screenSpacePanning={false} enableDamping dampingFactor={0.08} maxPolarAngle={view === 'build' ? Math.PI / 2.02 : Math.PI / 2.05} minDistance={6} maxDistance={120} />
}
