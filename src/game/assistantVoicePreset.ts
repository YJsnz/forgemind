export const BT_SELF_INTRO_ANSWER = '我是 BT-7274，ForgeMind 的工厂智能管家。我负责读取工厂事实、解释运行状态、辅助诊断，并在校验和确认后执行操作。'
export const BT_SELF_INTRO_AUDIO_URL = '/audio/bt-self-intro.wav'

/** 兼容 ASR 对 BT 的常见转写，但只命中固定的自我介绍意图。 */
export function isBtSelfIntroRequest(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/^\s*(?:b\s*t|逼提|比提)\s*/u, '')
    .replace(/[，。！？!?、,:：;；\s]/gu, '')
  return normalized === '介绍一下你自己'
    || normalized === '请介绍一下你自己'
    || normalized === '介绍下你自己'
    || normalized === '介绍你自己'
    || normalized === '你是谁'
}
