/** 保留屏幕原文，只从 BT 的朗读副本中移除英文单词、缩写和对象 ID。 */
export function stripEnglishFromSpeech(text: string): string {
  return text
    .replace(/[A-Za-z][A-Za-z0-9_.:/\\-]*/g, ' ')
    .replace(/\s+([，。！？!?；;：:、])/g, '$1')
    .replace(/([，。！？!?；;：:、])(?:\s*\1)+/g, '$1')
    .replace(/^[\s，。！？!?；;：:、]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .trim()
}
