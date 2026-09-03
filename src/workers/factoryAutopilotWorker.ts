/// <reference lib="webworker" />

import { runAutopilotCycle } from '../game/factoryAutopilot'
import type { AutopilotCycleInput, AutopilotCycleResult } from '../game/factoryAutopilot'

interface Request {
  requestId: string
  input: AutopilotCycleInput
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { requestId, input } = event.data
  try {
    const result = runAutopilotCycle(input)
    self.postMessage({ requestId, ok: true, result })
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : '自动巡检 Worker 执行失败',
    })
  }
}

export type { AutopilotCycleInput, AutopilotCycleResult }
export {}
