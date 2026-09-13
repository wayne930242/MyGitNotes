import { describe, expect, it } from 'vitest';
import { buildAgentTree, groupAgentResources } from './agent-tree.js';
import type { AgentResource } from './types.js';

const notebooks = [
  { id: 'a', title: 'A', root: 'notes/a/' },
  { id: 'ab', title: 'AB', root: 'notes/ab' },
  { id: 'nested', title: 'Nested', root: 'notes/a/nested' },
];
const paths = ['AGENTS.md', 'notes/AGENTS.md', '.agents/skills/review/SKILL.md',
  '.agents/skills/review/references/check.md', 'notes/a/AGENTS.md', 'notes/ab/AGENTS.md',
  'notes/a/nested/AGENTS.md', 'docs/agent/product/index.md'];
const resources: AgentResource[] = paths.map(path => ({ path, name: path,
  scope: path.startsWith('docs/') ? 'product' : 'workspace' }));

describe('Agent document navigation', () => {
  it('keeps shared and product documents while filtering exact notebook boundaries', () => {
    const groups = groupAgentResources(resources, notebooks, 'a');
    expect(groups.shared.map(r => r.path)).toEqual(paths.slice(0, 4));
    expect(groups.notebook.map(r => r.path)).toEqual(['notes/a/AGENTS.md']);
    expect(groups.product.map(r => r.path)).toEqual(['docs/agent/product/index.md']);
    expect(groupAgentResources(resources, notebooks, 'ab').notebook.map(r => r.path))
      .toEqual(['notes/ab/AGENTS.md']);
    expect(groupAgentResources(resources, notebooks, 'nested').notebook.map(r => r.path))
      .toEqual(['notes/a/nested/AGENTS.md']);
  });

  it('keeps unassigned documents discoverable and does not mutate API resources', () => {
    expect(groupAgentResources(resources, [], '').shared).toHaveLength(7);
    expect(groupAgentResources(resources, notebooks, 'missing').notebook).toEqual([]);
    expect(resources.map(r => r.path)).toEqual(paths);
  });

  it('groups full paths, compresses single-folder chains, and preserves leaf identity', () => {
    const tree = buildAgentTree(resources.slice(0, 4));
    expect(tree.map(node => node.name)).toEqual(['.agents/skills/review', 'notes', 'AGENTS.md']);
    const skill = tree[0];
    expect(skill.path).toBe('.agents/skills/review');
    expect(skill.children?.map(node => node.name)).toEqual(['references', 'SKILL.md']);
    expect(skill.children?.[1].resource).toBe(resources[2]);
    expect(skill.children?.[0].children?.[0].resource).toBe(resources[3]);
    expect(buildAgentTree([])).toEqual([]);
  });
});
