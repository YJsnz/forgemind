import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { InspectionCameraArm } from '../scene/InspectionCameraArm'
import { GripperArm } from '../scene/GripperArm'
import { CameraFeedTarget } from '../scene/CameraFeedTarget'
import { InspectionPanel } from '../components/InspectionPanel'
import { INSPECTION_STATION } from '../scene/inspectionRegistry'
import '../index.css'
import './inspection-demo.css'

const YOLO_DETECT_ENDPOINT = import.meta.env.VITE_YOLO_DETECT_ENDPOINT ?? 'http://127.0.0.1:8000/api/vision/yolo/detect'

/**
 * 视觉检测工作台 · 独立 Demo（不进入主前端）。
 * 访问：/inspection.html
 */
function InspectionDemo() {
  const target = INSPECTION_STATION.pos
  const [demoOpen, setDemoOpen] = useState(false)
  return (
    <div className="id-shell">
      <header className="id-topbar">
        <span className="id-brand">FORGEMIND</span>
        <span className="id-title">视觉检测工作台 · DEMO / VISUAL INSPECTION</span>
        <span className="id-spacer" />
        <a className="id-back" href="/">← 返回基地</a>
        <span className="id-hint">手柄或 WASD+鼠标 · 摄像头臂末端视角实时渲染</span>
      </header>
      <div className="id-body">
        <div className="id-stage">
          <button className={`id-demo-launch ${demoOpen ? 'is-active' : ''}`} onClick={() => setDemoOpen((open) => !open)}>
            <span className="id-demo-launch-index">01</span>
            <span className="id-demo-launch-mark">◉</span>
            <span className="id-demo-launch-copy"><strong>DEMO</strong><small>YOLO 质检回放</small></span>
            <span className="id-demo-launch-arrow">{demoOpen ? '×' : '↗'}</span>
          </button>
          {demoOpen && <InspectionReplay onClose={() => setDemoOpen(false)} />}
          <Canvas
            shadows
            camera={{ position: [target.x + 2.2, 2.5, target.z + 3.2], fov: 42, near: 0.1, far: 120 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
          >
            <color attach="background" args={['#c4ceca']} />
            <fog attach="fog" args={['#c4ceca', 30, 90]} />
            <ambientLight intensity={0.55} />
            <hemisphereLight args={['#edf1f0', '#8d9794', 0.55]} />
            <directionalLight
              position={[8, 12, 6]}
              intensity={1.2}
              castShadow
              shadow-mapSize={[1024, 1024]}
              shadow-normalBias={0.025}
            />
            <Grid
              infiniteGrid
              cellSize={1}
              cellThickness={0.6}
              cellColor="#879790"
              sectionSize={5}
              sectionThickness={1}
              sectionColor="#657873"
              fadeDistance={45}
            />
            <InspectionCameraArm />
            <GripperArm />
            <CameraFeedTarget />
            <OrbitControls
              makeDefault
              target={new THREE.Vector3(target.x, 0.6, target.z - 0.4)}
              maxPolarAngle={Math.PI / 2.05}
            />
          </Canvas>
        </div>
        <InspectionPanel />
      </div>
    </div>
  )
}

type YoloDetection = {
  className: string
  confidence: number
  x1: number
  y1: number
  x2: number
  y2: number
}

function formatReplayTime(value: number) {
  const safe = Math.max(0, Math.round(value))
  return `00:${safe.toString().padStart(2, '0')}`
}

function InspectionReplay({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const inferenceBusyRef = useRef(false)
  const lastInferenceRef = useRef(0)
  const disposedRef = useRef(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(4.8)
  const [playing, setPlaying] = useState(true)
  const [videoError, setVideoError] = useState(false)
  const [modelState, setModelState] = useState<'checking' | 'live' | 'offline'>('checking')
  const [detections, setDetections] = useState<YoloDetection[]>([])
  const [inferenceMs, setInferenceMs] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const start = () => {
      setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4.8)
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
    video.addEventListener('loadedmetadata', start)
    start()
    return () => video.removeEventListener('loadedmetadata', start)
  }, [])

  useEffect(() => () => { disposedRef.current = true }, [])

  const inferCurrentFrame = async (video: HTMLVideoElement) => {
    const overlay = overlayRef.current
    if (!overlay || disposedRef.current || video.readyState < 2 || inferenceBusyRef.current) return
    const now = performance.now()
    if (now - lastInferenceRef.current < 360) return
    lastInferenceRef.current = now
    inferenceBusyRef.current = true
    const source = document.createElement('canvas')
    source.width = video.videoWidth || 960
    source.height = video.videoHeight || 960
    source.getContext('2d')?.drawImage(video, 0, 0, source.width, source.height)
    try {
        const response = await fetch(YOLO_DETECT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: source.toDataURL('image/jpeg', 0.72), confidence: 0.28 }),
      })
      const payload = await response.json() as { status?: string; detections?: YoloDetection[]; inferenceMs?: number }
      if (!response.ok || payload.status !== 'ready') throw new Error('YOLO 服务不可用')
      if (!disposedRef.current) {
        setModelState('live')
        setDetections(payload.detections ?? [])
        setInferenceMs(payload.inferenceMs ?? 0)
      }
    } catch {
      if (!disposedRef.current) {
        setModelState('offline')
        setDetections([])
      }
    } finally {
      inferenceBusyRef.current = false
    }
  }

  useEffect(() => {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay) return
    const width = video.videoWidth || 960
    const height = video.videoHeight || 960
    overlay.width = width
    overlay.height = height
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    ctx.font = '600 18px "SFMono-Regular", Consolas, monospace'
    detections.forEach((detection) => {
      const boxWidth = detection.x2 - detection.x1
      const boxHeight = detection.y2 - detection.y1
      ctx.strokeStyle = '#f0b400'
      ctx.lineWidth = Math.max(3, width / 320)
      ctx.strokeRect(detection.x1, detection.y1, boxWidth, boxHeight)
      const label = `${detection.className} ${(detection.confidence * 100).toFixed(0)}%`
      const labelWidth = ctx.measureText(label).width + 14
      const labelY = Math.max(24, detection.y1)
      ctx.fillStyle = '#f0b400'
      ctx.fillRect(detection.x1, labelY - 24, labelWidth, 24)
      ctx.fillStyle = '#1b2523'
      ctx.fillText(label, detection.x1 + 7, labelY - 7)
    })
  }, [detections])

  const activeMarker = detections[0]
    ? { label: detections[0].className, detail: 'YOLO 实时检测', tone: 'alert' as const }
    : { label: modelState === 'live' ? 'OK' : 'MODEL OFFLINE', detail: modelState === 'live' ? '当前帧未发现缺陷' : '启动 AI 服务加载模型', tone: modelState === 'live' ? 'ok' as const : 'alert' as const }
  const alertCount = detections.length
  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().then(() => setPlaying(true))
    } else {
      video.pause()
      setPlaying(false)
    }
  }
  const restart = () => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().then(() => setPlaying(true))
  }

  return (
    <div className="id-demo-layer" aria-label="YOLO 工业质检 Demo">
      <div className="id-demo-card">
        <div className="id-demo-card-head">
          <div>
            <span className="id-demo-eyebrow">OPEN-SOURCE REPLAY / YOLOv8</span>
            <h2>PCB 制成品质检 Demo</h2>
          </div>
          <button className="id-demo-close" onClick={onClose} aria-label="关闭 Demo">×</button>
        </div>

        <div className="id-demo-video-wrap">
          {!videoError ? (
            <video
              ref={videoRef}
              className="id-demo-video"
              src="/videos/inspection-pcb-demo.mp4"
              autoPlay
              muted
              loop
              playsInline
              onLoadedData={(event) => void inferCurrentFrame(event.currentTarget)}
              onTimeUpdate={(event) => {
                setCurrentTime(event.currentTarget.currentTime)
                void inferCurrentFrame(event.currentTarget)
              }}
              onError={() => setVideoError(true)}
            />
          ) : (
            <div className="id-demo-video-error">演示视频载入失败<br /><small>请确认静态资源服务已启动</small></div>
          )}
          <div className={`id-demo-video-badge is-${modelState}`}><span /> {modelState === 'live' ? 'YOLOv8 / LIVE INFERENCE' : modelState === 'offline' ? 'YOLOv8 / MODEL OFFLINE' : 'YOLOv8 / LOADING MODEL'}</div>
          <canvas ref={overlayRef} className="id-demo-overlay" />
          <div className="id-demo-video-corner">CAM-03<br /><b>640 × 360</b></div>
        </div>

        <div className="id-demo-timeline">
          <button onClick={togglePlayback}>{playing ? 'Ⅱ' : '▶'}</button>
          <button onClick={restart}>↺</button>
          <input
            type="range"
            min="0"
            max={duration}
            step="0.01"
            value={Math.min(currentTime, duration)}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (videoRef.current) videoRef.current.currentTime = value
              setCurrentTime(value)
            }}
            aria-label="Demo 播放进度"
          />
          <span>{formatReplayTime(currentTime)} / {formatReplayTime(duration)}</span>
        </div>

        <div className="id-demo-readout">
          <div className="id-demo-readout-main">
            <span className={`id-demo-signal is-${activeMarker.tone}`} />
            <div><small>当前识别</small><strong>{activeMarker.label}</strong><em>{activeMarker.detail}</em></div>
          </div>
          <div className="id-demo-stat"><small>问题累计</small><strong>{String(alertCount).padStart(2, '0')}</strong></div>
          <div className="id-demo-stat"><small>推理耗时</small><strong>{modelState === 'live' ? `${inferenceMs.toFixed(0)}ms` : '—'}</strong></div>
        </div>

        <div className="id-demo-footer">
          <span>{modelState === 'live' ? '当前帧由本地 PCB YOLOv8 权重实时推理' : '需启动 AI 服务后加载本地 PCB YOLOv8 权重'}</span>
          <a href="https://github.com/Gunavarthan/PCB-Defect-Classifier" target="_blank" rel="noreferrer">查看来源 ↗</a>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<InspectionDemo />)
