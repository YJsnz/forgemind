import * as THREE from 'three'

const _AXIS_X = new THREE.Vector3(1, 0, 0)
const _AXIS_Y = new THREE.Vector3(0, 1, 0)
const _AXIS_Z = new THREE.Vector3(0, 0, 1)
const _tmpBox = new THREE.Box3()
const _tmpSize = new THREE.Vector3()

/**
 * 为从 SolidWorks STEP 转换的 GLB 模型创建程序化动画。
 * STEP 格式不含动画数据，但保留了完整的节点层级（装配结构）。
 * 通过识别节点名称中的运动部件关键词，驱动旋转/往复运动。
 */

export interface GlbAnimationController {
  update: (time: number, dt: number) => void
  parts: string[]
}

/** 从 GLB 场景中查找运动部件节点 */
function findMotionParts(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const parts = new Map<string, THREE.Object3D>()
  const keywords: Record<string, string[]> = {
    shaft: ['arbre', 'shaft', '轴', 'axe'],
    motor: ['moteur', 'motor', '电机', 'motorreducer'],
    brush: ['brosse', 'brush', '毛刷'],
    worm: ['vis sans fin', 'worm', '蜗轮', '蜗杆'],
    pulley_drive: ['poulie motrice', 'pulley motrice', '传动轮', 'pulley'],
    pulley_driven: ['poulie receptrice', 'pulley receptrice', '被动轮'],
    belt: ['courroie', 'belt', '皮带', 'band'],
    bearing: ['bearing', 'roulement', '轴承'],
    table: ['weld table', '焊接台', 'table', 'plateau'],
    cable: ['cble', 'harness', 'cable', '线缆'],
    led: ['led', 'lamp', '灯', 'voyant'],
    control_box: ['control box', '电箱', 'boitier'],
    ram: ['ram', 'piston', '冲压', 'vérin', 'cylindre'],
    press: ['press', '冲压', 'matrice'],
    roller: ['roller', '滚筒', 'rouleau'],
    impeller: ['impeller', '叶轮', 'agitateur'],
    valve: ['valve', '阀'],
    stirrer: ['stirrer', '搅拌', 'mélangeur'],
    spindle: ['spindle', '主轴', 'broche'],
  }

  root.traverse((child) => {
    if (!child.name) return
    const name = child.name.toLowerCase()
    for (const [category, kws] of Object.entries(keywords)) {
      if (kws.some((kw) => name.includes(kw.toLowerCase()))) {
        parts.set(child.name, child)
        break
      }
    }
  })
  return parts
}

/** 为 GLB 模型创建程序化动画控制器。
 *  当模型节点名无法匹配到运动部件时，回退到「整模工业氛围动画」
 *  （呼吸 + 微振动 + 绕Y慢转），保证每个 GLB 都"能运作"。
 */
