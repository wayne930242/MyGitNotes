import type { NoteGraphNode } from '@mygitnotes/core/note-graph';
import type { NotebookConfig } from './types.js';

export const GRAPH_COLOR_MODES = ['folder', 'notebook', 'status'] as const;
export const GRAPH_PALETTES = ['soft', 'vivid', 'warm'] as const;
export type GraphAppearance = { mode: typeof GRAPH_COLOR_MODES[number]; palette: typeof GRAPH_PALETTES[number]; };
export const DEFAULT_GRAPH_APPEARANCE: GraphAppearance = { mode: 'folder', palette: 'soft' };
export const GRAPH_APPEARANCE_KEY = 'github-notes:graph-appearance';
// Graph groups cycle through the active theme's accents; each scheme is a token expression.
const accentTokens = ['accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-5', 'accent-6', 'primary', 'info'];
const palettes = { soft: accentTokens.map(token => `color-mix(in srgb, var(--color-${token}) 60%, var(--color-surface))`), vivid: accentTokens.map(token => `var(--color-${token})`), warm: accentTokens.map(token => `color-mix(in srgb, var(--color-${token}) 65%, var(--color-warning))`) };

export function parseGraphAppearance(raw: string | null): GraphAppearance {
  try {
    const value = JSON.parse(raw || 'null');
    return { mode: GRAPH_COLOR_MODES.includes(value?.mode) ? value.mode : DEFAULT_GRAPH_APPEARANCE.mode, palette: GRAPH_PALETTES.includes(value?.palette) ? value.palette : DEFAULT_GRAPH_APPEARANCE.palette };
  } catch {
    return { ...DEFAULT_GRAPH_APPEARANCE };
  }
}

export function readGraphAppearance(): GraphAppearance {
  try {
    return parseGraphAppearance(localStorage.getItem(GRAPH_APPEARANCE_KEY));
  } catch {
    return { ...DEFAULT_GRAPH_APPEARANCE };
  }
}

type ColorNode = Pick<NoteGraphNode, 'id' | 'notebookId' | 'status'>;
export function graphColorGroup(node: ColorNode, notebooks: NotebookConfig[], mode: GraphAppearance['mode']) {
  if (mode === 'status') return { key: node.status || '', label: node.status || '' };
  const notebook = notebooks.find(nb => nb.id === node.notebookId);
  const title = notebook?.title || node.notebookId;
  if (mode === 'notebook') return { key: node.notebookId, label: title };
  const root = notebook?.root.replace(/\/$/, '') || '';
  const relative = root && node.id.startsWith(root + '/') ? node.id.slice(root.length + 1) : node.id;
  const folder = relative.includes('/') ? relative.split('/')[0] : '';
  return { key: JSON.stringify([node.notebookId, folder]), label: folder ? `${title} / ${folder}` : title };
}

// Use the complete note collection so filtering leaves category colors unchanged.
export function graphColorGroups(nodes: ColorNode[], notebooks: NotebookConfig[], appearance: GraphAppearance) {
  const groups = new Map(nodes.map(node => {
    const group = graphColorGroup(node, notebooks, appearance.mode);
    return [group.key, group];
  }));
  const colors = palettes[appearance.palette];
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map((group, index) => ({ ...group, color: colors[index % colors.length] }));
}
