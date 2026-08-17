import { useEffect, useRef, useState } from 'react'
import { changeInspectionPart, inspectionRegistry } from '../scene/inspectionRegistry'
import { PART_TYPES } from '../scene/inspectionPart'
import { runInspection, type VisionResult } from '../scene/inspectionDetect'

const DEFECT_LABEL: Record<string, string> = { scratch: '划痕', burr: '毛刺', dent: '凹痕' }

/**
 * 右面板：质检摄像头实时画面 + 结果展示。
 * 检测由摄像头臂在货物进视野时实时自动触发（runInspection），本面板监听结果事件展示；
 * 「检测」按钮作为手动触发备用。
 */
export function InspectionPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VisionResult | null>(null)
  const [partLabel, setPartLabel] = useState(() => PART_TYPES[inspectionRegistry.partSeed].label)

  // 实时画面（轮询注册表最新帧）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let lastVersion = -1
    let hadFrames = false

    const paint = () => {
      raf = requestAnimationFrame(paint)
      const frame = inspectionRegistry.frame
      if (!frame || frame.version === lastVersion) return
      lastVersion = frame.version
      const rowBytes = frame.width * 4
      const flipped = new Uint8ClampedArray(frame.pixels.length)
      for (let y = 0; y < frame.height; y += 1) {
        const src = y * rowBytes
        const dst = (frame.height - 1 - y) * rowBytes
        flipped.set(frame.pixels.subarray(src, src + rowBytes), dst)
      }
      canvas.width = frame.width
      canvas.height = frame.height
      ctx.putImageData(new ImageData(flipped, frame.width, frame.height), 0, 0)
      if (!hadFrames) {
        hadFrames = true
        dotRef.current?.classList.remove('is-offline')
      }
    }
    paint()
    return () => cancelAnimationFrame(raf)
  }, [])

  // 监听实时检测结果（摄像头臂自动触发）
  useEffect(() => {
    const onResult = (event: Event) => {
      const json = (event as CustomEvent<VisionResult>).detail
      setResult(json)
    }
    window.addEventListener('forgemind:inspection-result', onResult)
    return () => window.removeEventListener('forgemind:inspection-result', onResult)
  }, [])

  const changePart = (seed: number) => {
    changeInspectionPart(seed)
    setPartLabel(PART_TYPES[seed].label)
    setResult(null)
  }

  const manualDetect = async () => {
    setBusy(true)
    try {
      await runInspection()
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="fm-inspection" aria-label="视觉检测">
      <div className="fm-inspection-head">
        <span ref={dotRef} className="fm-inspection-dot is-offline" />
        <span className="fm-inspection-title">视觉检测</span>
        <span className="fm-inspection-code">360° SCAN / 01</span>
      </div>

      <div className="fm-inspection-view">
        <canvas ref={canvasRef} className="fm-inspection-canvas" />
        <div className="fm-inspection-frame" />
      </div>

      <div className="fm-inspection-actions">
        <button className="fm-inspection-btn fm-inspection-btn-primary" onClick={manualDetect} disabled={busy}>
          {busy ? '检测中…' : '▣ 手动检测'}
        </button>
        <div className="fm-inspection-switch">
          {PART_TYPES.map((t) => (
            <button
              key={t.seed}
              className={t.seed === inspectionRegistry.partSeed ? 'is-active' : ''}
              onClick={() => changePart(t.seed)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`fm-inspection-result ${result ? `is-${result.verdict}` : ''}`}>
        {result ? (
          <>
            <div className="fm-inspection-verdict">
              {result.verdict === 'pass' && <strong>合格</strong>}
              {result.verdict === 'fail' && <strong>不合格</strong>}
              {result.verdict === 'error' && <strong>检测失败</strong>}
              <span>{result.defects.length} 处缺陷 · 置信 {(result.confidence * 100).toFixed(0)}%</span>
            </div>
            <ul className="fm-inspection-defects">
              {result.defects.map((d, i) => (
                <li key={i}>
                  <span>{DEFECT_LABEL[d.type] ?? d.type}</span>
                  <span>severe {d.severity.toFixed(2)}</span>
                </li>
              ))}
              {result.defects.length === 0 && <li className="fm-inspection-ok">表面无缺陷</li>}
              {result.note && <li className="fm-inspection-note">{result.note}</li>}
            </ul>
          </>
        ) : (
          <div className="fm-inspection-idle">货物进入视野后自动开始 360° 环绕检测 · 当前零件：{partLabel}</div>
        )}
      </div>

      <div className="fm-inspection-hint">
        <span>360° 环绕</span>
        <span>实时检测</span>
        <span>按结果分拣</span>
      </div>
    </aside>
  )
}
