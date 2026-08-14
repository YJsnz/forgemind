import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useRef, useEffect } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import type { GridPos, Rotation } from '../game/types'
import { dirToRotation } from '../game/dir'
import { canPlace } from '../game/grid'

/**
 * 网格建造的指针交互层（Day 2）：
 * - 有建造工具时：射线打到地面 → 更新 ghost 位置，左键放置；
 * - 拖拽传送带时：右键锁定当前位置为转弯锚点，继续拖拽可追加下一段；
 * - 无工具时：左键点地面清除选中。
 *
 * 键盘（挂在 window）：R 旋转 ghost，Escape 退出建造工具。
 */
export function BuildPlacer({ enabled = true }: { enabled?: boolean }) {
  const { camera, gl } = useThree()
  const raycaster = useRef(new THREE.Raycaster())
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))

  const buildType = useForgeMindStore((s) => s.buildType)
  const updateGhost = useForgeMindStore((s) => s.updateGhost)
  const setGhostPath = useForgeMindStore((s) => s.setGhostPath)
  const setGhostPathValid = useForgeMindStore((s) => s.setGhostPathValid)
  const objects = useForgeMindStore((s) => s.objects)
  const rotateGhost = useForgeMindStore((s) => s.rotateGhost)
  const placeAt = useForgeMindStore((s) => s.placeAt)
  const select = useForgeMindStore((s) => s.select)
  const setBuildType = useForgeMindStore((s) => s.setBuildType)

  const isPlacing = enabled && buildType !== null
  const drag = useRef<{ anchors: GridPos[]; current: GridPos } | null>(null)

  // 指针 → 网格坐标
  const pointerToGrid = (e: { clientX: number; clientY: number }): GridPos | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.current.setFromCamera(ndc, camera)
    const hit = new THREE.Vector3()
    const ok = raycaster.current.ray.intersectPlane(plane.current, hit)
    if (!ok) return null
    return { x: Math.floor(hit.x), z: Math.floor(hit.z) }
  }

  const buildSegment = (start: GridPos, end: GridPos): GridPos[] => {
    const path: GridPos[] = []
    let x = start.x
    let z = start.z
    path.push({ x, z })
    while (x !== end.x) {
      x += end.x > x ? 1 : -1
      path.push({ x, z })
    }
    while (z !== end.z) {
      z += end.z > z ? 1 : -1
      path.push({ x, z })
    }
    return path
  }

  /** Build the full polyline from saved turn anchors to the current pointer. */
  const buildPath = (anchors: GridPos[], current: GridPos): GridPos[] => {
    const path = anchors.length > 0 ? [{ ...anchors[0] }] : []
    let from = anchors[0]
    if (!from) return [current]

    for (const anchor of anchors.slice(1)) {
      path.push(...buildSegment(from, anchor).slice(1))
      from = anchor
    }
    path.push(...buildSegment(from, current).slice(1))
    return path
  }

  const pathRotations = (path: GridPos[]): Rotation[] => path.map((cell, index) => {
    const forward = index < path.length - 1
    const neighbor = forward ? path[index + 1] : path[index - 1]
    return neighbor
      ? dirToRotation({
          dx: forward ? neighbor.x - cell.x : cell.x - neighbor.x,
          dz: forward ? neighbor.z - cell.z : cell.z - neighbor.z,
        })
      : useForgeMindStore.getState().ghost.rotation
  })

  const validatePath = (path: GridPos[]): boolean[] => {
    const staged = [...objects]
    return pathRotations(path).map((rotation, index) => {
      const pos = path[index]
      const valid = canPlace(pos, 'conveyor', rotation, staged)
      if (valid) staged.push({ id: `ghost-${index}`, type: 'conveyor', pos, rotation })
      return valid
    })
  }

  const updatePathPreview = (path: GridPos[]) => {
    setGhostPath(path)
    setGhostPathValid(validatePath(path))
  }

  useEffect(() => {
    const el = gl.domElement

    const onMove = (e: PointerEvent) => {
      if (!isPlacing) return
      const pos = pointerToGrid(e)
      updateGhost(pos)
      if (pos && drag.current) {
        drag.current.current = pos
        updatePathPreview(buildPath(drag.current.anchors, pos))
      }
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (isPlacing) {
        const pos = pointerToGrid(e)
        if (!pos) return
        if (buildType === 'conveyor') {
          drag.current = { anchors: [pos], current: pos }
          el.setPointerCapture?.(e.pointerId)
          updateGhost(pos)
          updatePathPreview([pos])
        } else {
          const rotation = useForgeMindStore.getState().ghost.rotation
          updateGhost(pos)
          placeAt(pos, rotation)
        }
      } else {
        select(null)
      }
    }
    const onContextMenu = (e: MouseEvent) => {
      if (!isPlacing || buildType !== 'conveyor' || !drag.current) return
      e.preventDefault()
      const pos = pointerToGrid(e)
      if (!pos) return

      const path = buildPath(drag.current.anchors, pos)
      const valid = validatePath(path)
      if (!valid.every(Boolean)) return

      const last = drag.current.anchors[drag.current.anchors.length - 1]
      if (!last || last.x !== pos.x || last.z !== pos.z) {
        drag.current.anchors.push(pos)
      }
      drag.current.current = pos
      updatePathPreview(path)
    }
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !drag.current || buildType !== 'conveyor') return
      const { anchors, current } = drag.current
      const path = buildPath(anchors, current)
      path.forEach((cell, index) => {
        const rotation = pathRotations(path)[index]
        placeAt(cell, rotation)
      })
      drag.current = null
      setGhostPath([])
      setGhostPathValid([])
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        if (isPlacing) rotateGhost()
      } else if (e.key === 'Escape') {
        setBuildType(null)
      }
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [isPlacing, buildType, updateGhost, setGhostPath, setGhostPathValid, placeAt, select, rotateGhost, setBuildType, camera, gl, objects])

  // 建造模式时禁用 OrbitControls 的旋转（否则拖动会同时旋转相机与放置）
  useEffect(() => {
    const controls = (gl.domElement as HTMLCanvasElement)
    if (isPlacing) {
      // OrbitControls 内部在 mousedown 时接管；这里通过 CSS cursor 提示即可
      controls.style.cursor = 'crosshair'
    } else {
      controls.style.cursor = enabled ? 'default' : 'grab'
    }
  }, [enabled, isPlacing, gl])

  return null
}
