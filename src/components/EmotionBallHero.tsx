import { useEffect, useRef, useState } from 'react'

const TOUR_IDS = ['02', '30', '32', '33']

export function EmotionBallHero() {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<EmotionBallEngine | null>(null)
  const [runtimeReady, setRuntimeReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    const api = window.EmotionBall
    if (!host || !api) return

    const engine = api.create(host, {
      emotion: '02',
      shape: 'blob',
      label: 'ForgeMind Emotion Ball · BT-7274',
      idle: true,
    })
    engineRef.current = engine
    setRuntimeReady(true)

    const pointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const nx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)
      const ny = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)
      engine.setGaze(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)))
    }
    const pointerLeave = () => engine.clearGaze()
    const spin = () => engine.spin(1)
    const observer = new IntersectionObserver(([entry]) => engine.setActive(entry.isIntersecting), { threshold: 0.05 })

    host.addEventListener('pointermove', pointerMove)
    host.addEventListener('pointerleave', pointerLeave)
    host.addEventListener('click', spin)
    observer.observe(host)

    const initialSpin = window.setTimeout(() => engine.spin(1), 700)
    const tourStart = window.setTimeout(() => engine.startTour(TOUR_IDS, 4200), 2200)

    return () => {
      window.clearTimeout(initialSpin)
      window.clearTimeout(tourStart)
      observer.disconnect()
      host.removeEventListener('pointermove', pointerMove)
      host.removeEventListener('pointerleave', pointerLeave)
      host.removeEventListener('click', spin)
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  return (
    <div className={`fmi-emotion-ball ${runtimeReady ? 'is-ready' : ''}`}>
      <div ref={hostRef} className="fmi-emotion-ball-host" aria-label="可交互的 ForgeMind 表情球">
        {!runtimeReady && <span className="fmi-ball-loading">LOADING / EMOTION RUNTIME</span>}
      </div>
      <div className="fmi-ball-prompt" aria-hidden="true">
        <span>POINTER / GAZE</span>
        <i />
        <span>CLICK / SPIN</span>
      </div>
    </div>
  )
}
