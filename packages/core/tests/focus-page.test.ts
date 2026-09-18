import { describe, expect, it } from 'vitest';
import {
  FOCUS_DIVISIONS, FOCUS_MAX_TABS, FocusError, FocusLayoutSchema, FocusPageSchema, FocusSchema,
  changeDivision, closeTab, displayPanes, findFocusTab, focusPaneCount, focusTabCount, focusTabKey,
  foreignFocusTab, nameFocus, notebookFocuses, ownFocusPage, placeTab, pruneFocus, relocateFocusPaths, removeFocus, renameFocus, updateFocus,
} from '../src/focus-page.js';

const note = (path: string) => ({ kind: 'note' as const, path });
const lane = (id: string) => ({ kind: 'lane' as const, id });
const pane = (...tabs: { kind: string }[]) => ({ tabs });
const focus = (overrides: Record<string, unknown> = {}) => ({ division: 'single', panes: [pane()], id: 'f1', notebookId: 'nb1', name: 'Work', ...overrides });
const notes = (count: number) => Array.from({ length: count }, (_, index) => note(`n${index}.md`));

describe('Focus schema invariants', () => {
  it('requires the pane count to match the division', () => {
    expect(FocusLayoutSchema.safeParse({ division: 'grid-2x2', panes: [pane()] }).success).toBe(false);
    expect(FocusLayoutSchema.safeParse({ division: 'grid-2x2', panes: [pane(), pane(), pane(), pane()] }).success).toBe(true);
  });
  it('rejects the same note tab placed in two panes', () => {
    expect(FocusLayoutSchema.safeParse({ division: 'columns-2', panes: [pane(note('a.md')), pane(note('a.md'))] }).success).toBe(false);
  });
  it('caps total tabs at FOCUS_MAX_TABS across the whole layout', () => {
    expect(FocusLayoutSchema.safeParse({ division: 'single', panes: [pane(...notes(FOCUS_MAX_TABS))] }).success).toBe(true);
    expect(FocusLayoutSchema.safeParse({ division: 'single', panes: [pane(...notes(FOCUS_MAX_TABS + 1))] }).success).toBe(false);
  });
  it('caps focuses at 40 and rejects duplicate ids', () => {
    const focuses = Array.from({ length: 40 }, (_, index) => focus({ id: `f${index}`, name: `F${index}` }));
    expect(FocusPageSchema.safeParse({ version: 1, focuses }).success).toBe(true);
    expect(FocusPageSchema.safeParse({ version: 1, focuses: [...focuses, focus({ id: 'f40', name: 'F40' })] }).success).toBe(false);
    expect(FocusPageSchema.safeParse({ version: 1, focuses: [focus({ id: 'dup' }), focus({ id: 'dup', name: 'Other' })] }).success).toBe(false);
  });
  it('rejects duplicate names within a notebook but allows the same name across notebooks', () => {
    expect(FocusPageSchema.safeParse({ version: 1, focuses: [focus({ id: 'f1', name: 'Same' }), focus({ id: 'f2', name: 'Same' })] }).success).toBe(false);
    expect(FocusPageSchema.safeParse({ version: 1, focuses: [focus({ id: 'f1', name: 'Same', notebookId: 'a' }), focus({ id: 'f2', name: 'Same', notebookId: 'b' })] }).success).toBe(true);
  });
  it('rejects unknown keys everywhere the schemas are strict', () => {
    expect(FocusLayoutSchema.safeParse({ division: 'single', panes: [pane()], extra: 1 }).success).toBe(false);
    expect(FocusLayoutSchema.safeParse({ division: 'single', panes: [{ tabs: [], extra: 1 }] }).success).toBe(false);
    expect(FocusLayoutSchema.safeParse({ division: 'single', panes: [pane({ kind: 'note', path: 'a.md', extra: 1 })] }).success).toBe(false);
    expect(FocusSchema.safeParse({ ...focus(), extra: 1 }).success).toBe(false);
    expect(FocusPageSchema.safeParse({ version: 1, focuses: [], extra: 1 }).success).toBe(false);
  });
});

