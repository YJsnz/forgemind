import { useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'

const PATH = '/models/industrial/roller_conveyor_segment.glb'
const TINT = { body: '#5b9b99', accent: '#82d0c7' }

/** The normalized conveyor asset used by build-mode conveyor objects. */
export function FormalConveyorSegment({ targetFootprint = 1.05, targetHeight = 0.52 }: { targetFootprint?: number; targetHeight?: number }) {
  const gltf = useGLTF(PATH)
  const normalized = useMemo(() => {
    const scene = gltf.scene.clone(true)
    // The source asset's long axis is Z; build conveyors run along +X.
    scene.position.set(0, 0, 0)
    scene.rotation.set(0, Math.PI / 2, 0)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const scale = Math.min(
      targetFootprint / Math.max(size.x, size.z, 0.0001),
      targetHeight / Math.max(size.y, 0.0001),
    )
    scene.scale.setScalar(scale)
    scene.updateMatrixWorld(true)
    const normalizedBox = new THREE.Box3().setFromObject(scene)
    const center = normalizedBox.getCenter(new THREE.Vector3())
    scene.position.set(-center.x, -normalizedBox.min.y, -center.z)
    scene.updateMatrixWorld(true)
    const finalBox = new THREE.Box3().setFromObject(scene)
    const totalVol = Math.max(size.x * size.y * size.z, 0.0001)
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.castShadow = true
      node.receiveShadow = true
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      const isBelt = node.name.toLowerCase().includes('belt') || materials.some((material) => material?.name?.toLowerCase().includes('conveyorbelt') || material?.name?.toLowerCase().includes('rubber'))
      if (isBelt) {
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
        return
      }
      const meshBox = new THREE.Box3().setFromObject(node)
      const meshSize = meshBox.getSize(new THREE.Vector3())
      const meshVol = meshSize.x * meshSize.y * meshSize.z
      const meshCenter = meshBox.getCenter(new THREE.Vector3())
      const relY = (meshCenter.y - finalBox.min.y) / Math.max(finalBox.max.y - finalBox.min.y, 0.0001)
      const isSmallDetail = meshVol / totalVol < 0.012
      const isTopBand = relY > 0.82
      const pickColor = (isSmallDetail || isTopBand) ? TINT.accent : TINT.body
      const applyTint = (material: THREE.Material): THREE.MeshStandardMaterial => {
        const base = (material && (material as THREE.MeshStandardMaterial).isMeshStandardMaterial)
          ? (material.clone() as THREE.MeshStandardMaterial)
          : new THREE.MeshStandardMaterial()
        base.color.set(pickColor)
        if (!Number.isFinite(base.roughness)) base.roughness = 0.62
        if (!Number.isFinite(base.metalness)) base.metalness = 0.55
        base.needsUpdate = true
        return base
      }
      node.material = Array.isArray(node.material)
        ? node.material.map(applyTint)
        : applyTint(node.material)
    })
    return scene
  }, [gltf, targetFootprint, targetHeight])

  return <primitive object={normalized} />
}

useGLTF.preload(PATH)
