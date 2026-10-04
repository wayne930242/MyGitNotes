import { useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';

export type FolderAction = 'browse' | 'move' | 'delete';

export function FolderActions({ title, disabled, onAction }: { title: string; disabled: boolean; onAction: (action: FolderAction) => void; }) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [portal, setPortal] = useState<HTMLElement>();
  const pendingAction = useRef<FolderAction>();
  return (
    <DropdownMenu.Root
      onOpenChange={open => {
        if (open) setPortal(trigger.current?.closest('dialog') || undefined);
      }}
    >
      <DropdownMenu.Trigger ref={trigger} className='folder-manage' aria-label={`${t('folder.manage')}: ${title}`} title={t('folder.manage')}>
        <MoreHorizontal size={15} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal}>
        <DropdownMenu.Content
          className='sidebar-tag-menu folder-action-menu'
          align='end'
          sideOffset={4}
          collisionPadding={8}
          aria-label={`${t('folder.manage')}: ${title}`}
          onEscapeKeyDown={event => event.stopPropagation()}
          onCloseAutoFocus={event => {
            const action = pendingAction.current;
            if (action) {
              event.preventDefault();
              pendingAction.current = undefined;
              // The new dialog captures this trigger as its return-focus target, not a removed menu item.
              trigger.current?.focus();
              onAction(action);
            }
          }}
        >
          {(['delete', 'move', 'browse'] as const).map(action => (
            <DropdownMenu.Item
              key={action}
              disabled={disabled && action !== 'browse'}
              className={action === 'delete' ? 'sidebar-tag-menu-danger' : undefined}
              onSelect={() => {
                pendingAction.current = action;
              }}
            >
              {t(action === 'browse' ? 'files.openBrowser' : action === 'move' ? 'files.move' : 'common.delete')}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