describe('changeDivision', () => {
  it('folds removed panes onto the last remaining pane, in pane order', () => {
    const layout = { division: 'major-left' as const, panes: [pane(note('a.md')), pane(note('b.md')), pane(note('c.md'))] };
    expect(changeDivision(layout, 'columns-2')).toEqual({ division: 'columns-2', panes: [pane(note('a.md')), pane(note('b.md'), note('c.md'))] });
  });
  it('merges every pane into one when shrinking to single', () => {
    const layout = { division: 'grid-2x2' as const, panes: [pane(note('a.md')), pane(note('b.md')), pane(note('c.md')), pane(note('d.md'))] };
    expect(changeDivision(layout, 'single')).toEqual({ division: 'single', panes: [pane(note('a.md'), note('b.md'), note('c.md'), note('d.md'))] });
  });
  it('appends empty panes when growing', () => {
    const layout = { division: 'single' as const, panes: [pane(note('a.md'))] };
    expect(changeDivision(layout, 'columns-2')).toEqual({ division: 'columns-2', panes: [pane(note('a.md')), pane()] });
  });
  it('returns the same reference for the same division, and preserves Focus fields', () => {
    const layout = { division: 'single' as const, panes: [pane()] };
    expect(changeDivision(layout, 'single')).toBe(layout);
    const named = focus({ division: 'columns-2', panes: [pane(note('a.md')), pane()] });
    expect(changeDivision(named, 'single')).toMatchObject({ id: 'f1', notebookId: 'nb1', name: 'Work' });
  });
});

describe('placeTab', () => {
  const layout = { division: 'columns-2' as const, panes: [pane(note('a.md'), note('b.md')), pane(note('c.md'))] };
  it('adds a new tab at the end of the target pane by default', () => {
    expect(placeTab(layout, note('d.md'), 1)).toEqual({ ...layout, panes: [layout.panes[0], pane(note('c.md'), note('d.md'))] });
  });
  it('inserts a new tab at a clamped index', () => {
    expect(placeTab(layout, note('d.md'), 0, 1)).toEqual({ ...layout, panes: [pane(note('a.md'), note('d.md'), note('b.md')), layout.panes[1]] });
    expect(placeTab(layout, note('d.md'), 0, -5)).toEqual({ ...layout, panes: [pane(note('d.md'), note('a.md'), note('b.md')), layout.panes[1]] });
    expect(placeTab(layout, note('d.md'), 0, 999)).toEqual({ ...layout, panes: [pane(note('a.md'), note('b.md'), note('d.md')), layout.panes[1]] });
  });
  it('moves an existing tab by removing it first, without duplicating it', () => {
    expect(placeTab(layout, note('b.md'), 1, 0)).toEqual({ division: 'columns-2', panes: [pane(note('a.md')), pane(note('b.md'), note('c.md'))] });
    expect(layout.panes[0].tabs).toEqual([note('a.md'), note('b.md')]);
  });
  it('throws invalid-pane for an out-of-range pane', () => {
    expect(() => placeTab(layout, note('d.md'), 2)).toThrow(FocusError);
    try { placeTab(layout, note('d.md'), -1); throw new Error('expected throw'); } catch (error) { expect((error as FocusError).code).toBe('invalid-pane'); }
  });
  it('throws tab-limit only when adding would exceed the cap, never when moving', () => {
    const full = { division: 'single' as const, panes: [pane(...notes(FOCUS_MAX_TABS))] };
    expect(() => placeTab(full, note('overflow.md'), 0)).toThrow(FocusError);
    try { placeTab(full, note('overflow.md'), 0); throw new Error('expected throw'); } catch (error) { expect((error as FocusError).code).toBe('tab-limit'); }
    expect(focusTabCount(placeTab(full, note('n5.md'), 0, 0))).toBe(FOCUS_MAX_TABS);
  });
});

describe('closeTab', () => {
  const layout = { division: 'single' as const, panes: [pane(note('a.md'), note('b.md'))] };
  it('removes the matching tab', () => {
    expect(closeTab(layout, focusTabKey(note('a.md')))).toEqual({ division: 'single', panes: [pane(note('b.md'))] });
  });
  it('returns the same reference for an unknown key', () => {
    expect(closeTab(layout, 'note:missing.md')).toBe(layout);
  });
});

describe('pruneFocus', () => {
  it('returns the same reference when nothing is dropped', () => {
    const layout = { division: 'single' as const, panes: [pane(note('a.md'), lane('l1'))] };
    expect(pruneFocus(layout, () => true)).toBe(layout);
  });
  it('drops tabs the predicate rejects', () => {
    const layout = { division: 'columns-2' as const, panes: [pane(note('a.md'), lane('l1')), pane(note('b.md'))] };
    const pruned = pruneFocus(layout, tab => tab.kind !== 'lane');
    expect(pruned).not.toBe(layout);
    expect(pruned).toEqual({ division: 'columns-2', panes: [pane(note('a.md')), pane(note('b.md'))] });
  });
});

