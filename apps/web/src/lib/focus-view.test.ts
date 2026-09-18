import { describe, expect, it } from 'vitest';
import type { FocusLayout, FocusTab } from '@mygitnotes/core/focus-page';
import {
  CURRENT_FOCUS, activatePane, browseTarget, displayedPanes, emptyFocusView, entryView, groupShown,
  readFocusView, showTab, shownAfterClose, sideTarget, type FocusEntryView, type FocusViewState,
} from './focus-view.js';

const note = (path: string): FocusTab => ({ kind: 'note', path });
const lane = (id: string): FocusTab => ({ kind: 'lane', id });
const pane = (...tabs: FocusTab[]) => ({ tabs });
const layout = (division: FocusLayout['division'], ...panes: ReturnType<typeof pane>[]): FocusLayout => ({ division, panes });
const entry = (overrides: Partial<FocusEntryView> = {}): FocusEntryView => ({ activePane: 0, shown: [], recent: [], ratios: {}, autoHide: [], ...overrides });
const state = (overrides: Partial<FocusViewState> = {}): FocusViewState => ({ ...emptyFocusView(), ...overrides });

describe('emptyFocusView', () => {
  it('starts with a single empty pane and default dock sizes', () => {
    expect(emptyFocusView()).toEqual({
      current: { division: 'single', panes: [{ tabs: [] }] },
      entries: {}, last: null, dock: { left: 320, top: 280, collapsed: false },
    });
  });
});

describe('readFocusView', () => {
  it('returns an empty view for non-object input', () => {
    for (const raw of [null, undefined, 42, 'garbage', [1, 2]]) expect(readFocusView(raw)).toEqual(emptyFocusView());
  });
  it('falls back to the empty layout when current fails the Focus schema', () => {
    expect(readFocusView({ current: { division: 'single', panes: [] } }).current).toEqual(emptyFocusView().current);
    expect(readFocusView({ current: 'nope' }).current).toEqual(emptyFocusView().current);
  });
  it('keeps a valid current layout', () => {
    const valid = layout('columns-2', pane(note('a.md')), pane());
    expect(readFocusView({ current: valid }).current).toEqual(valid);
  });
  it('drops individually invalid entries and keeps valid ones', () => {
    const valid = entry({ activePane: 1, shown: ['note:a.md', null], recent: [1, 0], ratios: { g: [50, 50] } });
    const raw = {
      entries: {
        good: valid,
        notAnObject: 42,
        badActivePane: { ...valid, activePane: 'x' },
        badShown: { ...valid, shown: [1, 2] },
        badRecent: { ...valid, recent: ['x'] },
        badRatios: { ...valid, ratios: { g: ['x'] } },
        badAutoHide: { ...valid, autoHide: ['yes'] },
      },
    };
    expect(readFocusView(raw).entries).toEqual({ good: valid });
  });
  it('reads an entry stored without autoHide as having none', () => {
    const { autoHide: _autoHide, ...older } = entry({ shown: ['note:a.md'] });
    expect(readFocusView({ entries: { f: older } }).entries.f).toEqual(entry({ shown: ['note:a.md'] }));
  });
  it('drops a non-object entries field entirely', () => {
    expect(readFocusView({ entries: 'nope' }).entries).toEqual({});
  });
  it('accepts current or a valid id for last, otherwise null', () => {
    expect(readFocusView({ last: CURRENT_FOCUS }).last).toBe(CURRENT_FOCUS);
    expect(readFocusView({ last: 'focus-1' }).last).toBe('focus-1');
    expect(readFocusView({ last: 'bad id with spaces' }).last).toBeNull();
    expect(readFocusView({ last: 7 }).last).toBeNull();
    expect(readFocusView({}).last).toBeNull();
  });
  it('falls back to each dock default individually', () => {
    expect(readFocusView({ dock: { left: 'x', top: 200, collapsed: 'true' } }).dock).toEqual({ left: 320, top: 200, collapsed: false });
    expect(readFocusView({ dock: { left: -10, top: 200, collapsed: true } }).dock).toEqual({ left: 320, top: 200, collapsed: true });
    expect(readFocusView({}).dock).toEqual(emptyFocusView().dock);
  });

  it('keeps a dock height stored under the legacy bottom key, preferring top', () => {
    expect(readFocusView({ dock: { left: 320, bottom: 400, collapsed: false } }).dock.top).toBe(400);
    expect(readFocusView({ dock: { top: 200, bottom: 400 } }).dock.top).toBe(200);
  });
});

describe('entryView', () => {
  const twoPane = layout('columns-2', pane(note('a.md'), note('b.md')), pane(lane('l1')));
  it('normalizes a fresh key against the layout', () => {
    expect(entryView(state(), 'missing', twoPane)).toEqual({
      activePane: 0, shown: ['note:a.md', 'lane:l1'], recent: [0, 1], ratios: {}, autoHide: [false, false],
    });
  });
  it('falls back to the first tab when the stored shown key is stale', () => {
    const stored = entry({ shown: ['note:gone.md', 'lane:gone'] });
    expect(entryView(state({ entries: { f: stored } }), 'f', twoPane).shown).toEqual(['note:a.md', 'lane:l1']);
  });
  it('shows null for a pane with no tabs', () => {
    const withEmpty = layout('columns-2', pane(note('a.md')), pane());
    expect(entryView(state(), 'f', withEmpty).shown).toEqual(['note:a.md', null]);
  });
  it('clamps an out-of-range activePane to 0', () => {
    for (const activePane of [-1, 2, 99]) {
      expect(entryView(state({ entries: { f: entry({ activePane }) } }), 'f', twoPane).activePane).toBe(0);
    }
    expect(entryView(state({ entries: { f: entry({ activePane: 1 }) } }), 'f', twoPane).activePane).toBe(1);
  });
  it('drops invalid or duplicate recent entries and appends missing panes ascending', () => {
    const stored = entry({ recent: [1, 1, -1, 99, 1] });
    expect(entryView(state({ entries: { f: stored } }), 'f', twoPane).recent).toEqual([1, 0]);
  });
  it('keeps one auto-hide flag per pane', () => {
    expect(entryView(state({ entries: { f: entry({ autoHide: [false, true, true] }) } }), 'f', twoPane).autoHide).toEqual([false, true]);
    expect(entryView(state({ entries: { f: entry({ autoHide: [true] }) } }), 'f', twoPane).autoHide).toEqual([true, false]);
  });
  it('passes ratios through unchanged', () => {
    const stored = entry({ ratios: { g: [30, 70] } });
    expect(entryView(state({ entries: { f: stored } }), 'f', twoPane).ratios).toEqual({ g: [30, 70] });
  });
});

