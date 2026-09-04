/**
 * Assistant-only browser storage namespace. The raw auth token is never put
 * into a storage key; a short deterministic hash only separates local data
 * between signed-in users on this browser.
 */
export function assistantScopedStorageKey(baseKey: string): string {
  if (typeof window === 'undefined') return `${baseKey}.anonymous`
  const identity = window.localStorage.getItem('forgemind.token') ?? 'anonymous'
  return `${baseKey}.${hash(identity)}`
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}
