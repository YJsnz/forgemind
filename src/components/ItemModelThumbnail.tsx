import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three-stdlib'

interface Props {
  modelPath?: string
}

/**
 * Render the generated PNG preview for small inventory thumbnails.
 *
 * A GLB renderer is only created if the preview is unavailable. This keeps
 * inventory panels from creating many WebGL contexts next to the main scene.
 */
export function ItemModelThumbnail({ modelPath }: Props) {
  const mountRef = useRef<HTMLSpanElement>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [hasError, setHasError] = useState(!modelPath)

  useEffect(() => {
    setPreviewFailed(false)
    setHasError(!modelPath)
  }, [modelPath])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !modelPath || !previewFailed) return

    let disposed = false
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(1)
    renderer.setSize(32, 32, false)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.replaceChildren(renderer.domElement)

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xf4fbf8, 0x55706a, 2.2))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
    keyLight.position.set(2, 4, 3)
    scene.add(keyLight)

    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100)
    const loader = new GLTFLoader()
    loader.load(
      `/models/forgecore/items/${modelPath}`,
      (gltf) => {
        if (disposed) return

        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z, 0.001)
        model.position.sub(center)
        model.scale.setScalar(1.5 / maxDim)
        model.rotation.y = -0.55
        model.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = false
            node.receiveShadow = false
          }
        })
        scene.add(model)
        camera.position.set(2.15, 1.65, 2.15)
        camera.lookAt(0, 0, 0)
        renderer.render(scene, camera)
        setHasError(false)
      },
      undefined,
      () => {
        if (!disposed) setHasError(true)
      },
    )

    return () => {
      disposed = true
      renderer.dispose()
      mount.replaceChildren()
    }
  }, [modelPath, previewFailed])

  return (
    <span className="fm-item-model-thumbnail" aria-hidden="true">
      {!modelPath ? <span className="fm-item-model-fallback">◇</span> : !previewFailed ? <img className="fm-item-model-preview" src={`/models/forgecore/items/previews/${modelPath.replace(/\.glb$/iu, '.png')}`} alt="" onError={() => setPreviewFailed(true)} /> : <span ref={mountRef} className="fm-item-model-canvas" />}
      {previewFailed && hasError && <span className="fm-item-model-fallback">◇</span>}
    </span>
  )
}