describe('findFocusTab and focusTabCount', () => {
  it('locates a tab by key and counts tabs across panes', () => {
    const layout = { division: 'columns-2' as const, panes: [pane(note('a.md')), pane(note('b.md'), lane('l1'))] };
    expect(findFocusTab(layout, focusTabKey(note('b.md')))).toEqual({ pane: 1, index: 0 });
    expect(findFocusTab(layout, 'note:missing.md')).toBeUndefined();
    expect(focusTabCount(layout)).toBe(3);
  });
});

describe('displayPanes', () => {
  const cases: [typeof FOCUS_DIVISIONS[number], 1 | 2 | 4, typeof FOCUS_DIVISIONS[number], number[][]][] = [
    ['single', 4, 'single', [[0]]],
    ['columns-2', 4, 'columns-2', [[0], [1]]],
    ['rows-2', 4, 'rows-2', [[0], [1]]],
    ['major-left', 4, 'major-left', [[0], [1], [2]]],
    ['major-top', 4, 'major-top', [[0], [1], [2]]],
    ['columns-3', 4, 'columns-3', [[0], [1], [2]]],
    ['grid-2x2', 4, 'grid-2x2', [[0], [1], [2], [3]]],
    ['single', 2, 'single', [[0]]],
    ['columns-2', 2, 'columns-2', [[0], [1]]],
    ['rows-2', 2, 'rows-2', [[0], [1]]],
    ['major-left', 2, 'columns-2', [[0], [1, 2]]],
    ['major-top', 2, 'rows-2', [[0], [1, 2]]],
    ['columns-3', 2, 'columns-2', [[0], [1, 2]]],
    ['grid-2x2', 2, 'columns-2', [[0], [1, 2, 3]]],
    ['single', 1, 'single', [[0]]],
    ['columns-2', 1, 'single', [[0, 1]]],
    ['rows-2', 1, 'single', [[0, 1]]],
    ['major-left', 1, 'single', [[0, 1, 2]]],
    ['major-top', 1, 'single', [[0, 1, 2]]],
    ['columns-3', 1, 'single', [[0, 1, 2]]],
    ['grid-2x2', 1, 'single', [[0, 1, 2, 3]]],
  ];
  it('maps every division at capacities 1, 2 and 4', () => {
    for (const [division, capacity, expectedDivision, groups] of cases) {
      expect(displayPanes(division, capacity)).toEqual({ division: expectedDivision, groups });
    }
  });
  it('covers every division', () => {
    expect(new Set(cases.map(([division]) => division))).toEqual(new Set(FOCUS_DIVISIONS));
  });
});

describe('relocateFocusPaths', () => {
  const build = () => ({ version: 1 as const, focuses: [
    focus({ id: 'f1', notebookId: 'one', panes: [pane(note('notes/one/a.md'), lane('l1'))] }),
    focus({ id: 'f2', notebookId: 'two', name: 'Other', panes: [pane(note('notes/two/a.md'))] }),
  ] });
  it('rewrites note paths only for the matching notebook, mutating in place', () => {
    const page = build();
    const changed = relocateFocusPaths(page, 'one', path => path.replace('notes/one', 'notes/one-renamed'));
    expect(changed).toBe(true);
    expect(page.focuses[0].panes[0].tabs).toEqual([note('notes/one-renamed/a.md'), lane('l1')]);
    expect(page.focuses[1].panes[0].tabs).toEqual([note('notes/two/a.md')]);
  });
  it('returns false when nothing changes', () => {
    expect(relocateFocusPaths(build(), 'one', path => path)).toBe(false);
    expect(relocateFocusPaths(build(), 'missing', path => `${path}-x`)).toBe(false);
  });
});

