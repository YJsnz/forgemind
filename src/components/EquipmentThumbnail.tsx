import { Bounds } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { OBJECT_DEFS } from '../game/types'
import type { BuildType } from '../game/types'
import { EquipmentModel } from '../scene/EquipmentModel'

export function EquipmentThumbnail({ type }: { type: BuildType }) {
  const equipment = OBJECT_DEFS[type]

  return (
    <span className="fm-equipment-visual" aria-hidden="true">
      <Canvas
        dpr={[1, 1.35]}
        frameloop="demand"
        camera={{ position: [3.6, 2.5, 4.4], fov: 30, near: 0.05, far: 80 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      >
        <ambientLight intensity={1.15} />
        <hemisphereLight args={['#ffffff', '#65726e', 1.35]} />
        <directionalLight position={[4, 7, 5]} intensity={2.2} />
        <directionalLight position={[-4, 2, -3]} intensity={0.75} color="#8bd3cf" />
        <Bounds fit clip observe margin={1.18}>
          <group rotation={[0, -Math.PI / 12, 0]}>
            <EquipmentModel
              type={type}
              color={equipment.color}
              accent={equipment.accent}
              height={equipment.height}
            />
          </group>
        </Bounds>
      </Canvas>
      <span className="fm-equipment-visual-grid" />
      <span className="fm-equipment-visual-label">FRONT / {equipment.model}</span>
    </span>
  )
}
