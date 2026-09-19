import { describe, expect, it } from 'vitest';
import { graphColorGroup, graphColorGroups, parseGraphAppearance } from './graph-colors.js';
import type { NotebookConfig } from './types.js';

const notebooks = [{ id: 'rules', title: 'Rules', root: 'notes/rules' }, { id: 'campaign', title: 'Campaign', root: 'notes/campaign' }] as NotebookConfig[];
const nodes = [{ id: 'notes/rules/combat/attacks.md', notebookId: 'rules', status: 'done' }, { id: 'notes/rules/combat/damage/table.md', notebookId: 'rules', status: 'done' }, { id: 'notes/rules/magic/spells.md', notebookId: 'rules', status: 'done' }, { id: 'notes/campaign/combat/encounter.md', notebookId: 'campaign', status: 'working' }];

describe('graph colors', () => {
  it('groups nested notes by the first folder and distinguishes notebooks', () => {
    expect(graphColorGroup(nodes[0], notebooks, 'folder')).toEqual(graphColorGroup(nodes[1], notebooks, 'folder'));
    expect(new Set(graphColorGroups(nodes, notebooks, { mode: 'folder', palette: 'soft' }).map(group => group.color)).size).toBe(3);
    expect(graphColorGroup({ ...nodes[0], id: 'notes/rules/index.md' }, notebooks, 'folder').label).toBe('Rules');
  });
  it('supports status and notebook coloring independently of folders', () => {
    expect(graphColorGroups(nodes, notebooks, { mode: 'status', palette: 'soft' })).toHaveLength(2);
    expect(graphColorGroups(nodes, notebooks, { mode: 'notebook', palette: 'soft' })).toHaveLength(2);
  });
  it('assigns stable colors regardless of note order and changes palettes', () => {
    const appearance = { mode: 'folder', palette: 'soft' } as const;
    expect(graphColorGroups([...nodes].reverse(), notebooks, appearance)).toEqual(graphColorGroups(nodes, notebooks, appearance));
    expect(graphColorGroups(nodes, notebooks, { ...appearance, palette: 'vivid' })[0].color).not.toBe(graphColorGroups(nodes, notebooks, appearance)[0].color);
  });
  it('restores valid preferences and defaults invalid saved fields', () => {
    expect(parseGraphAppearance('{"mode":"status","palette":"warm"}')).toEqual({ mode: 'status', palette: 'warm' });
    for (const raw of [null, 'null', '{broken', '{"mode":"unknown","palette":"unknown"}']) {
      expect(parseGraphAppearance(raw)).toEqual({ mode: 'folder', palette: 'soft' });
    }
  });
});
