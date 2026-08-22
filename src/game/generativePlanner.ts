import {
  evaluateWhatIf,
  generateFactoryAdjustments,
  generateFactoryCandidates,
} from './generativeFactory'
import type {
  GeneratedCandidate,
  GenerationSpec,
  WhatIfMutation,
  WhatIfResult,
} from './generativeFactory'
import type { FactoryObject } from './types'

export interface GenerativePlannerRequest {
  mode: 'generate' | 'adjust'
  spec: GenerationSpec
  factoryKey: string
  currentObjects?: FactoryObject[]
}

export interface GenerativeWhatIfRequest {
  baseObjects: FactoryObject[]
  spec: GenerationSpec
  mutation: WhatIfMutation
  factoryKey: string
}

export interface GenerativePlannerTask<T> {
  promise: Promise<T>
  cancel: () => void
}

type WorkerJob =
  | { kind: 'layout'; request: GenerativePlannerRequest }
  | { kind: 'what-if'; request: GenerativeWhatIfRequest }

interface WorkerResponse<T> {
  requestId: string
  ok: boolean
  result?: T
  error?: string
}

function cancelledError(): Error {
  const error = new Error('已取消当前黛玉规划')
  error.name = 'AbortError'
  return error
}

function runLayoutLocally(request: GenerativePlannerRequest): GeneratedCandidate[] {
  return request.mode === 'adjust'
    ? generateFactoryAdjustments(request.currentObjects ?? [], request.spec, request.factoryKey)
    : generateFactoryCandidates(request.spec, request.factoryKey)
}

function startWorkerTask<T>(job: WorkerJob, local: () => T, timeoutMessage: string): GenerativePlannerTask<T> {
  if (typeof Worker === 'undefined') {
    let cancelled = false
    const promise = new Promise<T>((resolve, reject) => {
      queueMicrotask(() => {
        if (cancelled) {
          reject(cancelledError())
          return
        }
        try {
          resolve(local())
        } catch (error) {
          reject(error instanceof Error ? error : new Error('黛玉规划运行失败'))
        }
      })
    })
    return { promise, cancel: () => { cancelled = true } }
  }

  const worker = new Worker(new URL('../workers/generativeFactoryWorker.ts', import.meta.url), {
    type: 'module',
    name: 'forgemind-daiyu-planner',
  })
  const requestId = `generative-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  let settled = false
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
  let rejectPromise: ((reason?: unknown) => void) | null = null

  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject
    timeout = globalThis.setTimeout(() => {
      settled = true
      worker.terminate()
      reject(new Error(timeoutMessage))
    }, 300_000)
    worker.onmessage = (event: MessageEvent<WorkerResponse<T>>) => {
      if (event.data.requestId !== requestId || settled) return
      settled = true
      if (timeout !== undefined) globalThis.clearTimeout(timeout)
      worker.terminate()
      if (event.data.ok && event.data.result !== undefined) resolve(event.data.result)
      else reject(new Error(event.data.error ?? '黛玉规划运行失败'))
    }
    worker.onerror = (event) => {
      if (settled) return
      settled = true
      if (timeout !== undefined) globalThis.clearTimeout(timeout)
      worker.terminate()
      reject(new Error(event.message || '黛玉规划 Worker 加载失败'))
    }
    worker.postMessage({ requestId, ...structuredClone(job) })
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      if (timeout !== undefined) globalThis.clearTimeout(timeout)
      worker.terminate()
      rejectPromise?.(cancelledError())
      rejectPromise = null
    },
  }
}

/** Runs the deterministic Daiyu layout search outside the UI thread. */
export function startGenerativePlanner(request: GenerativePlannerRequest): GenerativePlannerTask<GeneratedCandidate[]> {
  return startWorkerTask(
    { kind: 'layout', request },
    () => runLayoutLocally(request),
    '黛玉规划运行超时，请降低搜索轮次后重试',
  )
}

/** Keeps What-if simulations off the UI thread as well. */
export function startGenerativeWhatIf(request: GenerativeWhatIfRequest): GenerativePlannerTask<WhatIfResult> {
  return startWorkerTask(
    { kind: 'what-if', request },
    () => evaluateWhatIf(request.baseObjects, request.spec, request.mutation, request.factoryKey),
    'What-if 仿真运行超时，请降低搜索轮次后重试',
  )
}
