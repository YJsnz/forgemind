import { useRef } from 'react'
import * as THREE from 'three'

/**
 * 网格地面 —— Day 1 的 CAD 网格基底（§1.3「CAD 坐标系参考线」）
 * 后续网格建造系统（Day 2）直接在它上面做放置与碰撞。
 *
 * 结构：一块接收阴影的地面 + 主网格线 + 十字坐标轴（X 红 / Z 蓝 / Y 绿）。
 */
export function GridFloor() {
  const groundRef = useRef<THREE.Mesh>(null)

  return (
    <group>
      {/* 地面底 —— 只接收阴影，不遮挡网格线 */}
      <mesh
        ref={groundRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#c9cfcc" roughness={1} metalness={0} />
      </mesh>

      {/* 主网格 —— 每格 1m，中心十字线用强调色 */}
      <gridHelper
        args={[200, 200, '#9ca6a2', '#c2c9c6']}
        position={[0, 0, 0]}
      />

      {/* 十字坐标轴 —— 暗示「工业数模软件」 */}
      <axesHelper args={[6]} position={[0, 0.01, 0]} />
    </group>
  )
}
