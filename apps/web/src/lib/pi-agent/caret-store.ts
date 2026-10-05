/** The editor's caret offset, readable by the agent panel without re-rendering the editor on every move. */
export interface CaretStore {
  get: () => number;
  set: (offset: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createCaretStore(): CaretStore {
  let offset = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => offset,
    set: next => {
      if (next === offset) return;
      offset = next;
      for (const listener of listeners) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
