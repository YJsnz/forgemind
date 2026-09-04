export type AssistantVoiceTurnState = 'waiting' | 'speaking' | 'finishing'

export interface AssistantVoiceTurnStopInput {
  elapsedMs: number
  speechStartedAtMs: number | null
  lastVoiceAtMs: number | null
  maxWaitMs: number
  maxTurnMs: number
  silenceMs: number
  minSpeechMs: number
}

/**
 * Deterministic VAD policy shared by the browser recorder and regression tests.
 * It only decides when a turn is complete; ASR and assistant reasoning remain
 * outside this module.
 */
export function shouldAutoStopAssistantTurn(input: AssistantVoiceTurnStopInput): boolean {
  if (input.elapsedMs >= input.maxTurnMs) return true
  if (input.speechStartedAtMs === null) return input.elapsedMs >= input.maxWaitMs
  if (input.lastVoiceAtMs === null) return false
  return input.elapsedMs - input.speechStartedAtMs >= input.minSpeechMs
    && input.elapsedMs - input.lastVoiceAtMs >= input.silenceMs
}
