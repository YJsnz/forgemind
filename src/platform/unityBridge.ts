import type { FactorySave } from '../game/save'
import type { FactoryFloorId } from '../game/types'

export const UNITY_BRIDGE_PROTOCOL = 'forgemind.unity.bridge.v1'

export interface UnityViewportRect {
  x: number
  y: number
  width: number
  height: number
  devicePixelRatio: number
  visible: boolean
  /** Absolute CSS-pixel rectangles that must remain owned by WebView2. */
  occlusions: string
}

export interface UnityCameraPose {
  position: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
  fov: number
  distance: number
  animate: boolean
}

export interface UnityBridgeReadyEvent {
  protocol: string
  clientVersion?: string
  graphicsApi?: string
  nativeSurface?: boolean
}

export interface UnityBridgeMessage {
  protocol: string
  type: string
  requestId?: string
  payload?: unknown
}

interface WebView2Bridge {
  postMessage(message: UnityBridgeMessage): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

declare global {
  interface Window {
    chrome?: { webview?: WebView2Bridge }
    __FORGEMIND_UNITY_HOST__?: boolean
  }
}

type UnityBridgeListener = (message: UnityBridgeMessage) => void

function getWebView2Bridge(): WebView2Bridge | null {
  if (!isDesktopUnityBuild() || typeof window === 'undefined') return null
  return window.chrome?.webview ?? null
}

/**
 * The browser and desktop bundles share the React application, but they do
 * not share the 3D surface. Only build:desktop is allowed to negotiate Unity.
 */
export function isDesktopUnityBuild(): boolean {
  return import.meta.env.FORGEMIND_DESKTOP === true
}

export function isUnityBridgeAvailable(): boolean {
  return isDesktopUnityBuild()
    && Boolean(getWebView2Bridge() || (typeof window !== 'undefined' && window.__FORGEMIND_UNITY_HOST__ === true))
}

export function postUnityBridgeMessage(type: string, payload?: unknown, requestId = ''): boolean {
  const bridge = getWebView2Bridge()
  if (!bridge) return false
  bridge.postMessage({ protocol: UNITY_BRIDGE_PROTOCOL, type, requestId, payload })
  return true
}

export function subscribeUnityBridge(listener: UnityBridgeListener): () => void {
  const bridge = getWebView2Bridge()
  if (!bridge) return () => undefined
  const onMessage = (event: MessageEvent) => {
    const message = event.data as Partial<UnityBridgeMessage> | undefined
    if (!message || message.protocol !== UNITY_BRIDGE_PROTOCOL || typeof message.type !== 'string') return
    listener(message as UnityBridgeMessage)
  }
  bridge.addEventListener('message', onMessage)
  return () => bridge.removeEventListener('message', onMessage)
}

export function requestUnitySurface(): boolean {
  return postUnityBridgeMessage('bridge.start')
}

export function sendUnityViewport(rect: UnityViewportRect): boolean {
  return postUnityBridgeMessage('viewport.rect', rect)
}

export function sendUnityFloor(activeFloor: FactoryFloorId, visibleFloors: readonly FactoryFloorId[]): boolean {
  return postUnityBridgeMessage('view.floor', { activeFloor, visibleFloors })
}

export function sendUnitySelection(selectedIds: readonly string[], primaryId: string | null): boolean {
  return postUnityBridgeMessage('selection.set', { selectedIds, primaryId })
}

export function sendUnityScene(save: FactorySave, activeFloor: FactoryFloorId, visibleFloors: readonly FactoryFloorId[]): boolean {
  return postUnityBridgeMessage('scene.replace', {
    projectId: '',
    projectVersion: String(save.version),
    activeFloor,
    visibleFloors,
    save,
  }, `scene-${Date.now()}`)
}

export function sendUnitySnapshot(simSnapshot: unknown): boolean {
  return postUnityBridgeMessage('simulation.snapshot', { simSnapshot })
}

export function sendUnityCamera(camera: UnityCameraPose): boolean {
  return postUnityBridgeMessage('camera.set', { camera })
}

export function sendUnityRenderConfig(targetFps: 60 | 120): boolean {
  return postUnityBridgeMessage('render.configure', { targetFps })
}
