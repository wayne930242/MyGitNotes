import type { ReactNode } from 'react';
import { BookOpen, Cloud } from 'lucide-react';
import { type FileTreeNode } from '../../lib/file-tree.js';
import { r2Folders } from '../R2Panel.js';
import { NavTree, NavTreeChildren, NavTreeRow } from '../NavTree.js';
import type { useFileManager } from './useFileManager.js';
export function FileTree({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { notebookId, layout, t, sidebar, listing, directory, showHidden, treeOpen, expanded, busy, r2, r2Directory, rootExpanded, setRootExpanded, tree, rootHasNonDocument, toggleExpand, navigate, navigateR2, switchNotebook, markerLabel, treeNotebooks } = model;
  const renderTreeNode = (node: FileTreeNode): ReactNode => {
    const isExpanded = expanded.has(node.path), hasChildren = node.children.length > 0;
    const label = markerLabel(node.name, node.hasNonDocument);
    return (
      <div key={node.path} className='nav-tree-node'>
        <NavTreeRow
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          onToggleExpand={() => toggleExpand(node.path)}
          expandAriaLabel={isExpanded ? t('folder.collapse') : t('folder.expand')}
          title={node.name}
          selected={r2Directory === undefined && directory === node.path}
          onSelect={() => {
            if (layout === 'page') sidebar.setOpen(false);
            void navigate(node.path);
          }}
          suffix={node.hasNonDocument ? <span className='nav-tree-marker' aria-hidden='true' /> : undefined}
          disabled={busy}
          buttonProps={{ title: label, 'aria-label': label }}
        />
        {hasChildren && isExpanded && <NavTreeChildren>{node.children.map(renderTreeNode)}</NavTreeChildren>}
      </div>
    );
  };

  const renderFoldersTree = () => (
    <NavTree className={`file-tree ${layout === 'page' ? 'assets-sidebar-tree' : treeOpen ? 'is-open' : ''}`} aria-label={t('folder.folders')}>
      {listing && treeNotebooks.map(nb =>
        nb.id === notebookId
          ? (
            <div key={nb.id} className='nav-tree-node'>
              <NavTreeRow
                hasChildren={tree.length > 0}
                isExpanded={rootExpanded}
                onToggleExpand={() => setRootExpanded(open => !open)}
                expandAriaLabel={rootExpanded ? t('folder.collapse') : t('folder.expand')}
                icon={<BookOpen size={15} />}
                title={nb.title}
                selected={r2Directory === undefined && directory === listing.root}
                onSelect={() => {
                  if (layout === 'page') sidebar.setOpen(false);
                  void navigate(listing.root);
                }}
                suffix={rootHasNonDocument ? <span className='nav-tree-marker' aria-hidden='true' /> : undefined}
                disabled={busy}
                buttonProps={{ title: markerLabel(nb.title, rootHasNonDocument), 'aria-label': markerLabel(nb.title, rootHasNonDocument) }}
              />
              {rootExpanded && tree.length > 0 && <NavTreeChildren>{tree.map(renderTreeNode)}</NavTreeChildren>}
            </div>
          )
          : <NavTreeRow key={nb.id} icon={<BookOpen size={15} />} title={nb.title} disabled={busy} onSelect={() => void switchNotebook(nb.id)} />
      )}
      {r2 && (() => {
        const { root, folders } = r2Folders(r2, showHidden);
        return (
          <>
            <NavTreeRow
              hasChildren={false}
              icon={<Cloud size={15} />}
              title='R2'
              selected={r2Directory === root}
              onSelect={() => {
                if (layout === 'page') sidebar.setOpen(false);
                void navigateR2(root);
              }}
              disabled={busy}
            />
            {folders.map(folder => (
              <NavTreeRow
                key={folder}
                hasChildren={false}
                title={folder.slice(folder.lastIndexOf('/') + 1)}
                selected={r2Directory === folder}
                onSelect={() => {
                  if (layout === 'page') sidebar.setOpen(false);
                  void navigateR2(folder);
                }}
                disabled={busy}
              />
            ))}
          </>
        );
      })()}
    </NavTree>
  );

  return renderFoldersTree();
}