describe('notebookFocuses, nameFocus, renameFocus, updateFocus and removeFocus', () => {
  const layout = { division: 'single' as const, panes: [pane(note('a.md'))] };
  it('lists a notebook Focuses in file order', () => {
    const page = { version: 1 as const, focuses: [focus({ id: 'f1', notebookId: 'a' }), focus({ id: 'f2', notebookId: 'b' }), focus({ id: 'f3', notebookId: 'a' })] };
    expect(notebookFocuses(page, 'a').map(f => f.id)).toEqual(['f1', 'f3']);
  });
  it('appends a named Focus and validates the resulting page', () => {
    const page = { version: 1 as const, focuses: [] };
    const { page: next, focus: created } = nameFocus(page, layout, 'nb1', '  Work  ');
    expect(created).toMatchObject({ notebookId: 'nb1', name: 'Work', division: 'single' });
    expect(typeof created.id).toBe('string');
    expect(next.focuses).toHaveLength(1);
    expect(() => FocusPageSchema.parse(next)).not.toThrow();
  });
  it('throws focus-limit at the cap and duplicate-name within a notebook', () => {
    const full = { version: 1 as const, focuses: Array.from({ length: 40 }, (_, index) => focus({ id: `f${index}`, name: `F${index}` })) };
    try { nameFocus(full, layout, 'nb1', 'Overflow'); throw new Error('expected throw'); } catch (error) { expect((error as FocusError).code).toBe('focus-limit'); }
    const page = { version: 1 as const, focuses: [focus({ id: 'f1', notebookId: 'nb1', name: 'Work' })] };
    try { nameFocus(page, layout, 'nb1', 'Work'); throw new Error('expected throw'); } catch (error) { expect((error as FocusError).code).toBe('duplicate-name'); }
    expect(nameFocus(page, layout, 'other', 'Work').focus.notebookId).toBe('other');
  });
  it('renames a Focus, allowing its own current name and rejecting a sibling collision', () => {
    const page = { version: 1 as const, focuses: [focus({ id: 'f1', notebookId: 'nb1', name: 'Work' }), focus({ id: 'f2', notebookId: 'nb1', name: 'Play' })] };
    expect(renameFocus(page, 'f1', 'Work').focuses[0].name).toBe('Work');
    expect(renameFocus(page, 'f1', '  Renamed  ').focuses[0].name).toBe('Renamed');
    try { renameFocus(page, 'f2', 'Work'); throw new Error('expected throw'); } catch (error) { expect((error as FocusError).code).toBe('duplicate-name'); }
    try { renameFocus(page, 'missing', 'X'); throw new Error('expected throw'); } catch (error) { expect((error as FocusError).code).toBe('unknown-focus'); }
  });
  it('updates a Focus through a pure change function and validates the result', () => {
    const page = { version: 1 as const, focuses: [focus({ id: 'f1', panes: [pane()] })] };
    const updated = updateFocus(page, 'f1', current => ({ ...current, panes: [pane(note('a.md'))] }));
    expect(updated.focuses[0].panes[0].tabs).toEqual([note('a.md')]);
    try { updateFocus(page, 'missing', current => current); throw new Error('expected throw'); } catch (error) { expect((error as FocusError).code).toBe('unknown-focus'); }
  });
  it('removes a Focus, leaving an unknown id unchanged', () => {
    const page = { version: 1 as const, focuses: [focus({ id: 'f1' }), focus({ id: 'f2', name: 'Other' })] };
    expect(removeFocus(page, 'f1').focuses.map(f => f.id)).toEqual(['f2']);
    expect(removeFocus(page, 'missing')).toBe(page);
  });
});

describe('Focus notebook ownership', () => {
  const notebooks = [{ id: 'work', root: 'notes/work' }, { id: 'other', root: 'notes/other' }];
  const screen = { version: 2 as const, rows: [
    { id: 'mine', notebookId: 'work', kind: 'custom' as const, name: 'Mine', view: 'small', items: [] },
    { id: 'theirs', notebookId: 'other', kind: 'custom' as const, name: 'Theirs', view: 'small', items: [] },
  ] } as never;
  it('rejects note and lane tabs owned by another notebook and keeps stale lanes for pruning', () => {
    expect(foreignFocusTab(note('notes/work/a.md'), 'work', notebooks, screen)).toBe(false);
    expect(foreignFocusTab(note('notes/other/outside.md'), 'work', notebooks, screen)).toBe(true);
    expect(foreignFocusTab(note('elsewhere/x.md'), 'work', notebooks, screen)).toBe(true);
    expect(foreignFocusTab(lane('mine'), 'work', notebooks, screen)).toBe(false);
    expect(foreignFocusTab(lane('theirs'), 'work', notebooks, screen)).toBe(true);
    expect(foreignFocusTab(lane('deleted'), 'work', notebooks, screen)).toBe(false);
  });
  it('drops cross-notebook tabs from a stored page', () => {
    const page = FocusPageSchema.parse({ version: 1, focuses: [focus({ notebookId: 'work', panes: [pane(note('notes/work/a.md'), note('notes/other/outside.md'), lane('theirs'))] })] });
    const owned = ownFocusPage(page, notebooks, screen);
    expect(owned.foreign).toBe(true);
    expect(owned.page.focuses[0].panes[0].tabs).toEqual([note('notes/work/a.md')]);
    expect(ownFocusPage(owned.page, notebooks, screen)).toEqual({ page: owned.page, foreign: false });
  });
});
