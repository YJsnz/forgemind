import { useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'

export function ImportedFactoryModel({ path, targetWidth, targetHeight, visible = true }: { path: string; targetWidth: number; targetHeight: number; visible?: boolean }) {
  const gltf = useGLTF(path)
  const normalized = useMemo(() => {
    const scene = gltf.scene.clone(true)
    // GLB files may carry a non-zero root transform and nested node offsets.
    // Start from a clean local frame so the preview's ground is authoritative.
    scene.position.set(0, 0, 0)
    scene.rotation.set(0, 0, 0)
    scene.scale.set(1, 1, 1)
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const scale = Math.min(targetWidth / Math.max(size.x, size.z, 0.0001), targetHeight / Math.max(size.y, 0.0001))
    scene.scale.setScalar(scale)
    // Box3 reads world-space bounds. Refresh after scaling, otherwise a GLB
    // whose geometry starts above its origin is normalized from stale bounds
    // and appears to float above the preview floor.
    scene.updateMatrixWorld(true)
    const normalizedBox = new THREE.Box3().setFromObject(scene)
    const center = normalizedBox.getCenter(new THREE.Vector3())
    scene.position.set(-center.x, -normalizedBox.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true
        node.receiveShadow = true
      }
    })
    return scene
  }, [gltf, targetWidth, targetHeight])

  return <group visible={visible}><primitive object={normalized} /></group>
}
