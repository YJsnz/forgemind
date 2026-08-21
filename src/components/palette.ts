import * as THREE from 'three'
import type { BuildType } from '../game/types'

/**
 * STEP→GLB 模型统一着色（共享于画布端批量/单件 + 3D 观测端）。
 *  设计原则：
 *  1) 尊重 GLB 自带鲜艳材质：如果原始 baseColor 高饱和（彩色零件/塑料件/指示灯），直接保留；
 *  2) 仅对"低饱和 / 灰色默认材质"做分区上色，确保同一台设备由多种鲜亮工业色构成，
 *     而不是单一 body+accent；
 *  3) 每台设备都有独立的 8 色 palette（base / primary / accent / trim / panel / surface / safety / frame），
 *     满足"按文件内容多种鲜亮配色构图"的要求。
 */

export interface EquipmentColorPalette {
  base: string      // 主体基座（大块）
  primary: string   // 主色（最常出现的鲜亮外壳色）
  accent: string    // 点缀高亮色
  trim: string      // 边条/把手/小件
  panel: string     // 控制面板/操作盘
  surface: string   // 工作台面/大平面
  safety: string    // 安全橙黄（安全光栅/警示件）
  frame: string     // 立柱/金属框架
}

export const EQUIPMENT_PALETTES: Record<BuildType, EquipmentColorPalette> = {
  // 数控加工中心：深蓝灰机身 + 明黄主色（FANUC 风）
  machine: {
    base: '#263542', primary: '#e8b32a', accent: '#ff7a3d',
    trim: '#1190b5', panel: '#0e222c', surface: '#44525f',
    safety: '#ff9326', frame: '#687682',
  },
  smelter: {
    base: '#2b1a18', primary: '#d94a4a', accent: '#ffce54',
    trim: '#f37b2b', panel: '#1b0f0e', surface: '#472c28',
    safety: '#f1c40f', frame: '#705049',
  },
  // 液压冲压机：工业青蓝 + 警示金
  press: {
    base: '#2b3a46', primary: '#39a1c3', accent: '#e3b64a',
    trim: '#1e6b86', panel: '#11202a', surface: '#566c7b',
    safety: '#ff8d2d', frame: '#798c9b',
  },
  // 清洗去毛刺：薄荷青绿系
  washing: {
    base: '#1e3837', primary: '#33c9a9', accent: '#f6c85f',
    trim: '#1b7c6c', panel: '#122727', surface: '#4c6a68',
    safety: '#ff6e64', frame: '#8ea5a3',
  },
  // 成品缓存仓：土金黄货架
  storage: {
    base: '#242c2b', primary: '#c8a24b', accent: '#66d3c0',
    trim: '#7a6028', panel: '#1d2422', surface: '#586360',
    safety: '#ffc14d', frame: '#8a9190',
  },
  // 分流/汇流：青蓝水色
  splitter: {
    base: '#1f3a3d', primary: '#4db5b2', accent: '#f4d35e',
    trim: '#2b7a76', panel: '#142629', surface: '#577176',
    safety: '#ff9f1c', frame: '#8ea4a6',
  },
  merger: {
    base: '#1f3a3d', primary: '#4db5b2', accent: '#f4d35e',
    trim: '#2b7a76', panel: '#142629', surface: '#577176',
    safety: '#ff9f1c', frame: '#8ea4a6',
  },
  // 视觉检测站（用户指定样板）：深蓝灰底 + 亮青主色 + 亮橙/红警示，
  // 保留 GLB 自带的红黄绿蓝指示灯鲜艳色。
  inspection: {
    base: '#1f2b35', primary: '#4fc3f7', accent: '#ff7043',
    trim: '#2e7da7', panel: '#0b1922', surface: '#475966',
    safety: '#ffd54f', frame: '#7b8a96',
  },
  conveyor: {
    base: '#2a3233', primary: '#4db6ac', accent: '#ffb74d',
    trim: '#276b64', panel: '#151e1e', surface: '#536061',
    safety: '#ef5350', frame: '#8f9a9b',
  },
  // 原料药罐：浅蓝+银色金属感的化工风格
  apiTank: {
    base: '#1c2c38', primary: '#8fd1e5', accent: '#c7e9f4',
    trim: '#3e7489', panel: '#0f1a22', surface: '#4d6a7b',
    safety: '#f5a623', frame: '#9fb0bc',
  },
  // 人工装配工作站：宜家工业黄
  workstation: {
    base: '#2a2a22', primary: '#f2c94c', accent: '#eb5757',
    trim: '#8a7228', panel: '#1c1c16', surface: '#5a5a49',
    safety: '#27ae60', frame: '#8b8b7c',
  },
  agv: {
    base: '#1f2522', primary: '#d6b141', accent: '#56cfe1',
    trim: '#795e22', panel: '#121615', surface: '#565e5c',
    safety: '#ef476f', frame: '#909894',
  },
  oreMiner: {
    base: '#2b1f10', primary: '#d7a24c', accent: '#6be0c5',
    trim: '#84622b', panel: '#18120b', surface: '#574737',
    safety: '#e55934', frame: '#8c7b64',
  },
  source: {
    base: '#1f3032', primary: '#e8b84a', accent: '#ff7a59',
    trim: '#7f6629', panel: '#131f21', surface: '#546566',
    safety: '#2ecc71', frame: '#889291',
  },
  assembler: {
    base: '#202a2d', primary: '#45b7d1', accent: '#f9ca24',
    trim: '#28728a', panel: '#12181a', surface: '#4e6065',
    safety: '#eb4d4b', frame: '#7d8a8d',
  },
}

