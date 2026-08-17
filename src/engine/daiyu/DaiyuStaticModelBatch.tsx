import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { objectToWorld } from '../../game/grid'
import type { BuildType, FactoryObject } from '../../game/types'

const UP = new THREE.Vector3(0, 1, 0)
const SCALE_ONE = new THREE.Vector3(1, 1, 1)

const STATIC_MODEL_SPECS: Partial<Record<BuildType, {
  path: string
  targetFootprint: number
  targetHeight: number
  rotationOffsetY?: number
}>> = {
  machine: {
    path: '/models/industrial/realvirtual_high_detail.glb',
    targetFootprint: 1.3,
    targetHeight: 1.2,
  },
  agv: {
    path: '/models/forklift_agv.glb',
    targetFootprint: 1.7,
    targetHeight: 1.35,
  },
  press: {
    path: '/models/industrial/hydraulic_press_detail.glb',
    targetFootprint: 1.72,
    targetHeight: 1.6,
  },
  washing: {
    path: '/models/industrial/wash_deburr_detail.glb',
    targetFootprint: 1.7,
    targetHeight: 1.45,
  },
  storage: {
    path: '/models/industrial/pallet_buffer_detail.glb',
    targetFootprint: 1.7,
    targetHeight: 1.35,
  },
}

interface StaticBatch {
  key: string
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  matrices: THREE.Matrix4[]
}

/** 原模型精度不变的静态设备合批，适用于重复出现且模型本体不变形的设备。 */
export const DaiyuStaticModelBatch = memo(function DaiyuStaticModelBatch({
  type,
  objects,
  castShadows = true,
  onSelect,
}: {
  type: 'machine' | 'agv' | 'press' | 'washing' | 'storage'
  objects: FactoryObject[]
  castShadows?: boolean
  onSelect: (id: string) => void
}) {
  const spec = STATIC_MODEL_SPECS[type]!
  const gltf = useGLTF(spec.path)
  const refs = useRef(new Map<string, THREE.InstancedMesh>())
  const normalized = useMemo(
    () => normalizeStaticModel(gltf.scene, spec.targetFootprint, spec.targetHeight, spec.rotationOffsetY ?? 0),
    [gltf.scene, spec.rotationOffsetY, spec.targetFootprint, spec.targetHeight],
  )
  const batches = useMemo(() => collectStaticBatches(normalized), [normalized])

  useLayoutEffect(() => {
    batches.forEach((batch) => {
      const mesh = refs.current.get(batch.key)
      if (!mesh) return
      let instance = 0
      objects.forEach((object) => {
        const root = objectMatrix(object)
        batch.matrices.forEach((local) => {
          mesh.setMatrixAt(instance, root.clone().multiply(local))
          instance += 1
        })
      })
      mesh.count = instance
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [batches, objects])

  const selectFromBatch = (localCount: number) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = objects[Math.floor(event.instanceId / localCount)]
    if (object) onSelect(object.id)
  }

  return (
    <group name={`daiyu-batch:${type}`} dispose={null}>
      {batches.map((batch) => (
        <instancedMesh
          key={batch.key}
          ref={(mesh) => {
            if (mesh) refs.current.set(batch.key, mesh)
            else refs.current.delete(batch.key)
          }}
          args={[batch.geometry, batch.material, Math.max(objects.length * batch.matrices.length, 1)]}
          visible={objects.length > 0}
          castShadow={castShadows}
          receiveShadow
          onClick={selectFromBatch(batch.matrices.length)}
        />
      ))}
    </group>
  )
})

function normalizeStaticModel(source: THREE.Group, targetFootprint: number, targetHeight: number, rotationOffsetY: number) {
  const scene = source.clone(true)
  scene.position.set(0, 0, 0)
  scene.rotation.set(0, rotationOffsetY, 0)
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const scale = Math.min(targetFootprint / Math.max(size.x, size.z, 0.0001), targetHeight / Math.max(size.y, 0.0001))
  scene.scale.setScalar(scale)
  scene.updateMatrixWorld(true)
  const normalized = new THREE.Box3().setFromObject(scene)
  const center = normalized.getCenter(new THREE.Vector3())
  scene.position.set(-center.x, -normalized.min.y, -center.z)
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

function objectMatrix(object: FactoryObject) {
  const world = objectToWorld(object)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(world.x, 0, world.z),
    new THREE.Quaternion().setFromAxisAngle(UP, rotationAngle(object.rotation)),
    SCALE_ONE,
  )
}

function rotationAngle(rotation: FactoryObject['rotation']) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}

Object.values(STATIC_MODEL_SPECS).forEach((spec) => {
  if (spec) useGLTF.preload(spec.path)
})
