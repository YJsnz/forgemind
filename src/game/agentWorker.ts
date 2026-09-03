import type { AgentFactoryContext, AgentMode, AgentAnalysisResult, FactoryPatch } from './agentTypes'
import { analyzeFactory, buildFactoryPatchProposal } from './factoryAgent'

export interface AgentWorkerRequest {
  objective: string
  context: AgentFactoryContext
  mode: AgentMode
  buildPatch: boolean
  analysis?: AgentAnalysisResult
}

export interface AgentWorkerResult {
  analysis: AgentAnalysisResult
  patch: FactoryPatch | null
}

export interface AgentWorkerTask {
  promise: Promise<AgentWorkerResult>
  cancel: () => void
}

interface WorkerResponse {
  requestId: string
  ok: boolean
  result?: AgentWorkerResult
  error?: string
}

let sequence = 0

/** Run Agent analysis and proposal generation outside the browser UI thread. */
export function runAgentInWorker(input: AgentWorkerRequest): AgentWorkerTask {
  const requestId = `agent-${Date.now().toString(36)}-${sequence += 1}`
  if (typeof Worker === 'undefined') {
    let cancelled = false
    const promise = new Promise<AgentWorkerResult>((resolve, reject) => {
      queueMicrotask(() => {
        if (cancelled) {
          reject(new Error('Agent 运行已取消'))
          return
        }
        try {
          const analysis = input.analysis ?? analyzeFactory(input.objective, input.context, input.mode)
          resolve({ analysis, patch: input.buildPatch ? buildFactoryPatchProposal(analysis, input.context) : null })
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Agent 运行失败'))
        }
      })
    })
    return { promise, cancel: () => { cancelled = true } }
  }

  let worker: Worker
  try {
    worker = new Worker(new URL('../workers/factoryAgentWorker.ts', import.meta.url), {
      type: 'module',
      name: 'forgemind-agent',
    })
  } catch (error) {
    return {
      promise: Promise.reject(error instanceof Error ? error : new Error('Agent Worker 加载失败')),
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
  const promise = new Promise<AgentWorkerResult>((resolve, reject) => {
    rejectPromise = reject
    const timeout = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(input.analysis && input.buildPatch ? '方案生成超时，请先缩小诊断范围或稍后重试' : 'Agent 分析超时，请缩小工厂范围或稍后重试'))
    }, input.analysis && input.buildPatch ? 20_000 : 120_000)
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId !== requestId || settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      cleanup()
      if (event.data.ok && event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? 'Agent 运行失败'))
    }
    worker.onerror = (event) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      cleanup()
      reject(new Error(event.message || 'Agent Worker 执行失败'))
    }
    worker.postMessage({ requestId, input: structuredClone(input) })
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      cleanup()
      rejectPromise(new Error('Agent 运行已取消'))
    },
  }
}
