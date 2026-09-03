import type { AutopilotCycleInput, AutopilotCycleResult } from './factoryAutopilot'

interface WorkerResponse {
  requestId: string
  ok: boolean
  result?: AutopilotCycleResult
  error?: string
}

export interface AutopilotWorkerHandle {
  promise: Promise<AutopilotCycleResult>
  cancel: () => void
}

let sequence = 0

/** Run the expensive deterministic evidence cycle away from the UI thread. */
export function runAutopilotCycleInWorker(input: AutopilotCycleInput): AutopilotWorkerHandle {
  const requestId = `autopilot-${Date.now()}-${sequence += 1}`
  let worker: Worker
  try {
    worker = new Worker(new URL('../workers/factoryAutopilotWorker.ts', import.meta.url), {
      type: 'module',
      name: 'forgemind-autopilot',
    })
  } catch (error) {
    return {
      promise: Promise.reject(error instanceof Error ? error : new Error('自动巡检 Worker 加载失败')),
      cancel: () => undefined,
    }
  }

  let settled = false
  let rejectPromise: (reason?: unknown) => void = () => undefined
  const cleanup = () => {
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
  }
  const promise = new Promise<AutopilotCycleResult>((resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId !== requestId || settled) return
      settled = true
      cleanup()
      if (event.data.ok && event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? '自动巡检执行失败'))
    }
    worker.onerror = (event) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(event.message || '自动巡检 Worker 执行失败'))
    }
    worker.postMessage({ requestId, input })
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      cleanup()
      rejectPromise(new Error('自动巡检已取消'))
    },
  }
}
