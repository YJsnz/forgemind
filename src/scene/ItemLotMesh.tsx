import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useForgeMindStore } from '../store/forgeMind'
import type { ItemLot } from '../game/simulation'
import { gridToWorld } from '../game/grid'
import { rotationToDir } from '../game/dir'

/**
 * 在途物品（ItemLot）渲染（Day 5）。
 * 物品沿传送带朝向插值移动：世界位置 = 传送带格中心 + dir * (offset - 0.5)。
 * offset ∈ [0,1] 表示物品从带子入口到出口的进度。
 */
export function ItemLotMesh({ lot }: { lot: ItemLot }) {
  const ref = useRef<THREE.Group>(null)
  const objects = useForgeMindStore((s) => s.objects)
  const items = useForgeMindStore((s) => s.items)

  const conveyor = objects.find((o) => o.id === lot.conveyorId)
  if (!conveyor) return null

  const item = items.find((i) => i.id === lot.itemId)
  const color = item?.color ?? '#dbe4ee'

  const dir = rotationToDir(conveyor.rotation)
  const { x: cx, z: cz } = gridToWorld(conveyor.pos)
  // offset 0 = 入口，1 = 出口；视觉上让物品居中于带子上
  const px = cx + dir.dx * (lot.offset - 0.5)
  const pz = cz + dir.dz * (lot.offset - 0.5)

  const size = 0.3

  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.getElapsedTime() * 1.8
    ref.current.position.y = 0.35 + size / 2 + Math.sin(clock.getElapsedTime() * 5 + lot.offset * 3) * 0.025
  })

  return (
    <group ref={ref} position={[px, 0.35 + size / 2, pz]}>
      <mesh castShadow>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  )
}
