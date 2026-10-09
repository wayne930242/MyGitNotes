import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header.js';
import type { WorkspaceTab } from '../lib/routes.js';

vi.mock('./Select.js', () => ({ Select: ({ options, groups }: { options: { value: string; }[]; groups?: { label: string; values: string[]; }[]; }) => createElement('output', { 'data-options': options.map(option => option.value).join(','), 'data-groups': groups?.map(group => `${group.label}:${group.values.join('+')}`).join(',') }) }));

describe('Header notebook selector', () => {
  it.each(['notes', 'graph', 'assets', 'screen', 'agent', 'settings'] as WorkspaceTab[])('lists only notebooks on %s', activeTab => {
    const html = renderToStaticMarkup(createElement(Header, { workspaceTitle: 'Notes', activeTab, setActiveTab: () => {}, selectedNotebookId: 'work', notebooks: ['work', 'reading'].map(id => ({ id, title: id, root: `notes/${id}` })), onSelectNotebook: () => {}, onCreateNote: () => {}, onOpenCommands: () => {} }));
    expect(html).toContain('data-options="work,reading"');
  });

  it("lists notebooks under each repository's title when given groups, and shows the title it is given", () => {
    const html = renderToStaticMarkup(createElement(Header, { workspaceTitle: 'Campaign', notebookGroups: [{ label: 'Knowledge base', notebooks: ['kb~work'] }, { label: 'Campaign', notebooks: ['campaign~trpg'] }], activeTab: 'notes', setActiveTab: () => {}, selectedNotebookId: 'campaign~trpg', notebooks: ['kb~work', 'campaign~trpg'].map(id => ({ id, title: id, root: `notes/${id}` })), onSelectNotebook: () => {}, onCreateNote: () => {}, onOpenCommands: () => {} }));
    expect(html).toContain('data-groups="Knowledge base:kb~work,Campaign:campaign~trpg"');
    expect(html).toContain('<h1>Campaign</h1>');
  });
});
