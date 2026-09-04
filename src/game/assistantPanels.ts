import type { AssistantPanelId } from './assistantProtocol'

export type AssistantPanelCommand =
  | { action: 'open_panel' | 'close_panel' | 'focus_panel'; panelId: AssistantPanelId }
  | { action: 'compare_panels'; leftPanelId: AssistantPanelId; rightPanelId: AssistantPanelId }
  | { action: 'show_task'; taskId: string }
  | { action: 'open_product'; productId: 'forgemind' | 'forgehub' | 'forgelab' | 'forgecloud' }
  | { action: 'select_floor'; floorId: number }
  | { action: 'locate_object'; objectId: string }

/**
 * UI-only bridge for assistant navigation. The App owns the actual view state;
 * this module keeps the tool executor independent from React components.
 */
export function dispatchAssistantPanelCommand(command: AssistantPanelCommand): void {
  window.dispatchEvent(new CustomEvent<AssistantPanelCommand>('forgemind:assistant-panel', { detail: command }))
}
