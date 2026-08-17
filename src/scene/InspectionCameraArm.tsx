import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { URDFRobot } from 'urdf-loader'
import {
  createDlsIk,
  END_LINK,
  loadPandaTemplate,
  normalizeRobot,
  readInput,
  setHome,
} from './PandaArmModel'
import { INSPECTION_STATION, inspectionRegistry } from './inspectionRegistry'
import { runInspection } from './inspectionDetect'

/** 相机相对末端工具的偏移（站点局部坐标） */
const CAMERA_OFFSET = new THREE.Vector3(0, 0.06, 0.16)
const MANUAL_SPEED = 0.18
const WORKSPACE = { halfXZ: 0.5, yMin: 0.1, yMax: 1.15 }
/** 环绕扫描参数（竖直弧线：在夹取臂对面的 +x 侧上下扫动，永不跨到夹取臂一侧 → 不穿模） */
const ORBIT_RADIUS = 0.22
const ORBIT_ARC = (75 * Math.PI) / 180
const ORBIT_SPEED = 0.6
/** 环绕开始多久后触发实时检测（等相机到位、货物清晰进视野） */
const DETECT_DELAY = 1.6

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type CamMode = 'standby' | 'orbit' | 'returning'

/**
 * 质检摄像头机械臂：360° 全方位环绕悬空货物检测。
 * 货物进视野即实时自动检测（跑全部检测项）→ 出结果后归位。
 * 空闲时手柄/键盘手动控制。
 */
