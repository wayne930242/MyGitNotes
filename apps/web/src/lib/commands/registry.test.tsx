// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KEYMAP } from '../keyboard/keymap.js';
import { CommandRegistryProvider, type CommandSpec, CommandStore, resolveCommands, useCommands, useRegisterCommands, useRunCommand } from './registry.js';

afterEach(cleanup);

const t = (key: string) => `t:${key}`;
const wrapper = ({ children }: { children: ReactNode; }) => createElement(CommandRegistryProvider, null, children);

it('lists every KEYMAP entry, then the palette-only commands in registration order', () => {
  const store = new CommandStore();
  store.register(['nav.graph'], () => ({ id: 'nav.graph', title: 'Go to Graph', group: 'goTo', run: () => {} }));
  store.register(['help.open'], () => ({ id: 'help.open', run: () => {} }));
  const commands = resolveCommands(store, t as never);
  expect(commands).toHaveLength(KEYMAP.length + 1);
  expect(commands.at(-1)).toMatchObject({ id: 'nav.graph', title: 'Go to Graph', group: 'goTo', keys: [], registered: true });
  expect(commands.find(command => command.id === 'help.open')).toMatchObject({ title: 't:command.help.open', englishTitle: 'Keyboard shortcuts', registered: true, palette: true });
  // A dispatcher key nobody registered is listed, and marked as not registered here.
  expect(commands.find(command => command.id === 'palette.notes')).toMatchObject({ registered: false, palette: false });
});

it('refuses a duplicate id and a palette-only command without a title and group', () => {
  const store = new CommandStore();
  store.register(['note.new'], () => ({ id: 'note.new', title: 'New', group: 'general', run: () => {} }));
  expect(() => store.register(['note.new'], () => undefined)).toThrow(/registered twice/);
  store.register(['orphan'], () => ({ id: 'orphan', run: () => {} }));
  expect(() => resolveCommands(store, t as never)).toThrow(/needs a title and a group/);
});

it('reads the latest spec each render without re-registering, and unregisters on unmount', () => {
  const Commands = ({ label }: { label: string; }) => {
    useRegisterCommands([{ id: 'nav.notes', title: label, group: 'goTo', run: () => {} }]);
    return null;
  };
  const Probe = () => createElement('output', null, useCommands().find(command => command.id === 'nav.notes')?.title ?? 'none');
  const view = render(createElement(CommandRegistryProvider, null, createElement(Commands, { label: 'first' }), createElement(Probe)));
  expect(view.container.textContent).toBe('first');
  view.rerender(createElement(CommandRegistryProvider, null, createElement(Commands, { label: 'second' }), createElement(Probe)));
  expect(view.container.textContent).toBe('second');
  view.rerender(createElement(CommandRegistryProvider, null, createElement(Probe)));
  expect(view.container.textContent).toBe('none');
});

it('runs only registered, enabled commands', () => {
  const run = vi.fn();
  const specs: CommandSpec[] = [{ id: 'note.new', title: 'New', group: 'general', availability: () => ({ enabled: false, reason: 'read-only' }), run }, { id: 'nav.notes', title: 'Notes', group: 'goTo', run }];
  const { result } = renderHook(() => {
    useRegisterCommands(specs);
    return useRunCommand();
  }, { wrapper });
  act(() => {
    expect(result.current('note.new')).toBe(false);
    expect(result.current('missing')).toBe(false);
    expect(result.current('nav.notes')).toBe(true);
  });
  expect(run).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledWith({ source: 'palette', previousFocus: null });
});

it('fails loudly outside the provider', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => useCommands())).toThrow(/outside CommandRegistryProvider/);
});
