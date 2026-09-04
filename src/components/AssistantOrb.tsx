import { useEffect, useMemo, useRef, useState } from 'react'

export type AssistantPresencePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

interface AssistantPresenceDetail {
  phase?: AssistantPresencePhase
  message?: string
  level?: number
}

interface AssistantAudioLevelDetail {
  level?: number
}

interface AssistantEvidenceDetail {
  evidence?: Array<{ source?: string; heading?: string }>
}

const PHASE_COPY: Record<AssistantPresencePhase, { label: string; detail: string }> = {
  idle: { label: '待命', detail: '等待驾驶员指令' },
  listening: { label: '聆听中', detail: '正在接收语音输入' },
  thinking: { label: '分析中', detail: '正在读取工厂信号' },
  speaking: { label: '播报中', detail: '正在向驾驶员报告' },
  error: { label: '链路异常', detail: '可选智能服务未连接' },
}

const PHASE_TOURS: Record<AssistantPresencePhase, string[]> = {
  idle: ['02', '30', '19', '02'],
  listening: ['16', '17', '16', '11'],
  thinking: ['11', '20', '17', '11'],
  speaking: ['10', '13', '19', '10'],
  error: ['21', '20', '21'],
}

/**
 * Assistant presence surface. The optional voice service can drive it with:
 * window.dispatchEvent(new CustomEvent('forgemind:assistant-state', {
 *   detail: { phase: 'speaking', message: '...', level: 0.72 }
 * }))
 *
 * `level` is deliberately an event contract instead of an audio dependency: the
 * TTS player may be local BT audio, a browser AudioBuffer, or a future stream.
 */
