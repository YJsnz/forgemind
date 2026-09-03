export {}

declare global {
  interface EmotionBallEngine {
    spin(turns?: number, direction?: number): EmotionBallEngine
    setEmotion(id: string, options?: { auto?: boolean }): boolean
    startTour(ids: string[], interval?: number): void
    stopTour(): void
    setGaze(nx: number, ny: number): EmotionBallEngine
    clearGaze(): EmotionBallEngine
    setActive(active: boolean): void
    destroy(): void
  }

  interface EmotionBallApi {
    create(target: HTMLElement, options?: Record<string, unknown>): EmotionBallEngine
  }

  interface Window {
    EmotionBall?: EmotionBallApi
  }
}
