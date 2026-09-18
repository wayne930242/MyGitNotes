import React, { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, ListTree, PanelsTopLeft } from 'lucide-react';
import { FOCUS_DIVISIONS, FocusError, type FocusDivision } from '@mygitnotes/core/focus-page';
import { CURRENT_FOCUS } from '../lib/focus-view.js';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { focusErrorMessage } from '../lib/focus-error-message.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { DivisionIcon } from './FocusDivision.js';

type Dialog = { kind: 'name' } | { kind: 'rename'; id: string; name: string } | { kind: 'delete'; id: string; name: string };

/** The Notes toolbar's Focus switcher and division picker, with naming, renaming and deleting. */
export const FocusControls: React.FC<{
  focus: NoteFocus;
  /** Shows a Focus (`current` or an id), or returns to normal browsing with null. */
  onShow: (key: string | null) => void;
  onReload: () => void;
  /** Phones show the browse region or the Focus, one at a time. */
  browseToggle?: { showing: boolean; onToggle: () => void };
}> = ({ focus, onShow, onReload, browseToggle }) => {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const named = focus.shown && focus.shown !== CURRENT_FOCUS ? focus.focuses.find(item => item.id === focus.shown) : undefined;
  const label = named ? named.name : focus.shown ? t('focus.current') : t('focus.title');
  const taken = focus.focuses.map(item => item.name);

  return <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="ui-button focus-switcher" data-shown={focus.shown ? true : undefined} aria-label={t('focus.switch')} title={t('focus.switch')}>
        <PanelsTopLeft aria-hidden="true" /><span>{label}</span><ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="focus-menu" align="end" sideOffset={4} collisionPadding={8} aria-label={t('focus.switch')}
          onEscapeKeyDown={event => event.stopPropagation()}>
          <DropdownMenu.RadioGroup value={focus.shown ?? ''} onValueChange={onShow}>
            <DropdownMenu.RadioItem value={CURRENT_FOCUS}>{t('focus.current')}</DropdownMenu.RadioItem>
            {focus.focuses.map(item => <DropdownMenu.RadioItem key={item.id} value={item.id}>
              <DivisionIcon division={item.division} /><span>{item.name}</span>
            </DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
          {focus.loading && <p role="status">{t('focus.loading')}</p>}
          {focus.error && <><p role="alert">{focus.error}</p><DropdownMenu.Item onSelect={onReload}>{t('focus.reload')}</DropdownMenu.Item></>}
          {focus.mutationError && <p role="alert">{focusErrorMessage(t, focus.mutationError)}</p>}
          {focus.shown && <DropdownMenu.Separator />}
          {focus.shown === CURRENT_FOCUS && focus.canName && <DropdownMenu.Item onSelect={() => setDialog({ kind: 'name' })}>{t('focus.name')}</DropdownMenu.Item>}
          {named && focus.editableFocus(named.id) && <>
            <DropdownMenu.Item onSelect={() => setDialog({ kind: 'rename', id: named.id, name: named.name })}>{t('focus.rename')}</DropdownMenu.Item>
            <DropdownMenu.Item className="focus-menu-danger" onSelect={() => setDialog({ kind: 'delete', id: named.id, name: named.name })}>{t('focus.delete')}</DropdownMenu.Item>
          </>}
          {focus.shown && <DropdownMenu.Item onSelect={() => onShow(null)}>{t('focus.close')}</DropdownMenu.Item>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {focus.layout && <DivisionPicker division={focus.layout.division} disabled={!focus.editable} onChange={division => void focus.setDivision(division).catch(() => {})} />}
    {focus.layout && browseToggle && <button type="button" className="ui-icon-button" aria-pressed={browseToggle.showing} onClick={browseToggle.onToggle}
      aria-label={t(browseToggle.showing ? 'focus.showFocus' : 'focus.showBrowse')} title={t(browseToggle.showing ? 'focus.showFocus' : 'focus.showBrowse')}>
      {browseToggle.showing ? <PanelsTopLeft aria-hidden="true" /> : <ListTree aria-hidden="true" />}
    </button>}
    {dialog?.kind === 'name' && <FocusNameDialog title={t('focus.nameTitle')} initial="" taken={taken} onClose={() => setDialog(null)}
      onSubmit={name => onShow(focus.name(name))} />}
    {dialog?.kind === 'rename' && <FocusNameDialog title={t('focus.renameTitle')} initial={dialog.name} taken={taken.filter(name => name !== dialog.name)}
      onClose={() => setDialog(null)} onSubmit={name => focus.rename(dialog.id, name)} />}
    {dialog?.kind === 'delete' && <WorkspaceDialog title={t('focus.deleteTitle')} onClose={() => setDialog(null)}>
      <p>{t('focus.deleteHint', { name: dialog.name })}</p>
      <div className="workspace-dialog-actions">
        <Button type="button" onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
        <Button type="button" variant="danger" onClick={async () => {
          if (!await focus.remove(dialog.id)) return;
          setDialog(null);
          if (focus.shown === dialog.id) onShow(null);
        }}>{t('common.delete')}</Button>
      </div>
    </WorkspaceDialog>}
  </>;
};

const DivisionPicker: React.FC<{ division: FocusDivision; disabled: boolean; onChange: (division: FocusDivision) => void }> = ({ division, disabled, onChange }) => {
  const { t } = useTranslation();
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger className="ui-icon-button focus-division-trigger" disabled={disabled} aria-label={t('focus.division')} title={t('focus.division')}>
      <DivisionIcon division={division} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="focus-menu" align="end" sideOffset={4} collisionPadding={8} aria-label={t('focus.division')}
        onEscapeKeyDown={event => event.stopPropagation()}>
        <DropdownMenu.RadioGroup value={division} onValueChange={value => onChange(value as FocusDivision)}>
          {FOCUS_DIVISIONS.map(value => <DropdownMenu.RadioItem key={value} value={value}>
            <DivisionIcon division={value} /><span>{t(`focus.division.${value}`)}</span>
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
};

/** Names or renames a Focus; a name already used in this notebook is flagged before submitting. */
const FocusNameDialog: React.FC<{ title: string; initial: string; taken: string[]; onSubmit: (name: string) => void; onClose: () => void }> = ({ title, initial, taken, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const trimmed = name.trim();
  const duplicate = taken.includes(trimmed);
  return <WorkspaceDialog title={title} onClose={onClose}>
    <form className="screen-form" onSubmit={event => {
      event.preventDefault();
      if (!trimmed || duplicate) return;
      try { onSubmit(trimmed); onClose(); }
      catch (caught) { setError(caught instanceof FocusError && caught.code === 'duplicate-name' ? t('focus.duplicateName') : (caught as Error).message); }
    }}>
      <label>{t('focus.nameLabel')}
        <input className="ui-control" value={name} maxLength={100} required autoFocus aria-invalid={duplicate || undefined}
          aria-describedby={duplicate || error ? 'focus-name-error' : undefined} onChange={event => { setName(event.target.value); setError(''); }} />
      </label>
      {(duplicate || error) && <p id="focus-name-error" role="alert" className="focus-name-error">{duplicate ? t('focus.duplicateName') : error}</p>}
      <div className="workspace-dialog-actions">
        <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={!trimmed || duplicate}>{t('common.save')}</Button>
      </div>
    </form>
  </WorkspaceDialog>;
};
