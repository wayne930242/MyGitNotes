import { createContext, type ReactNode, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { en } from '../i18n/en.js';
import { type I18nContextValue, useTranslation } from '../i18n/index.js';
import type { ParsedKeys } from '../keyboard/keys.js';
import { bindingsFor, hasKeymapEntry, type KeyHandler, KEYMAP, type KeyScope, type ShortcutGroup } from '../keyboard/keymap.js';
import { type KeyEnvironment, keyEnvironment } from '../keyboard/platform.js';

export type Availability = { enabled: true; } | { enabled: false; reason: string; };

export interface CommandRunContext {
  source: 'key' | 'palette' | 'help';
  /** The element focused before the palette or help opened; editor commands act on its editor. */
  previousFocus: HTMLElement | null;
}

export interface CommandSpec {
  /** A KEYMAP id, or a palette-only id such as `nav.graph` or `focus-division-grid-2x2`. */
  id: string;
  /** A dynamic label (Focus open or close); required without a KEYMAP entry. */
  title?: string;
  description?: string;
  keywords?: readonly string[];
  /** Required without a KEYMAP entry. */
  group?: ShortcutGroup;
  /** Evaluated when shown or fired; enabled by default. */
  availability?: () => Availability;
  run: (context: CommandRunContext) => void | Promise<void>;
  /** Listed in the palette; true by default. */
  palette?: boolean;
}

export interface ResolvedCommand {
  id: string;
  title: string;
  /** The palette matches it in every language. */
  englishTitle: string;
  description?: string;
  keywords: readonly string[];
  group: ShortcutGroup;
  /** From KEYMAP for this environment; empty for palette-only commands. */
  keys: readonly ParsedKeys[];
  /** Null for palette-only commands. */
  scopes: readonly KeyScope[] | null;
  handler: KeyHandler | null;
  /** A component registered behaviour for it here; a dispatcher key without one is "not available here". */
  registered: boolean;
  availability: Availability;
  palette: boolean;
  run?: CommandSpec['run'];
}

export class CommandRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandRegistryError';
  }
}

const ENABLED: Availability = { enabled: true };

/** The registered specs, read through their owners' refs so a fresh closure each render needs no re-registration. */
export class CommandStore {
  private readonly specs = new Map<string, () => CommandSpec | undefined>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  register(ids: readonly string[], read: (id: string) => CommandSpec | undefined): () => void {
    for (const id of ids) if (this.specs.has(id)) throw new CommandRegistryError(`Command "${id}" is registered twice`);
    for (const id of ids) this.specs.set(id, () => read(id));
    this.changed();
    return () => {
      for (const id of ids) this.specs.delete(id);
      this.changed();
    };
  }

  spec(id: string): CommandSpec | undefined {
    return this.specs.get(id)?.();
  }

  /** Registered ids in registration order. */
  ids(): readonly string[] {
    return [...this.specs.keys()];
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.version;

  private changed() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

/** Every KEYMAP entry, then the registered palette-only commands in registration order. */
export function resolveCommands(store: CommandStore, t: I18nContextValue['t'], env: KeyEnvironment = keyEnvironment): readonly ResolvedCommand[] {
  const keyed = KEYMAP.map((entry): ResolvedCommand => {
    const spec = store.spec(entry.id);
    return { id: entry.id, title: spec?.title ?? t(entry.title), englishTitle: en[entry.title], description: spec?.description ?? (entry.description && t(entry.description)), keywords: spec?.keywords ?? [], group: entry.group, keys: bindingsFor(entry, env), scopes: entry.scopes, handler: entry.handler, registered: Boolean(spec), availability: spec?.availability?.() ?? ENABLED, palette: spec ? spec.palette !== false : false, run: spec?.run };
  });
  const paletteOnly = store.ids().filter(id => !hasKeymapEntry(id)).map((id): ResolvedCommand => {
    const spec = store.spec(id)!;
    if (!spec.title || !spec.group) throw new CommandRegistryError(`Command "${id}" has no KEYMAP entry, so it needs a title and a group`);
    return { id, title: spec.title, englishTitle: spec.title, description: spec.description, keywords: spec.keywords ?? [], group: spec.group, keys: [], scopes: null, handler: null, registered: true, availability: spec.availability?.() ?? ENABLED, palette: spec.palette !== false, run: spec.run };
  });
  return [...keyed, ...paletteOnly];
}

const StoreContext = createContext<CommandStore | null>(null);

export function CommandRegistryProvider({ children }: { children: ReactNode; }) {
  const [store] = useState(() => new CommandStore());
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useCommandStore(): CommandStore {
  const store = useContext(StoreContext);
  if (!store) throw new CommandRegistryError('Commands are used outside CommandRegistryProvider');
  return store;
}

/** Registers on commit and unregisters on unmount; specs are read through a ref, so new closures each render do not re-register. */
export function useRegisterCommands(specs: readonly CommandSpec[]): void {
  const store = useCommandStore();
  const current = useRef(specs);
  /* eslint-disable react/refs -- Key handlers and the palette read the latest specs, including availability computed in this render. */
  current.current = specs;
  /* eslint-enable react/refs */
  const ids = specs.map(spec => spec.id).join('\n');
  useLayoutEffect(() => store.register(ids ? ids.split('\n') : [], id => current.current.find(spec => spec.id === id)), [ids, store]);
}

export function useCommands(): readonly ResolvedCommand[] {
  const store = useCommandStore();
  const { t } = useTranslation();
  useSyncExternalStore(store.subscribe, store.snapshot);
  return resolveCommands(store, t);
}

/** Runs a registered, enabled command; false when it is missing or unavailable. */
export function useRunCommand(): (id: string, context?: Partial<CommandRunContext>) => boolean {
  const store = useCommandStore();
  return useCallback((id, context = {}) => {
    const spec = store.spec(id);
    if (!spec || spec.availability?.().enabled === false) return false;
    void spec.run({ source: context.source ?? 'palette', previousFocus: context.previousFocus ?? null });
    return true;
  }, [store]);
}
