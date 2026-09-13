import type { AgentResource, NotebookConfig } from './types.js';

export interface AgentTreeNode {
  name: string;
  path: string;
  resource?: AgentResource;
  children?: AgentTreeNode[];
}

/** Classification is for navigation only; resource permissions remain API-owned. */
export function groupAgentResources(resources: AgentResource[], notebooks: NotebookConfig[], notebookId: string) {
  const groups = { skills: [] as AgentResource[], shared: [] as AgentResource[], notebook: [] as AgentResource[], product: [] as AgentResource[] };
  const roots = notebooks.map(nb => ({ id: nb.id, root: nb.root.replace(/\/+$/, '') }))
    .sort((a, b) => b.root.length - a.root.length);
  for (const resource of resources) {
    if (resource.scope === 'product') {
      groups.product.push(resource);
      continue;
    }
    if (/^\.(agents|codex|claude|agent)\/skills\//.test(resource.path)) {
      groups.skills.push(resource);
      continue;
    }
    const owner = roots.find(nb => resource.path.startsWith(`${nb.root}/`));
    if (!owner) groups.shared.push(resource);
    else if (owner.id === notebookId) groups.notebook.push(resource);
  }
  return groups;
}

export function buildAgentTree(resources: AgentResource[]): AgentTreeNode[] {
  const tree: AgentTreeNode[] = [];
  for (const resource of resources) {
    const parts = resource.path.split('/');
    let children = tree;
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join('/');
      const leaf = index === parts.length - 1;
      let node = children.find(item => item.path === path);
      if (!node) {
        node = { name: parts[index], path, ...(leaf ? { resource } : { children: [] }) };
        children.push(node);
      }
      if (!leaf) children = node.children!;
    }
  }
  function compact(nodes: AgentTreeNode[]): AgentTreeNode[] {
    return nodes.map(node => {
      while (node.children?.length === 1 && node.children[0].children) {
        const child = node.children[0];
        node = { ...child, name: `${node.name}/${child.name}` };
      }
      if (node.children) node.children = compact(node.children);
      return node;
    }).sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name, 'en'));
  }
  return compact(tree);
}
