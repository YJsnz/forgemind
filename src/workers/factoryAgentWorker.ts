/// <reference lib="webworker" />
import { analyzeFactory, buildFactoryPatchProposal } from '../game/factoryAgent'
import type { AgentWorkerRequest } from '../game/agentWorker'

interface Request {
  requestId: string
  input: AgentWorkerRequest
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { requestId, input } = event.data
  try {
    const analysis = input.analysis ?? analyzeFactory(input.objective, input.context, input.mode)
    const patch = input.buildPatch ? buildFactoryPatchProposal(analysis, input.context) : null
    self.postMessage({ requestId, ok: true, result: { analysis, patch } })
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : 'Agent Worker 执行失败' })
  }
}

export {}
