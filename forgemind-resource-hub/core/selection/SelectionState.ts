import type { CadSelection, CadSelectionMode } from "./SelectionTypes.ts";

/** Small immutable-friendly selection state with no React, Three.js, or OCCT dependency. */
export interface CadSelectionState {
  mode: CadSelectionMode;
  selection?: CadSelection;
}

export const createCadSelectionState = (mode: CadSelectionMode = "body"): CadSelectionState => ({ mode });

export const withSelectionMode = (state: CadSelectionState, mode: CadSelectionMode): CadSelectionState =>
  state.selection?.kind === mode ? { ...state, mode } : { mode };

export const withCadSelection = (state: CadSelectionState, selection: CadSelection): CadSelectionState =>
  state.mode === selection.kind ? { ...state, selection } : { mode: selection.kind, selection };
