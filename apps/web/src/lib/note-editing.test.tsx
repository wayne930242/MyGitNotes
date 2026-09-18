// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteEditingProvider, NoteHosts, useNoteEditing } from './note-editing.js';

afterEach(cleanup);

describe('NoteHosts', () => {
  it('gives a note to its first host, moves it on claim and falls back on release', () => {
    const hosts = new NoteHosts();
    const listener = vi.fn();
    hosts.subscribe(listener);
    hosts.register('notes/a.md', 'pane');
    hosts.register('notes/a.md', 'card');
    expect(hosts.owner('notes/a.md')).toBe('pane');
    hosts.claim('notes/a.md', 'card');
    expect(hosts.owner('notes/a.md')).toBe('card');
    hosts.release('notes/a.md', 'card');
    expect(hosts.owner('notes/a.md')).toBe('pane');
    hosts.release('notes/a.md', 'pane');
    expect(hosts.owner('notes/a.md')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it('ignores a claim from a host that is not registered for the note', () => {
    const hosts = new NoteHosts();
    hosts.register('notes/a.md', 'pane');
    hosts.claim('notes/a.md', 'card');
    expect(hosts.owner('notes/a.md')).toBe('pane');
  });
});

describe('claimEditor', () => {
  it('saves the owner before handing the note over, and keeps the owner when saving fails', async () => {
    let captured: ReturnType<typeof useNoteEditing> | undefined;
    const Probe = () => { captured = useNoteEditing(); return null; };
    const flushEditors = vi.fn(async (paths?: readonly string[]) => paths?.[0] !== 'notes/fail.md');
    render(createElement(NoteEditingProvider, {
      register: () => () => {}, editorProps: () => { throw new Error('unused'); }, flushEditors, refreshNotes: async () => {}, closeZoom: () => {}, addToFocus: () => undefined,
      children: createElement(Probe),
    }));
    const { hosts, claimEditor } = captured!;
    hosts.register('notes/a.md', 'pane'); hosts.register('notes/a.md', 'card');
    await expect(claimEditor('notes/a.md', 'card')).resolves.toBe(true);
    expect(flushEditors).toHaveBeenCalledWith(['notes/a.md']);
    expect(hosts.owner('notes/a.md')).toBe('card');
    hosts.register('notes/fail.md', 'pane'); hosts.register('notes/fail.md', 'card');
    await expect(claimEditor('notes/fail.md', 'card')).resolves.toBe(false);
    expect(hosts.owner('notes/fail.md')).toBe('pane');
  });

  it('serializes concurrent claims for the same note so the most recent one wins', async () => {
    let captured: ReturnType<typeof useNoteEditing> | undefined;
    const Probe = () => { captured = useNoteEditing(); return null; };
    const refreshResolvers: (() => void)[] = [];
    const refreshNotes = vi.fn(() => new Promise<void>(resolve => { refreshResolvers.push(resolve); }));
    render(createElement(NoteEditingProvider, {
      register: () => () => {}, editorProps: () => { throw new Error('unused'); }, flushEditors: async () => true, refreshNotes,
      closeZoom: () => {}, addToFocus: () => undefined, children: createElement(Probe),
    }));
    const { hosts, claimEditor } = captured!;
    hosts.register('notes/a.md', 'pane'); hosts.register('notes/a.md', 'card');

    // Two rapid claims for the same note, oldest first; the second's flush/refresh must not
    // start until the first's has fully settled, so ownership always lands on the last click.
    const first = claimEditor('notes/a.md', 'card');
    await vi.waitFor(() => expect(refreshNotes).toHaveBeenCalledTimes(1));
    const second = claimEditor('notes/a.md', 'pane');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refreshNotes).toHaveBeenCalledTimes(1);

    refreshResolvers[0]();
    await expect(first).resolves.toBe(true);
    expect(hosts.owner('notes/a.md')).toBe('card');
    await vi.waitFor(() => expect(refreshNotes).toHaveBeenCalledTimes(2));

    refreshResolvers[1]();
    await expect(second).resolves.toBe(true);
    expect(hosts.owner('notes/a.md')).toBe('pane');
  });

  it('hands the note over only after the notes the claiming host reads are refreshed', async () => {
    let captured: ReturnType<typeof useNoteEditing> | undefined;
    const Probe = () => { captured = useNoteEditing(); return null; };
    let refreshed!: () => void;
    const refreshNotes = vi.fn(() => new Promise<void>(resolve => { refreshed = resolve; }));
    render(createElement(NoteEditingProvider, {
      register: () => () => {}, editorProps: () => { throw new Error('unused'); }, flushEditors: async () => true, refreshNotes,
      closeZoom: () => {}, addToFocus: () => undefined, children: createElement(Probe),
    }));
    const { hosts, claimEditor } = captured!;
    hosts.register('notes/a.md', 'pane'); hosts.register('notes/a.md', 'card');
    const claim = claimEditor('notes/a.md', 'card');
    await vi.waitFor(() => expect(refreshNotes).toHaveBeenCalled());
    expect(hosts.owner('notes/a.md')).toBe('pane');
    refreshed();
    await expect(claim).resolves.toBe(true);
    expect(hosts.owner('notes/a.md')).toBe('card');
  });
});
