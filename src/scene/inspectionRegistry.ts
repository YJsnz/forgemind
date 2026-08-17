import * as THREE from 'three'

/**
 * 质检摄像头共享注册表。
 *
 * 摄像头臂每帧更新 `camera`；CameraFeedTarget 读它渲染离屏图；
 * InspectionPanel 用 rAF 轮询 `frame` 画到右面板。
 * 悬空检测流程：夹取爪举货悬空 → 摄像头环绕 → 检测 → 按 verdict 分放。
 */

export interface InspectionFrame {
  pixels: Uint8Array
  width: number
  height: number
  version: number
}

export type GripperPhase = 'idle' | 'picking' | 'inspecting' | 'placing'
export type Verdict = 'pass' | 'fail'

/** 质检工作站（无桌子）：夹取爪举货悬空，摄像头臂环绕检测，按结果分放。 */
export const INSPECTION_STATION = {
  /** 站点网格位置（世界坐标，y=0） */
  pos: { x: 9, z: -7 } as { x: number; z: number },
  /** 摄像头臂相对站点局部坐标（悬空货物下方附近，保证 360° 环绕全部可达） */
  armLocal: new THREE.Vector3(0.15, 0, 0.5),
  /** 夹取臂相对站点局部坐标 */
  gripperArmLocal: new THREE.Vector3(-0.35, 0, 0.6),
  /** 地面取货点（零件出现处，无桌子） */
  sourceLocal: new THREE.Vector3(-0.6, 0.1, 0.35),
  /** 悬空检测位：夹取爪把货物举到这里让摄像头环绕检查 */
  inspectPoseLocal: new THREE.Vector3(-0.05, 0.65, 0.5),
  /** 合格品放置区（地面） */
  acceptLocal: new THREE.Vector3(0.35, 0.1, 1.0),
  /** 不合格品放置区（地面） */
  rejectLocal: new THREE.Vector3(-0.5, 0.1, 0.85),
}

export const inspectionRegistry: {
  camera: THREE.PerspectiveCamera | null
  frame: InspectionFrame | null
  /** 当前被测件编号（决定程序化缺陷） */
  partSeed: number
  /** 夹取爪当前阶段 */
  phase: GripperPhase
  /** 最近一次检测判定（面板写入，夹取爪据此分放） */
  lastVerdict: Verdict | null
  /** 夹取爪当前举着的货物位置（站点局部，供摄像头瞄准/环绕中心） */
  heldPartPos: THREE.Vector3 | null
} = {
  camera: null,
  frame: null,
  partSeed: 1,
  phase: 'idle',
  lastVerdict: null,
  heldPartPos: null,
}

/** 请求更换被测件（夹取爪取新货时调用）。 */
export function changeInspectionPart(seed: number) {
  inspectionRegistry.partSeed = seed
  window.dispatchEvent(new CustomEvent('forgemind:change-part', { detail: { seed } }))
}

// 开发调试：把注册表暴露到 window
if (import.meta.env.DEV) {
  ;(window as unknown as { __inspection?: unknown }).__inspection = inspectionRegistry
}
