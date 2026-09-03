import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { objectToWorld } from '../../game/grid'
import type { BuildType, FactoryObject } from '../../game/types'
import type { DroneRuntimeSnapshot } from '../../game/simulation'
import type { AgvRuntimeSnapshot } from '../../game/simulation'
import { NON_VEHICLE_BUILDING_VISUAL_SCALE, PRODUCTION_MACHINE_VISUAL_SCALE } from '../../scene/industrialVisualScale'

const UP = new THREE.Vector3(0, 1, 0)
const SCALE_ONE = new THREE.Vector3(1, 1, 1)
const STATIC_SPATIAL_CELL_SIZE = 18

const STATIC_MODEL_SPECS: Partial<Record<BuildType, {
  path: string
  targetFootprint: number
  targetHeight: number
  rotationOffsetY?: number
  baseY?: number
  sourceObjectName?: string
  groundReferenceName?: string
}>> = {
  machine: {
    path: '/models/industrial/realvirtual_high_detail.glb',
    targetFootprint: 1.3 * PRODUCTION_MACHINE_VISUAL_SCALE,
    targetHeight: 1.2 * PRODUCTION_MACHINE_VISUAL_SCALE,
  },
  agv: {
    path: '/models/forgecore/forgecore_agv.glb',
    targetFootprint: 1.85,
    targetHeight: 1.35,
    sourceObjectName: 'GeoContainer_572__16_36',
  },
  drone: {
    path: '/models/forgecore/forgecore_drone.glb',
    targetFootprint: 2.25,
    targetHeight: 1.8,
    baseY: 1.45,
  },
  press: {
    path: '/models/industrial/hydraulic_press_detail.glb',
    targetFootprint: 1.72 * PRODUCTION_MACHINE_VISUAL_SCALE,
    targetHeight: 1.6 * PRODUCTION_MACHINE_VISUAL_SCALE,
  },
  washing: {
    path: '/models/industrial/wash_deburr_detail.glb',
    targetFootprint: 1.7 * PRODUCTION_MACHINE_VISUAL_SCALE,
    targetHeight: 1.45 * PRODUCTION_MACHINE_VISUAL_SCALE,
    groundReferenceName: 'WEld_Table_Custom_1600X900__(1)-1',
  },
  storage: {
    path: '/models/industrial/pallet_buffer_detail.glb',
    targetFootprint: 1.7 * NON_VEHICLE_BUILDING_VISUAL_SCALE,
    targetHeight: 1.35 * NON_VEHICLE_BUILDING_VISUAL_SCALE,
  },
}

interface StaticBatch {
  key: string
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  matrices: THREE.Matrix4[]
}

interface AgvRenderMotion {
  x: number
  y?: number
  z: number
  headingY: number
}

type DynamicRenderSnapshot = Pick<AgvRuntimeSnapshot, 'headingY'> | Pick<DroneRuntimeSnapshot, 'headingY'>

