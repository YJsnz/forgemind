import { ASSISTANT_VOICE_DEFAULTS, shouldAutoStopAssistantTurn } from '../src/game/assistantVoiceSession'
import { isBtSelfIntroRequest } from '../src/game/assistantVoicePreset'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const defaults = ASSISTANT_VOICE_DEFAULTS
assert(!shouldAutoStopAssistantTurn({ elapsedMs: 1_000, speechStartedAtMs: null, lastVoiceAtMs: null, ...defaults }), 'quiet lead-in must remain open')
assert(shouldAutoStopAssistantTurn({ elapsedMs: defaults.maxWaitMs, speechStartedAtMs: null, lastVoiceAtMs: null, ...defaults }), 'quiet lead-in must hit the hard wait limit')
assert(!shouldAutoStopAssistantTurn({ elapsedMs: 1_200, speechStartedAtMs: 700, lastVoiceAtMs: 1_150, ...defaults }), 'short pause must not cut a turn')
assert(shouldAutoStopAssistantTurn({ elapsedMs: 1_700, speechStartedAtMs: 700, lastVoiceAtMs: 1_200, ...defaults }), 'speech plus silence must close a turn')
assert(shouldAutoStopAssistantTurn({ elapsedMs: defaults.maxTurnMs, speechStartedAtMs: 700, lastVoiceAtMs: defaults.maxTurnMs - 100, ...defaults }), 'hard turn limit must always close a turn')
assert(isBtSelfIntroRequest('BT，介绍一下你自己。'), 'exact BT self-intro request must use the static preset')
assert(isBtSelfIntroRequest('比提，请介绍一下你自己'), 'common ASR spelling must use the static preset')
assert(isBtSelfIntroRequest('介绍一下你自己'), 'wake-word-stripped request must use the static preset')
assert(!isBtSelfIntroRequest('BT，介绍一下当前工厂'), 'other BT requests must continue through the assistant')

console.log('Assistant voice session regression PASS: VAD turn boundaries and hard limits')