/** 原始材质是否"已经是彩色/鲜亮到足以保留"（饱和度阈值） */
function isChromaticEnough(color: THREE.Color, threshold = 0.22): boolean {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  const l = (max + min) / 2
  if (max - min < 1e-4) return false
  const s = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
  return s >= threshold
}

/** 把三位/六位 hex 归一化成 "#xxxxxx"，避免 undefined 情况 */
function hex(color: string): THREE.Color {
  return new THREE.Color(color)
}

export interface ApplyMeshPaletteOptions {
  palette: EquipmentColorPalette
  mesh: THREE.Mesh
  meshBox: THREE.Box3
  finalBox: THREE.Box3
  totalVol: number
  materialName?: string
}

/**
 * 单个 mesh 的上色函数。策略：
 *  1) 若当前材质本身带颜色（非中性灰、饱和度>=阈值），直接保留原色——
 *     这是保证"按文件内容的多种鲜亮配色构图"的关键。
 *  2) 若为灰色默认材质：根据 mesh 在整机中的"结构角色"分区着色
 *     （靠体积占比、高度位置、名字关键词判断）。
 */
export function applyPaletteToMaterial(options: ApplyMeshPaletteOptions): THREE.MeshStandardMaterial {
  const { palette, mesh, meshBox, finalBox, totalVol, materialName } = options
  const source = mesh.material
  const first = Array.isArray(source) ? source[0] : source
  const src = (first && (first as THREE.MeshStandardMaterial).isMeshStandardMaterial)
    ? (first as THREE.MeshStandardMaterial)
    : undefined

  // 步骤 1：判定"是否要保留 GLB 自带的鲜亮颜色"
  let preserveColor = false
  const srcColor = new THREE.Color(0xffffff)
  if (src) {
    srcColor.copy(src.color)
    preserveColor = isChromaticEnough(src.color)
  }
  // 名字里带明显颜色语义也保留
  if (!preserveColor && materialName) {
    const mn = materialName.toLowerCase()
    if (/color_(6|9|24|27|30|33|36|45|48)/.test(mn) || /red|green|blue|yellow|cyan|orange/.test(mn)) {
      // Color_6=纯黄 Color_9=纯青 Color_24=绿 Color_27=红 Color_30=绿 Color_33=浅红 Color_36=橙 Color_45=蓝 Color_48=黄绿
      // 这些在视觉检测站 GLB 中本来就鲜艳 → 不覆盖
      preserveColor = src ? isChromaticEnough(src.color) || src.color.getHex() !== 0x808080 : false
    }
  }

  // 步骤 2：对"灰色默认材质"按结构角色分区 → 多色构图
  const meshSize = meshBox.getSize(new THREE.Vector3())
  const meshVol = Math.max(meshSize.x * meshSize.y * meshSize.z, 1e-8)
  const meshCenter = meshBox.getCenter(new THREE.Vector3())
  const relY = finalBox.max.y === finalBox.min.y
    ? 0.5
    : (meshCenter.y - finalBox.min.y) / (finalBox.max.y - finalBox.min.y)
  const ratio = meshVol / Math.max(totalVol, 1e-8)
  const name = (mesh.name || (materialName ?? '')).toLowerCase()

  // 名字关键词 → 功能色（优先级最高）
  const KW: Array<[RegExp, keyof EquipmentColorPalette]> = [
    [/(led|lamp|light|indicator|voyant|灯|警示|按钮|push|emergency|stop)/, 'safety'],
    [/(panel|door|cover|cabinet|enclosure|boitier|control|操作盘|面板|电箱)/, 'panel'],
    [/(table|plateau|bench|work|surface|deck|台面|工作台)/, 'surface'],
    [/(frame|pillar|beam|column|chassis|立柱|框架|型材)/, 'frame'],
    [/(sensor|camera|lens|inspect|vision|detect|镜头|相机|传感|检测)/, 'trim'],
    [/(safety|guard|grating|warn|estop|光栅|安全|急停)/, 'safety'],
    [/(roller|pulley|wheel|gear|bearing|滚筒|轮|轴承)/, 'frame'],
    [/(motor|moteur|电机|fan|ventil|马达|泵|pump)/, 'accent'],
  ]
  let pickKey: keyof EquipmentColorPalette = 'primary'
  for (const [re, key] of KW) if (re.test(name)) { pickKey = key; break }

  // 如果关键词没命中，按"几何+位置"自动分区
  if (pickKey === 'primary') {
    if (ratio > 0.28) pickKey = 'base'                 // 最大的一块 → 基座色（深沉）
    else if (ratio > 0.08) pickKey = 'primary'         // 中大块 → 主色（鲜亮外壳）
    else if (relY > 0.82) pickKey = 'accent'           // 顶部饰带 → 高亮
    else if (relY < 0.16) pickKey = 'frame'            // 底部支撑/脚座
    else if (ratio < 0.012) pickKey = 'trim'           // 小零件
    else pickKey = 'surface'                           // 其余中层平面
  }

  const chosen = hex(palette[pickKey])

  // 步骤 3：组装最终材质
  const buildFinal = (mat: THREE.Material | undefined): THREE.MeshStandardMaterial => {
    const base =
      mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial
        ? (mat.clone() as THREE.MeshStandardMaterial)
        : new THREE.MeshStandardMaterial()
    if (preserveColor) {
      // 保留原 GLB 自带的彩色，仅补 PBR 参数使其"更鲜亮"：增对比、稍微降饱和让颜色更工业
      const hsl = { h: 0, s: 0, l: 0 }
      base.color.getHSL(hsl)
      // 提升亮度对比度：避免 CAD 原色过于"CAD 荧光感"
      hsl.l = Math.min(0.92, 0.18 + hsl.l * 0.78)
      hsl.s = Math.min(1, 0.55 + hsl.s * 0.55)
      base.color.setHSL(hsl.h, hsl.s, hsl.l)
      base.roughness = 0.58
      base.metalness = src?.metalness ?? 0.35
    } else {
      base.color.copy(chosen)
      if (!Number.isFinite(base.roughness)) base.roughness = 0.62
      if (!Number.isFinite(base.metalness)) base.metalness = 0.55
    }
    base.needsUpdate = true
    return base
  }

  if (Array.isArray(source)) {
    // 如果 mesh 有 multi-material，只对第一个做主决策（一般 STEP 转换 multi-material 很少），
    // 并对其他 material 独立执行同一策略
    const mats = source.map((m) => {
      const mm = (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial)
        ? (m as THREE.MeshStandardMaterial)
        : undefined
      const pc = mm && isChromaticEnough(mm.color)
      if (pc) return buildFinal(m)
      // 不同子材质可根据顺序偏移选色，增加多色层次
      const altKeys: Array<keyof EquipmentColorPalette> = ['primary', 'accent', 'trim', 'panel', 'safety']
      const idx = Math.max(0, Math.min(altKeys.length - 1, Math.floor(Math.random() * altKeys.length)))
      const result = buildFinal(m)
      if (!pc) result.color.copy(hex(palette[altKeys[idx]]))
      result.needsUpdate = true
      return result
    })
    // Multi-material 情况：返回"第一个"作为代表（因为返回类型是单个材质）；
    // 调用方应对 node.material 做批量处理，不应依赖这里的单一返回值。
    // 这里兜底返回首项（理论上这个分支调用方走 map）。
    return mats[0]
  }
  return buildFinal(source)
}

/** 辅助：对整个 scene 执行"按 palette 鲜亮分区 + 保留 GLB 彩色"的整批着色。
 *  供三条渲染路径共享：
 *   - DaiyuStaticModelBatch.normalizeStaticModel
 *   - EquipmentModel.tsx 的 ImportedModel/DetailedAsset
 *   - Model3DViewer.normalizeGLTF
 */
export function paintSceneWithPalette(
  scene: THREE.Object3D,
  palette: EquipmentColorPalette,
  finalBox: THREE.Box3,
  totalVol: number,
): void {
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const meshBox = new THREE.Box3().setFromObject(node)
    const opts: ApplyMeshPaletteOptions = {
      palette,
      mesh: node,
      meshBox,
      finalBox,
      totalVol,
      materialName: (() => {
        const m = node.material
        if (!m) return undefined
        const first = Array.isArray(m) ? m[0] : m
        return (first as THREE.Material)?.name
      })(),
    }

    const paintOne = (mat: THREE.Material): THREE.MeshStandardMaterial =>
      applyPaletteToMaterial({ ...opts, materialName: (mat as THREE.Material)?.name ?? opts.materialName })

    node.material = Array.isArray(node.material)
      ? node.material.map(paintOne)
      : paintOne(node.material)
  })
}