export function InspectionCameraArm() {
  const [robot, setRobot] = useState<URDFRobot | null>(null)
  const stationRef = useRef<THREE.Group>(null)
  const armRef = useRef<THREE.Group>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const targetPos = useRef(new THREE.Vector3())
  const targetQuat = useRef(new THREE.Quaternion())
  const homePose = useRef<{ x: number; y: number; z: number; q: THREE.Quaternion } | null>(null)
  const initialized = useRef(false)
  const mode = useRef<CamMode>('standby')
  const orbitTime = useRef(0)
  const detectFired = useRef(false)
  const stationPos = useMemo(
    () => new THREE.Vector3(INSPECTION_STATION.pos.x, 0, INSPECTION_STATION.pos.z),
    [],
  )
  const ik = useMemo(() => (robot ? createDlsIk(robot) : null), [robot])

  // 加载 Panda 模板 → 归一化 → 挂相机到末端
  useEffect(() => {
    let disposed = false
    loadPandaTemplate()
      .then((template) => {
        if (disposed) return
        const loaded = template.clone(true) as URDFRobot
        normalizeRobot(loaded)
        setHome(loaded)
        loaded.updateMatrixWorld(true)

        const cam = new THREE.PerspectiveCamera(45, 1, 0.03, 60)
        cameraRef.current = cam
        inspectionRegistry.camera = cam
        stationRef.current?.add(cam)

        // 摄像头臂：藏掉夹爪手指，末端加相机本体
        loaded.traverse((node) => {
          if (node.name.includes('finger')) node.visible = false
        })
        const end = loaded.links[END_LINK]
        if (end) {
          const housing = new THREE.Group()
          housing.name = 'inspection-camera-housing'
          housing.position.set(0.02, 0.05, 0.1)
          const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.06, 0.09),
            new THREE.MeshStandardMaterial({ color: '#2b3133', roughness: 0.4, metalness: 0.5 }),
          )
          const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.028, 0.028, 0.03, 20),
            new THREE.MeshStandardMaterial({ color: '#14181a', roughness: 0.15, metalness: 0.85 }),
          )
          lens.rotation.x = Math.PI / 2
          lens.position.z = 0.06
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.03, 0.008, 8, 24),
            new THREE.MeshStandardMaterial({ color: '#5b9b99', roughness: 0.3, metalness: 0.6 }),
          )
          ring.position.z = 0.05
          housing.add(body, lens, ring)
          end.add(housing)
        }
        setRobot(loaded)
      })
      .catch(() => {})
    return () => {
      disposed = true
      inspectionRegistry.camera = null
    }
  }, [])

  // 键盘/手柄输入集
  useEffect(() => {
    const keys = new Set<string>()
    const onDown = (event: KeyboardEvent) => keys.add(event.code)
    const onUp = (event: KeyboardEvent) => keys.delete(event.code)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    ;(window as Window & { __forgeKeys?: Set<string> }).__forgeKeys = keys
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  useFrame((_, delta) => {
    if (!stationRef.current || !armRef.current || !robot || !ik) return
    robot.updateMatrixWorld(true)
    const end = robot.links[END_LINK]
    if (!end) return

    if (!initialized.current) {
      setHome(robot)
      robot.updateMatrixWorld(true)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
      homePose.current = {
        x: targetPos.current.x,
        y: targetPos.current.y,
        z: targetPos.current.z,
        q: targetQuat.current.clone(),
      }
      initialized.current = true
      return
    }

    const phase = inspectionRegistry.phase
    const verdict = inspectionRegistry.lastVerdict
    // 环绕中心 = 货物实际位置（夹取爪举着），否则退回检测位
    const centerLocal = inspectionRegistry.heldPartPos ?? INSPECTION_STATION.inspectPoseLocal

    if (phase === 'inspecting' && verdict === null) {
      // 环绕扫描：在夹取臂对面的 +x 侧，绕悬空货物做竖直弧线扫动（永不跨到夹取臂一侧 → 不穿模）
      if (mode.current !== 'orbit') {
        mode.current = 'orbit'
        orbitTime.current = 0
        detectFired.current = false
      }
      orbitTime.current += delta
      const alpha = ORBIT_ARC * Math.sin(orbitTime.current * ORBIT_SPEED)
      const orbitPos = new THREE.Vector3(
        centerLocal.x + ORBIT_RADIUS * Math.cos(alpha),
        centerLocal.y + ORBIT_RADIUS * Math.sin(alpha),
        centerLocal.z,
      )
      targetPos.current.copy(stationRef.current.localToWorld(orbitPos))
      if (homePose.current) targetQuat.current.copy(homePose.current.q)
      ik.solve(targetPos.current, targetQuat.current, 6)

      // 实时检测：环绕开始后相机到位即自动识别一次（跑全部检测项）
      if (!detectFired.current && orbitTime.current > DETECT_DELAY) {
        detectFired.current = true
        void runInspection()
      }
    } else if (verdict !== null) {
      // 出结果 → 摄像头臂归位
      mode.current = 'returning'
      if (homePose.current) {
        const homeV = new THREE.Vector3(homePose.current.x, homePose.current.y, homePose.current.z)
        targetPos.current.lerp(homeV, Math.min(1, delta * 2.5))
        targetQuat.current.copy(homePose.current.q)
        ik.solve(targetPos.current, targetQuat.current, 4)
        if (targetPos.current.distanceTo(homeV) < 0.04) mode.current = 'standby'
      }
    } else {
      // 空闲：手动控制（无输入则停在原位）
      mode.current = 'standby'
      const input = readInput()
      const hasInput =
        input.move.x !== 0 || input.move.y !== 0 || input.move.z !== 0 ||
        input.rot.pitch !== 0 || input.rot.yaw !== 0 || input.rot.roll !== 0
      if (input.resetEdge && homePose.current) {
        targetPos.current.set(homePose.current.x, homePose.current.y, homePose.current.z)
        targetQuat.current.copy(homePose.current.q)
        ik.solve(targetPos.current, targetQuat.current, 4)
      } else if (hasInput) {
        targetPos.current.x += input.move.x * MANUAL_SPEED * delta
        targetPos.current.y += input.move.y * MANUAL_SPEED * delta
        targetPos.current.z += input.move.z * MANUAL_SPEED * delta
        if (homePose.current) {
          targetPos.current.x = clamp(targetPos.current.x, homePose.current.x - WORKSPACE.halfXZ, homePose.current.x + WORKSPACE.halfXZ)
          targetPos.current.z = clamp(targetPos.current.z, homePose.current.z - WORKSPACE.halfXZ, homePose.current.z + WORKSPACE.halfXZ)
        }
        targetPos.current.y = clamp(targetPos.current.y, WORKSPACE.yMin, WORKSPACE.yMax)
        const euler = new THREE.Euler(
          input.rot.pitch * 0.85 * delta,
          input.rot.yaw * 0.85 * delta,
          input.rot.roll * 0.85 * delta,
          'XYZ',
        )
        targetQuat.current.premultiply(new THREE.Quaternion().setFromEuler(euler)).normalize()
        ik.solve(targetPos.current, targetQuat.current, 3)
      }
    }

    // 相机：位置跟随末端，朝向悬空货物（lookAt 需世界坐标）
    const cam = cameraRef.current
    if (cam && stationRef.current) {
      const worldEnd = new THREE.Vector3()
      end.getWorldPosition(worldEnd)
      stationRef.current.worldToLocal(worldEnd)
      cam.position.copy(worldEnd).add(CAMERA_OFFSET)
      const targetWorld = stationRef.current.localToWorld(centerLocal.clone())
      cam.lookAt(targetWorld)
      cam.updateMatrixWorld(true)
    }
  })

  return (
    <group ref={stationRef} position={stationPos.toArray()}>
      <group ref={armRef} position={INSPECTION_STATION.armLocal.toArray()}>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.26, 0.1, 24]} />
          <meshStandardMaterial color="#4b5559" roughness={0.5} metalness={0.35} />
        </mesh>
        {robot && <primitive object={robot} />}
      </group>
    </group>
  )
}
