import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { CommandRegistryProvider, type CommandStore, useCommandStore } from '../commands/registry.js';
import { readKeyContext } from './context.js';
import { type CompositionTracker, createCompositionTracker, skipForComposition } from './ime.js';
import { matchesKeys } from './keys.js';
import { bindingApplies, KEYMAP, parsedBinding } from './keymap.js';
import { type KeyEnvironment, keyEnvironment } from './platform.js';

const CompositionContext = createContext<CompositionTracker | null>(null);

/** The one composition tracker the dispatcher and the palette input share. */
export function useCompositionTracker(): CompositionTracker {
  const tracker = useContext(CompositionContext);
  if (!tracker) throw new Error('useCompositionTracker is used outside KeyboardRoot');
  return tracker;
}

/** Dispatcher entries that must beat CodeMirror and focused widgets. */
const CAPTURE = KEYMAP.filter(entry => entry.handler === 'dispatcher' && entry.phase === 'capture');

/**
 * Runs a capture-phase dispatcher entry whose binding `event` presses, and reports whether it took the key. A key whose
 * command is not registered or not enabled here stays with the page and the browser.
 */
export function dispatchCapture(event: KeyboardEvent, store: CommandStore, tracker: CompositionTracker, env: KeyEnvironment = keyEnvironment): boolean {
  if (skipForComposition(event, tracker)) return false;
  const { scope } = readKeyContext(event);
  for (const entry of CAPTURE) {
    const pressed = entry.bindings.some(binding => bindingApplies(binding, env) && !(scope && binding.when?.exceptScopes?.includes(scope)) && matchesKeys(event, parsedBinding(binding), env));
    if (!pressed) continue;
    const spec = store.spec(entry.id);
    if (!spec || spec.availability?.().enabled === false) return false;
    event.preventDefault();
    event.stopPropagation();
    void spec.run({ source: 'key', previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
    return true;
  }
  return false;
}

/** The single document listener for the app's global chords. */
export function KeyboardDispatcher() {
  const store = useCommandStore();
  const tracker = useCompositionTracker();
  useEffect(() => {
    const capture = (event: KeyboardEvent) => {
      dispatchCapture(event, store, tracker);
    };
    document.addEventListener('keydown', capture, true);
    return () => document.removeEventListener('keydown', capture, true);
  }, [store, tracker]);
  return null;
}

/** The command registry, the composition tracker and the dispatcher, mounted once around the workspace. */
export function KeyboardRoot({ children }: { children: ReactNode; }) {
  const [tracker] = useState(createCompositionTracker);
  useEffect(() => tracker.attach(document), [tracker]);
  return (
    <CommandRegistryProvider>
      <CompositionContext.Provider value={tracker}>
        <KeyboardDispatcher />
        {children}
      </CompositionContext.Provider>
    </CommandRegistryProvider>
  );
}