/** 原模型精度不变的静态设备合批，适用于重复出现且模型本体不变形的设备。 */
export const DaiyuStaticModelBatch = memo(function DaiyuStaticModelBatch({
  type,
  objects,
  motion,
  running = true,
  castShadows = true,
  onSelect,
}: {
  type: 'machine' | 'agv' | 'drone' | 'press' | 'washing' | 'storage'
  objects: FactoryObject[]
  motion?: ReadonlyMap<string, DynamicRenderSnapshot & { position: { x: number; y?: number; z: number } }>
  running?: boolean
  castShadows?: boolean
  onSelect?: (id: string) => void
}) {
  const spec = STATIC_MODEL_SPECS[type]!
  const gltf = useGLTF(spec.path)
  const refs = useRef(new Map<string, THREE.InstancedMesh>())
  const normalized = useMemo(
    () => normalizeStaticModel(gltf.scene, spec.targetFootprint, spec.targetHeight, spec.rotationOffsetY ?? 0, spec.sourceObjectName, spec.groundReferenceName),
    [gltf.scene, spec.groundReferenceName, spec.rotationOffsetY, spec.sourceObjectName, spec.targetFootprint, spec.targetHeight],
  )
  const batches = useMemo(() => collectStaticBatches(normalized), [normalized])
  const objectGroups = useMemo(
    () => type === 'agv' || type === 'drone' ? [{ key: 'all', objects }] : partitionObjects(objects),
    [objects, type],
  )
  const visualMotionRef = useRef(new Map<string, AgvRenderMotion>())
  const targetMotionRef = useRef(new Map<string, AgvRenderMotion>())
  const rootMatrixRef = useRef(new THREE.Matrix4())
  const instanceMatrixRef = useRef(new THREE.Matrix4())

  useLayoutEffect(() => {
    objectGroups.forEach((objectGroup) => {
      batches.forEach((batch) => {
        const mesh = refs.current.get(`${objectGroup.key}:${batch.key}`)
        if (!mesh) return
        let instance = 0
        objectGroup.objects.forEach((object) => {
          const root = objectMatrix(object, spec.baseY ?? 0)
          batch.matrices.forEach((local) => {
            mesh.setMatrixAt(instance, root.clone().multiply(local))
            instance += 1
          })
        })
        mesh.count = instance
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
        mesh.frustumCulled = type !== 'agv' && type !== 'drone'
      })
    })
  }, [batches, objectGroups, spec.baseY, type])

  useLayoutEffect(() => {
    if ((type !== 'agv' && type !== 'drone') || !motion) return
    const target = targetMotionRef.current
    const visual = visualMotionRef.current
    const activeIds = new Set<string>()

    motion.forEach((runtime, objectId) => {
      activeIds.add(objectId)
      const next = { x: runtime.position.x, y: runtime.position.y, z: runtime.position.z, headingY: runtime.headingY }
      target.set(objectId, next)
      if (!visual.has(objectId)) visual.set(objectId, { ...next })
    })

    for (const objectId of target.keys()) {
      if (!activeIds.has(objectId)) {
        target.delete(objectId)
        visual.delete(objectId)
      }
    }
  }, [motion, type])

  useFrame((_, delta) => {
    if (!running || (type !== 'agv' && type !== 'drone') || targetMotionRef.current.size === 0) return
    // The simulation publishes snapshots at 20Hz. Exponential smoothing keeps
    // the render transform continuous at the display frame rate without
    // changing the authoritative simulation position.
    const alpha = 1 - Math.exp(-Math.min(delta, 0.1) / 0.085)
    const visual = visualMotionRef.current
    const target = targetMotionRef.current
    const rootMatrix = rootMatrixRef.current
    const instanceMatrix = instanceMatrixRef.current

    target.forEach((next, objectId) => {
      const current = visual.get(objectId)
      if (!current) {
        visual.set(objectId, { ...next })
        return
      }
      current.x += (next.x - current.x) * alpha
      if (next.y !== undefined && current.y !== undefined) current.y += (next.y - current.y) * alpha
      current.z += (next.z - current.z) * alpha
      current.headingY += shortestAngleDelta(current.headingY, next.headingY) * alpha
    })

    objectGroups.forEach((objectGroup) => {
      batches.forEach((batch) => {
        const mesh = refs.current.get(`${objectGroup.key}:${batch.key}`)
        if (!mesh) return
        let instance = 0
        objectGroup.objects.forEach((object) => {
          const runtime = visual.get(object.id)
          const root = runtime
            ? objectMatrix(object, spec.baseY ?? 0, { x: runtime.x, y: runtime.y, z: runtime.z }, runtime.headingY, rootMatrix)
            : objectMatrix(object, spec.baseY ?? 0, undefined, undefined, rootMatrix)
          batch.matrices.forEach((local) => {
            instanceMatrix.multiplyMatrices(root, local)
            mesh.setMatrixAt(instance, instanceMatrix)
            instance += 1
          })
        })
        mesh.instanceMatrix.needsUpdate = true
      })
    })

  })

  const selectFromBatch = (groupObjects: FactoryObject[], localCount: number) => (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = groupObjects[Math.floor(event.instanceId / localCount)]
    if (object) onSelect(object.id)
  }

  return (
    <group name={`daiyu-batch:${type}`} dispose={null}>
      {objectGroups.flatMap((objectGroup) => batches.map((batch) => (
        <instancedMesh
          key={`${objectGroup.key}:${batch.key}`}
          ref={(mesh) => {
            const refKey = `${objectGroup.key}:${batch.key}`
            if (mesh) refs.current.set(refKey, mesh)
            else refs.current.delete(refKey)
          }}
          args={[batch.geometry, batch.material, Math.max(objectGroup.objects.length * batch.matrices.length, 1)]}
          visible={objectGroup.objects.length > 0}
          castShadow={castShadows}
          receiveShadow
          onClick={onSelect && type !== 'drone' ? selectFromBatch(objectGroup.objects, batch.matrices.length) : undefined}
        />
      )))}
      {type === 'drone' && onSelect && objects.map((object) => {
        const runtime = motion?.get(object.id)
        const world = runtime?.position ?? objectToWorld(object)
        return (
          <mesh
            key={`selection:${object.id}`}
            name={`daiyu-drone-selection-hitbox:${object.id}`}
            position={[world.x, (runtime?.position.y ?? (spec.baseY ?? 0)) + spec.targetHeight / 2, world.z]}
            rotation={[0, runtime?.headingY ?? rotationAngle(object.rotation), 0]}
            frustumCulled={false}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(object.id)
            }}
          >
            <boxGeometry args={[spec.targetFootprint * 1.2, spec.targetHeight * 1.25, spec.targetFootprint * 1.2]} />
            <meshBasicMaterial transparent opacity={0.001} depthWrite={false} colorWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
})

function normalizeStaticModel(source: THREE.Group, targetFootprint: number, targetHeight: number, rotationOffsetY: number, sourceObjectName?: string, groundReferenceName?: string) {
  source.updateMatrixWorld(true)
  const scene = new THREE.Group()
  const sourceObject = sourceObjectName ? (source.getObjectByName(sourceObjectName) ?? source) : source
  const clone = sourceObject?.clone(true)
  if (clone) {
    // Keep the selected node's world transform while dropping ForgeCore's
    // display floor and unrelated showcase geometry from the AGV scene.
    clone.matrix.copy(sourceObject.matrixWorld)
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale)
    scene.add(clone)
  }
  scene.position.set(0, 0, 0)
  scene.rotation.set(0, rotationOffsetY, 0)
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const scale = Math.min(targetFootprint / Math.max(size.x, size.z, 0.0001), targetHeight / Math.max(size.y, 0.0001))
  scene.scale.setScalar(scale)
  scene.updateMatrixWorld(true)
  const normalized = new THREE.Box3().setFromObject(scene)
  // The washing GLB contains a cable/harness helper whose vertices start at
  // the source origin even though the visible equipment body starts higher.
  // Use the authored body node as the floor reference so the body is not
  // rendered in the air. Other assets keep the complete normalized bounds.
  const groundReference = groundReferenceName ? scene.getObjectByName(groundReferenceName) : null
  const groundBox = groundReference ? new THREE.Box3().setFromObject(groundReference) : normalized
  const center = normalized.getCenter(new THREE.Vector3())
  scene.position.set(-center.x, -groundBox.min.y, -center.z)
  scene.updateMatrixWorld(true)
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    node.castShadow = true
    node.receiveShadow = true
  })
  return scene
}

