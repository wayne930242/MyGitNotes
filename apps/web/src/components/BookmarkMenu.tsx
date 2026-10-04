import { useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

interface BookmarkMenuAction {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}
/** Match folder menus, including menu-to-dialog focus and native dialog portals. */
export function BookmarkMenu({ label, actions }: { label: string; actions: BookmarkMenuAction[]; }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void)>();
  const [portal, setPortal] = useState<HTMLElement>();
  return (
    <DropdownMenu.Root
      onOpenChange={open => {
        if (open) setPortal(trigger.current?.closest('dialog') || undefined);
      }}
    >
      <DropdownMenu.Trigger ref={trigger} className='folder-manage bookmark-menu-trigger' aria-label={label} title={label}>
        <MoreHorizontal size={15} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal}>
        <DropdownMenu.Content
          className='sidebar-tag-menu folder-action-menu'
          align='end'
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
          onEscapeKeyDown={event => event.stopPropagation()}
          onCloseAutoFocus={event => {
            const action = pending.current;
            if (!action) return;
            event.preventDefault();
            pending.current = undefined;
            trigger.current?.focus();
            action();
          }}
        >
          {actions.map(action => (
            <DropdownMenu.Item
              key={action.label}
              disabled={action.disabled}
              onSelect={() => {
                pending.current = action.onSelect;
              }}
            >
              {action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
