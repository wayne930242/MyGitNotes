/** The editor's selection as body offsets, `from` <= `to`; equal when nothing is selected. */
export interface CaretSelection {
  from: number;
  to: number;
}

/** The editor's caret or selection, readable by the agent panel without re-rendering the editor on every move. */
export interface CaretStore {
  /** The same object until the selection changes, as useSyncExternalStore needs. */
  get: () => CaretSelection;
  /** Takes the two ends in either order; a single offset is a caret without a selection. */
  set: (anchor: number, head?: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createCaretStore(): CaretStore {
  let selection: CaretSelection = { from: 0, to: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => selection,
    set: (anchor, head = anchor) => {
      const from = Math.min(anchor, head), to = Math.max(anchor, head);
      if (from === selection.from && to === selection.to) return;
      selection = { from, to };
      for (const listener of listeners) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