function collectStaticBatches(scene: THREE.Group) {
  const grouped = new Map<string, StaticBatch>()
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const key = `${node.geometry.uuid}:${materials.map((material) => material.uuid).join(',')}`
    const existing = grouped.get(key)
    if (existing) {
      existing.matrices.push(node.matrixWorld.clone())
      return
    }
    grouped.set(key, {
      key,
      geometry: node.geometry,
      material: node.material,
      matrices: [node.matrixWorld.clone()],
    })
  })
  return [...grouped.values()]
}

function objectMatrix(object: FactoryObject, baseY = 0, position?: { x: number; y?: number; z: number }, headingY?: number, target = new THREE.Matrix4()) {
  const world = position ?? objectToWorld(object)
  return target.compose(
    new THREE.Vector3(world.x, position?.y ?? baseY, world.z),
    new THREE.Quaternion().setFromAxisAngle(UP, headingY ?? rotationAngle(object.rotation)),
    SCALE_ONE,
  )
}

function shortestAngleDelta(from: number, to: number) {
  const delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI
  return delta < -Math.PI ? delta + Math.PI * 2 : delta
}

function rotationAngle(rotation: FactoryObject['rotation']) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}

function partitionObjects(objects: FactoryObject[]) {
  const grouped = new Map<string, FactoryObject[]>()
  for (const object of objects) {
    const world = objectToWorld(object)
    const cellX = Math.floor(world.x / STATIC_SPATIAL_CELL_SIZE)
    const cellZ = Math.floor(world.z / STATIC_SPATIAL_CELL_SIZE)
    const key = `${cellX}:${cellZ}`
    const group = grouped.get(key)
    if (group) group.push(object)
    else grouped.set(key, [object])
  }
  return [...grouped.entries()].map(([key, cellObjects]) => ({ key, objects: cellObjects }))
}
