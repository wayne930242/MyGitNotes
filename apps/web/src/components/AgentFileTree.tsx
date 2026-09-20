import { useMemo, useState } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import { type AgentTreeNode, buildAgentTree } from '../lib/agent-tree.js';
import type { AgentResource } from '../lib/types.js';

interface NavigationProps {
  selectedPath: string;
  disabled: boolean;
  onSelect: (path: string) => void;
}

function TreeNode({ node, depth, ...navigation }: NavigationProps & { node: AgentTreeNode; depth: number; }) {
  const containsSelection = navigation.selectedPath.startsWith(`${node.path}/`);
  const [expanded, setExpanded] = useState(depth === 0 || containsSelection);
  const [selection, setSelection] = useState({ containsSelection, path: navigation.selectedPath });
  if (selection.containsSelection !== containsSelection || selection.path !== navigation.selectedPath) {
    setSelection({ containsSelection, path: navigation.selectedPath });
    if (containsSelection) setExpanded(true);
  }
  if (node.children) {
    return (
      <li>
        <button type='button' className='agent-folder sidebar-link' aria-expanded={expanded} title={node.path} onClick={() => setExpanded(value => !value)}>
          <ChevronRight aria-hidden='true' className={`agent-tree-chevron ${expanded ? 'expanded' : ''}`} />
          <Folder aria-hidden='true' />
          <span>{node.name}</span>
        </button>
        {expanded && <ul>{node.children.map(child => <TreeNode key={child.path} node={child} depth={depth + 1} {...navigation} />)}</ul>}
      </li>
    );
  }
  return (
    <li>
      <button type='button' className='agent-file sidebar-link' disabled={navigation.disabled} aria-current={navigation.selectedPath === node.path ? 'page' : undefined} title={`${node.path}\n${node.resource?.name || node.name}`} onClick={() => navigation.onSelect(node.path)}>
        <FileText aria-hidden='true' />
        <span>{node.name}</span>
      </button>
    </li>
  );
}

export function AgentFileTree({ resources, ...navigation }: NavigationProps & { resources: AgentResource[]; }) {
  const tree = useMemo(() => buildAgentTree(resources), [resources]);
  return <ul className='agent-file-tree'>{tree.map(node => <TreeNode key={node.path} node={node} depth={0} {...navigation} />)}</ul>;
}
