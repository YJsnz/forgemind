import { shouldAutoStopAssistantTurn } from '../src/game/assistantVoiceSession'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

assert(!shouldAutoStopAssistantTurn({ elapsedMs: 1_000, speechStartedAtMs: null, lastVoiceAtMs: null, maxWaitMs: 9_000, maxTurnMs: 9_000, silenceMs: 760, minSpeechMs: 360 }), 'quiet lead-in must remain open')
assert(shouldAutoStopAssistantTurn({ elapsedMs: 9_000, speechStartedAtMs: null, lastVoiceAtMs: null, maxWaitMs: 9_000, maxTurnMs: 9_000, silenceMs: 760, minSpeechMs: 360 }), 'quiet lead-in must hit the hard wait limit')
assert(!shouldAutoStopAssistantTurn({ elapsedMs: 1_200, speechStartedAtMs: 700, lastVoiceAtMs: 1_150, maxWaitMs: 9_000, maxTurnMs: 9_000, silenceMs: 760, minSpeechMs: 360 }), 'short pause must not cut a turn')
assert(shouldAutoStopAssistantTurn({ elapsedMs: 2_000, speechStartedAtMs: 700, lastVoiceAtMs: 1_100, maxWaitMs: 9_000, maxTurnMs: 9_000, silenceMs: 760, minSpeechMs: 360 }), 'speech plus silence must close a turn')
assert(shouldAutoStopAssistantTurn({ elapsedMs: 9_000, speechStartedAtMs: 700, lastVoiceAtMs: 8_900, maxWaitMs: 9_000, maxTurnMs: 9_000, silenceMs: 760, minSpeechMs: 360 }), 'hard turn limit must always close a turn')

console.log('Assistant voice session regression PASS: VAD turn boundaries and hard limits')
