import { stripEnglishFromSpeech } from '../src/game/assistantSpeech'

function assertEqual(actual: string, expected: string, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected “${expected}”, got “${actual}”`)
}

assertEqual(
  stripEnglishFromSpeech('多域诊断完成：3 条 Finding，最高严重度 critical。'),
  '多域诊断完成：3 条，最高严重度。',
  'mixed Chinese and English',
)
assertEqual(
  stripEnglishFromSpeech('simple_l3_pickup 当前处于 blocked 状态。'),
  '当前处于状态。',
  'object ids and status words',
)
assertEqual(stripEnglishFromSpeech('BT-7274 READY'), '', 'English-only fragment')
assertEqual(stripEnglishFromSpeech('吞吐 12.3 件/分钟'), '吞吐 12.3 件/分钟', 'Chinese and numbers')

console.log('assistant speech filter regression: PASS')