describe('activatePane and showTab', () => {
  it('activatePane sets activePane and moves the pane to the front of recent', () => {
    const result = activatePane(entry({ activePane: 0, recent: [0, 2, 1] }), 1);
    expect(result).toEqual(entry({ activePane: 1, recent: [1, 0, 2] }));
  });
  it('showTab sets the shown key for the pane and activates it', () => {
    const result = showTab(entry({ shown: ['note:a.md', 'note:b.md'], recent: [0, 1] }), 1, 'note:c.md');
    expect(result).toEqual(entry({ activePane: 1, shown: ['note:a.md', 'note:c.md'], recent: [1, 0] }));
  });
});

describe('browseTarget', () => {
  it('opens into the active pane', () => {
    expect(browseTarget(entry({ activePane: 2 }))).toBe(2);
  });
});

describe('sideTarget', () => {
  it('returns the source pane when there is only one pane', () => {
    expect(sideTarget(entry({ recent: [0] }), 0, 1)).toBe(0);
  });
  it('returns the most recently used pane other than the source', () => {
    expect(sideTarget(entry({ recent: [2, 0, 1] }), 2, 3)).toBe(0);
    expect(sideTarget(entry({ recent: [0, 2, 1] }), 0, 3)).toBe(2);
  });
  it('falls back to the next pane when recent has no other pane', () => {
    expect(sideTarget(entry({ recent: [0] }), 0, 3)).toBe(1);
  });
});

describe('shownAfterClose', () => {
  const three = layout('columns-3', pane(note('a.md'), note('b.md'), note('c.md')), pane(), pane());
  it('prefers the next tab to the right', () => {
    expect(shownAfterClose(three, 'note:a.md')).toBe('note:b.md');
    expect(shownAfterClose(three, 'note:b.md')).toBe('note:c.md');
  });
  it('falls back to the tab on the left when there is no tab to the right', () => {
    expect(shownAfterClose(three, 'note:c.md')).toBe('note:b.md');
  });
  it('returns null when the pane becomes empty', () => {
    const single = layout('single', pane(note('only.md')));
    expect(shownAfterClose(single, 'note:only.md')).toBeNull();
  });
  it('returns null when the key is not in the layout', () => {
    expect(shownAfterClose(three, 'note:missing.md')).toBeNull();
  });
});

describe('groupShown', () => {
  const grouped = layout('columns-3', pane(note('a.md')), pane(note('b.md')), pane());
  it('shows the active pane when it is in the group', () => {
    const view = entry({ activePane: 1, shown: ['note:a.md', 'note:b.md', null] });
    expect(groupShown(view, grouped, [1, 2])).toEqual({ pane: 1, key: 'note:b.md' });
  });
  it('falls back to the first pane in the group with a shown key', () => {
    const view = entry({ activePane: 0, shown: ['note:a.md', 'note:b.md', null] });
    expect(groupShown(view, grouped, [1, 2])).toEqual({ pane: 1, key: 'note:b.md' });
  });
  it('falls back to the first group pane with a null key when none has a shown tab', () => {
    const view = entry({ activePane: 0, shown: ['note:a.md', null, null] });
    expect(groupShown(view, grouped, [1, 2])).toEqual({ pane: 1, key: null });
  });
  it('ignores a shown key that is stale against the layout', () => {
    const view = entry({ activePane: 1, shown: ['note:a.md', 'note:gone.md', null] });
    expect(groupShown(view, grouped, [1, 2])).toEqual({ pane: 1, key: null });
  });
});

describe('displayedPanes', () => {
  const grid = layout('grid-2x2', pane(note('a.md')), pane(note('b.md')), pane(note('c.md')), pane(note('d.md')));
  const shown = ['note:a.md', 'note:b.md', 'note:c.md', 'note:d.md'];
  it('shows every stored pane when the screen has room', () => {
    expect(displayedPanes(entry({ shown }), grid, 4)).toEqual({ division: 'grid-2x2', panes: [0, 1, 2, 3].map(index => ({ panes: [index], pane: index, key: shown[index] })) });
  });
  it('folds the extra panes into the second pane and follows the active pane', () => {
    expect(displayedPanes(entry({ shown, activePane: 3 }), grid, 2)).toEqual({ division: 'columns-2', panes: [
      { panes: [0], pane: 0, key: 'note:a.md' }, { panes: [1, 2, 3], pane: 3, key: 'note:d.md' },
    ] });
  });
  it('shows one pane on a phone', () => {
    expect(displayedPanes(entry({ shown, activePane: 2 }), grid, 1)).toEqual({ division: 'single', panes: [{ panes: [0, 1, 2, 3], pane: 2, key: 'note:c.md' }] });
  });
});
