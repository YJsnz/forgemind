/**
 * Repair labels that were persisted after UTF-8 text was decoded as
 * Windows-1252/Latin-1. Keep this helper independent from save/types modules
 * so both persistence and live scene display can use the same normalization.
 */
const WINDOWS_1252_EXTENDED_BYTES: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c,
  0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b,
  0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f,
}

const MOJIBAKE_MARKERS = /[ÃÂâåäæçèéïðòöü]|[\u0080-\u009f]|[ŽŸŠšŒœžÿ–—…™�]/g

function decodeWindows1252AsUtf8(value: string): string | null {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const output: string[] = []
    let bytes: number[] = []
    const flushBytes = () => {
      if (bytes.length > 0) {
        output.push(decoder.decode(Uint8Array.from(bytes)))
        bytes = []
      }
    }
    for (const character of Array.from(value)) {
      const code = character.charCodeAt(0)
      const mapped = WINDOWS_1252_EXTENDED_BYTES[code]
      if (code <= 0xff || mapped !== undefined) {
        bytes.push(code <= 0xff ? code : mapped)
      } else {
        flushBytes()
        output.push(character)
      }
    }
    flushBytes()
    return output.join('')
  } catch {
    return null
  }
}

function suspiciousScore(value: string): number {
  return (value.match(MOJIBAKE_MARKERS) ?? []).length
}

function chineseCount(value: string): number {
  return (value.match(/[\u3400-\u9fff]/g) ?? []).length
}

function repairMojibake(value: string): string {
  let best = value.split('äŽŸ').join('åŽŸ')
  let current = best
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (suspiciousScore(current) === 0) break
    const repaired = decodeWindows1252AsUtf8(current)
    if (!repaired || chineseCount(repaired) <= chineseCount(best)) break
    if (suspiciousScore(repaired) >= suspiciousScore(best)) break
    best = repaired
    current = repaired
  }
  return best
}

export function normalizeStoredLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const label = repairMojibake(value.trim())
  return (label.match(/\?/g)?.length ?? 0) >= 3 || label.includes('�') ? fallback : label
}
