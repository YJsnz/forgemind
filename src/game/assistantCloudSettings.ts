export interface AssistantCloudSettings {
  contextEnabled: boolean
  ragEnabled: boolean
  projectMemoryEnabled: boolean
  userMemoryEnabled: boolean
}

export const ASSISTANT_CLOUD_SETTINGS_KEY = 'forgemind.assistant-cloud-settings.v1'

const DEFAULT_SETTINGS: AssistantCloudSettings = {
  contextEnabled: true,
  ragEnabled: true,
  projectMemoryEnabled: true,
  userMemoryEnabled: true,
}

export function readAssistantCloudSettings(): AssistantCloudSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const value = JSON.parse(window.localStorage.getItem(ASSISTANT_CLOUD_SETTINGS_KEY) ?? 'null') as Partial<AssistantCloudSettings> | null
    return {
      contextEnabled: value?.contextEnabled !== false,
      ragEnabled: value?.ragEnabled !== false,
      projectMemoryEnabled: value?.projectMemoryEnabled !== false,
      userMemoryEnabled: value?.userMemoryEnabled !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeAssistantCloudSettings(next: Partial<AssistantCloudSettings>): AssistantCloudSettings {
  const settings = { ...readAssistantCloudSettings(), ...next }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ASSISTANT_CLOUD_SETTINGS_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent('forgemind:assistant-cloud-settings', { detail: settings }))
  }
  return settings
}
