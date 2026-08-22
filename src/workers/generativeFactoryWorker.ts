/// <reference lib="webworker" />

import { evaluateWhatIf, generateFactoryAdjustments, generateFactoryCandidates } from '../game/generativeFactory'
import type { GeneratedCandidate, GenerationSpec, WhatIfMutation } from '../game/generativeFactory'
import type { FactoryObject } from '../game/types'

interface LayoutRequest {
  requestId: string
  kind: 'layout'
  request: {
    mode: 'generate' | 'adjust'
    spec: GenerationSpec
    factoryKey: string
    currentObjects?: FactoryObject[]
  }
}

interface WhatIfRequest {
  requestId: string
  kind: 'what-if'
  request: {
    baseObjects: FactoryObject[]
    spec: GenerationSpec
    mutation: WhatIfMutation
    factoryKey: string
  }
}

self.onmessage = (event: MessageEvent<LayoutRequest | WhatIfRequest>) => {
  const { requestId, kind, request } = event.data
  try {
    if (kind === 'what-if') {
      const result = evaluateWhatIf(request.baseObjects, request.spec, request.mutation, request.factoryKey)
      self.postMessage({ requestId, ok: true, result })
      return
    }
    const candidates: GeneratedCandidate[] = request.mode === 'adjust'
      ? generateFactoryAdjustments(request.currentObjects ?? [], request.spec, request.factoryKey)
      : generateFactoryCandidates(request.spec, request.factoryKey)
    self.postMessage({ requestId, ok: true, result: candidates })
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : '黛玉规划运行失败',
    })
  }
}

export {}