export function createGlbAnimation(
  root: THREE.Object3D,
  options?: { deviceKind?: string },
): GlbAnimationController {
  const parts = findMotionParts(root)
  const partNames = Array.from(parts.keys())

  // 记录每个部件的初始旋转
  const initialRotations = new Map<string, THREE.Euler>()
  const initialPositions = new Map<string, THREE.Vector3>()
  parts.forEach((node, name) => {
    initialRotations.set(name, node.rotation.clone())
    initialPositions.set(name, node.position.clone())
  })

  // 识别不同类型的部件
  const getPartsByKeyword = (keywords: string[]) =>
    Array.from(parts.entries())
      .filter(([name]) => keywords.some((kw) => name.toLowerCase().includes(kw.toLowerCase())))
      .map(([, node]) => node)

  const shafts = getPartsByKeyword(['arbre', 'shaft', '轴', 'axe'])
  const brushes = getPartsByKeyword(['brosse', 'brush', '毛刷'])
  const worms = getPartsByKeyword(['vis sans fin', 'worm', '蜗轮', '蜗杆'])
  const drivePulleys = getPartsByKeyword(['poulie motrice', 'pulley motrice', '传动轮', 'pulley'])
  const drivenPulleys = getPartsByKeyword(['poulie receptrice', 'pulley receptrice', '被动轮'])
  const bearings = getPartsByKeyword(['bearing', 'roulement', '轴承'])
  const belts = getPartsByKeyword(['courroie', 'belt', '皮带', 'band'])
  const tables = getPartsByKeyword(['weld table', '焊接台', 'table', 'plateau'])
  const leds = getPartsByKeyword(['led', 'lamp', '灯', 'voyant'])
  const rams = getPartsByKeyword(['ram', 'piston', '冲压', 'vérin', 'cylindre'])
  const rollers = getPartsByKeyword(['roller', '滚筒', 'rouleau'])
  const impellers = getPartsByKeyword(['impeller', '叶轮', 'agitateur', 'stirrer', '搅拌', 'mélangeur'])
  const spindles = getPartsByKeyword(['spindle', '主轴', 'broche'])

  // 为每个旋转部件确定旋转轴（基于包围盒最长轴）
  const determineAxis = (node: THREE.Object3D): THREE.Vector3 => {
    _tmpBox.setFromObject(node)
    _tmpBox.getSize(_tmpSize)
    if (_tmpSize.x >= _tmpSize.y && _tmpSize.x >= _tmpSize.z) return _AXIS_X
    if (_tmpSize.y >= _tmpSize.z) return _AXIS_Y
    return _AXIS_Z
  }

  const axes = new Map<string, THREE.Vector3>()
  const speeds = new Map<string, number>()

  shafts.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 4) })
  brushes.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 12) })
  worms.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 3) })
  drivePulleys.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 6) })
  drivenPulleys.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 6) })
  bearings.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 8) })
  rollers.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 7) })
  impellers.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 5) })
  spindles.forEach((n) => { axes.set(n.uuid, determineAxis(n)); speeds.set(n.uuid, 9) })

  // 电机关联动画（带脉冲发光效果）
  const motors = getPartsByKeyword(['moteur', 'motor', '电机', 'motorreducer'])
  motors.forEach((node) => {
    // 给电机一个轻微的脉动缩放
    node.userData.isMotor = true
  })

  // 灯具闪烁
  leds.forEach((node) => {
    node.userData.isLed = true
  })

  // 焊接台往复运动
  tables.forEach((node) => {
    node.userData.isTable = true
    const initPos = initialPositions.get(node.name) ?? node.position.clone()
    node.userData.basePosition = initPos.clone()
  })

  // 液压冲压头 / 活塞 上下往复
  const ramInitPositions = new Map<string, THREE.Vector3>()
  rams.forEach((node) => {
    node.userData.isRam = true
    ramInitPositions.set(node.uuid, node.position.clone())
  })

  // 皮带波动（通过 UV 滚动模拟）
  belts.forEach((node) => {
    node.userData.isBelt = true
  })

  // 初始位置保存（用于线性运动部件）
  const tableInitPositions = new Map<string, THREE.Vector3>()
  tables.forEach((node) => {
    tableInitPositions.set(node.uuid, node.position.clone())
  })

  // Fallback 整模工业氛围动画：当找不到任何命名运动部件时启用
  const fallbackNeeded =
    parts.size === 0 ||
    (options?.deviceKind === 'storage') ||
    (options?.deviceKind === 'tank')
  const initialScale = root.scale.clone()
  const initialRotationY = root.rotation.y
  const initialPosition = root.position.clone()

  return {
    parts: partNames.length === 0 ? ['__fallback_ambient__'] : partNames,
    update(time: number, _dt: number) {
      // 驱动轴旋转
      shafts.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_X
        const speed = speeds.get(node.uuid) ?? 4
        node.quaternion.setFromAxisAngle(axis, time * speed)
      })

      // 毛刷快速旋转
      brushes.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_Z
        const speed = speeds.get(node.uuid) ?? 12
        node.quaternion.setFromAxisAngle(axis, time * speed)
      })

      // 蜗轮蜗杆
      worms.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_Z
        const speed = speeds.get(node.uuid) ?? 3
        node.quaternion.setFromAxisAngle(axis, time * speed)
      })

      // 传动轮 + 被动轮（同步反向旋转）
      drivePulleys.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_Y
        node.quaternion.setFromAxisAngle(axis, time * 6)
      })
      drivenPulleys.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_Y
        node.quaternion.setFromAxisAngle(axis, -time * 6)
      })

      // 轴承自转
      bearings.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_X
        const speed = speeds.get(node.uuid) ?? 8
        node.quaternion.setFromAxisAngle(axis, time * speed)
      })

      // 电机脉动（发光效果 + 轻微振动）
      motors.forEach((node) => {
        const pulse = 1 + Math.sin(time * 8) * 0.02
        node.scale.setScalar(pulse)
      })

      // 灯具闪烁
      leds.forEach((node) => {
        const blink = Math.sin(time * 3) * 0.5 + 0.5
        const mat = (node as THREE.Mesh).material as THREE.MeshStandardMaterial
        if (mat) {
          mat.emissiveIntensity = 0.3 + blink * 0.7
        }
      })

      // 焊接台往复运动
      tables.forEach((node) => {
        const basePos = tableInitPositions.get(node.uuid)
        if (basePos) {
          const offset = Math.sin(time * 1.5) * 0.15
          node.position.set(basePos.x, basePos.y, basePos.z + offset)
        }
      })

      // 液压冲压头 / 活塞上下往复（press/液压机）
      rams.forEach((node) => {
        const base = ramInitPositions.get(node.uuid)
        if (base) {
          const stroke = Math.max(0, Math.sin(time * 1.2)) * 0.35
          node.position.set(base.x, base.y - stroke, base.z)
        }
      })

      // 滚筒自转
      rollers.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_Z
        const speed = speeds.get(node.uuid) ?? 7
        node.quaternion.setFromAxisAngle(axis, time * speed)
      })

      // 叶轮 / 搅拌器旋转（原料药罐、搅拌类设备）
      impellers.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_Y
        const speed = speeds.get(node.uuid) ?? 5
        node.quaternion.setFromAxisAngle(axis, time * speed)
      })

      // 主轴高速旋转（数控中心/工作站等）
      spindles.forEach((node) => {
        const axis = axes.get(node.uuid) ?? _AXIS_Y
        const speed = speeds.get(node.uuid) ?? 9
        node.quaternion.setFromAxisAngle(axis, time * speed)
      })

      // Fallback：整模工业氛围（呼吸缩放 + 微振动 + 绕Y慢转）
      if (fallbackNeeded) {
        const breathe = 1 + Math.sin(time * 1.6) * 0.012
        root.scale.set(initialScale.x * breathe, initialScale.y * breathe, initialScale.z * breathe)
        root.rotation.y = initialRotationY + Math.sin(time * 0.35) * 0.05
        root.position.x = initialPosition.x + Math.sin(time * 22) * 0.004
        root.position.z = initialPosition.z + Math.cos(time * 26) * 0.004
      }
    },
  }
}

/**
 * 为任意 GLB 设备（来自 step_to_gltf 文件夹的真实 CAD 模型）创建加载后动画。
 * 支持 washing / machine / inspection / press / storage / flow / tank / workstation 等
 * 全 9 类设备；当模型缺少命名运动部件时会自动启用 fallback 工业氛围动画，
 * 从而保证动画演示按钮始终可点、视觉一致"在运作"。
 */
export function setupGlbAnimation(
  gltf: THREE.Group,
  options?: { deviceKind?: string },
): {
  animUpdate: ((time: number, dt: number) => void) | null
  partCount: number
  partNames: string[]
} {
  const controller = createGlbAnimation(gltf, options)
  const partCount = controller.parts.length
  return {
    animUpdate: controller.update,
    partCount,
    partNames: controller.parts,
  }
}

/**
 * 兼容旧名称（保留 1.x 调用点），委托至 setupGlbAnimation。
 */
export function setupWashingAnimation(gltf: THREE.Group): {
  animUpdate: ((time: number, dt: number) => void) | null
  partCount: number
  partNames: string[]
} {
  return setupGlbAnimation(gltf, { deviceKind: 'washing' })
}