export function AssistantOrb({ compact = false }: { compact?: boolean }) {
  const emotionHostRef = useRef<HTMLDivElement>(null)
  const emotionStageRef = useRef<HTMLDivElement>(null)
  const emotionEngineRef = useRef<EmotionBallEngine | null>(null)
  const [phase, setPhase] = useState<AssistantPresencePhase>('idle')
  const [message, setMessage] = useState('等待驾驶员指令')
  const [evidenceLabel, setEvidenceLabel] = useState('')
  const [targetLevel, setTargetLevel] = useState(0.16)
  const [level, setLevel] = useState(0.16)
  const targetRef = useRef(0.16)
  const phaseRef = useRef<AssistantPresencePhase>('idle')
  const barSeeds = useMemo(() => Array.from({ length: 28 }, (_, index) => 0.56 + ((index * 17) % 11) / 22), [])

  useEffect(() => {
    const host = emotionHostRef.current
    const api = window.EmotionBall
    if (!host || !api) return

    const engine = api.create(host, {
      emotion: '02',
      shape: 'blob',
      label: 'ForgeMind BT-7274 Emotion Ball',
      idle: false,
    })
    emotionEngineRef.current = engine
    engine.startTour(PHASE_TOURS[phaseRef.current], 3200)
    const pointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      engine.setGaze(
        Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2))),
        Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2))),
      )
    }
    const pointerLeave = () => engine.clearGaze()
    const spin = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      engine.setActive(true)
      engine.spin(1, 1)

      // The compact workbench ball is small enough that the engine's yaw can
      // be easy to miss. Keep the real engine spin and add a short stage cue
      // so every deliberate click has an immediate, visible response.
      const stage = emotionStageRef.current
      if (!stage) return
      stage.classList.remove('is-click-spinning')
      void stage.offsetWidth
      stage.classList.add('is-click-spinning')
      window.setTimeout(() => stage.classList.remove('is-click-spinning'), 760)
    }
    host.addEventListener('pointermove', pointerMove)
    host.addEventListener('pointerleave', pointerLeave)
    const stage = emotionStageRef.current
    stage?.addEventListener('pointerdown', spin, { passive: false })

    return () => {
      host.removeEventListener('pointermove', pointerMove)
      host.removeEventListener('pointerleave', pointerLeave)
      stage?.removeEventListener('pointerdown', spin)
      engine.destroy()
      emotionEngineRef.current = null
    }
  }, [])

  useEffect(() => {
    emotionEngineRef.current?.startTour(PHASE_TOURS[phase], 3200)
  }, [phase])

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<AssistantPresenceDetail>).detail ?? {}
      const nextPhase = detail.phase ?? 'idle'
      phaseRef.current = nextPhase
      setPhase(nextPhase)
      setMessage(detail.message || PHASE_COPY[nextPhase].detail)
      if (typeof detail.level === 'number') {
        const nextLevel = clamp(detail.level)
        targetRef.current = nextLevel
        setTargetLevel(nextLevel)
      }
    }
    const onLevel = (event: Event) => {
      const detail = (event as CustomEvent<AssistantAudioLevelDetail>).detail ?? {}
      if (typeof detail.level !== 'number') return
      const nextLevel = clamp(detail.level)
      targetRef.current = nextLevel
      setTargetLevel(nextLevel)
    }

    window.addEventListener('forgemind:assistant-state', onState)
    window.addEventListener('forgemind:assistant-audio-level', onLevel)
    const onEvidence = (event: Event) => {
      const evidence = (event as CustomEvent<AssistantEvidenceDetail>).detail?.evidence ?? []
      if (!evidence.length) {
        setEvidenceLabel('')
        return
      }
      const first = evidence[0]
      const source = first?.source?.split('/').pop() || '项目文档'
      setEvidenceLabel(`依据 ${evidence.length} 条 · ${source}`)
    }
    window.addEventListener('forgemind:assistant-evidence', onEvidence)
    return () => {
      window.removeEventListener('forgemind:assistant-state', onState)
      window.removeEventListener('forgemind:assistant-audio-level', onLevel)
      window.removeEventListener('forgemind:assistant-evidence', onEvidence)
    }
  }, [])

  useEffect(() => {
    let frame = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const elapsed = (now - startedAt) / 1000
      const speaking = phaseRef.current === 'speaking'
      const listening = phaseRef.current === 'listening'
      const breathing = speaking
        ? 0.12 + Math.abs(Math.sin(elapsed * 5.4)) * 0.48
        : listening
          ? 0.13 + Math.abs(Math.sin(elapsed * 2.3)) * 0.16
          : 0.1 + Math.abs(Math.sin(elapsed * 1.3)) * 0.045
      const desired = Math.max(targetRef.current, breathing)
      setLevel((current) => current + (desired - current) * 0.18)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const copy = PHASE_COPY[phase]
  const displayMessage = message || copy.detail
  const displayLevel = Math.max(level, targetLevel * 0.72)
  const displayPercent = compact ? Math.min(16, Math.round(displayLevel * 16)) : Math.round(displayLevel * 100)

  return (
    <section className={`fm-assistant-orb ${compact ? 'is-compact' : ''} fm-assistant-orb-${phase}`} aria-label="ForgeMind BT-7274 智能管家" role="status" aria-live="polite">
      {compact ? (
        <div className="fm-assistant-compact-copy">
          <span className="fm-assistant-orb-kicker">RULE CORE / OPTIONAL AI</span>
          <div>
            <strong>BT-7274</strong>
            <b>{copy.label}</b>
            <span className="fm-assistant-inline-wave" aria-label="语音能量">
              {barSeeds.slice(0, 7).map((seed, index) => (
                <i key={index} style={{ height: `${(2 + displayLevel * (5 + seed * 5) * (0.62 + Math.abs(Math.sin(index * 1.7 + level * 8)) * 0.58)).toFixed(1)}px` }} />
              ))}
            </span>
          </div>
          <small>{displayMessage}</small>
          {evidenceLabel && <em className="fm-assistant-evidence">{evidenceLabel}</em>}
        </div>
      ) : (
        <div className="fm-assistant-orb-head">
          <div>
            <span className="fm-assistant-orb-kicker">RULE INTELLIGENCE / OPTIONAL AI</span>
            <strong>BT-7274</strong>
          </div>
          <span className="fm-assistant-orb-link"><i /> READY</span>
        </div>
      )}

      <div ref={emotionStageRef} className="fm-assistant-orb-stage" style={{ '--assistant-level': displayLevel } as React.CSSProperties}>
        <div className="fm-assistant-orb-halo fm-assistant-orb-halo-one" />
        <div className="fm-assistant-orb-halo fm-assistant-orb-halo-two" />
        <div className="fm-assistant-orb-wave" aria-hidden="true">
          {barSeeds.map((seed, index) => {
            const pulse = 0.65 + Math.abs(Math.sin(index * 0.82 + level * 8)) * 0.75
            const height = compact ? 4 + displayLevel * 14 * seed * pulse : 7 + displayLevel * 27 * seed * pulse
            const radius = compact ? 27 : 42
            return <i key={index} style={{ height: `${height.toFixed(1)}px`, transform: `rotate(${(360 / barSeeds.length) * index}deg) translateY(-${radius}px)` }} />
          })}
        </div>
        <div className="fm-assistant-orb-core is-emotion-ball">
          <div ref={emotionHostRef} className="fm-assistant-emotion-ball" aria-label="可交互的 BT-7274 表情球" />
        </div>
      </div>

      {compact ? (
        <span className="fm-assistant-orb-meter">{displayPercent.toString().padStart(2, '0')}%</span>
      ) : (
        <div className="fm-assistant-orb-foot">
          <div><b>{copy.label}</b><span>{displayMessage}</span>{evidenceLabel && <em className="fm-assistant-evidence">{evidenceLabel}</em>}</div>
          <span className="fm-assistant-orb-meter">{displayPercent.toString().padStart(2, '0')}%</span>
        </div>
      )}
    </section>
  )
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
