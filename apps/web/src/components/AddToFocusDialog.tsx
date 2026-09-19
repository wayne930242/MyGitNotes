import React, { useRef, useState } from 'react';
import { findFocusTab, findFocusTabInPane, FOCUS_MAX_TABS, type FocusTab, focusTabCount, focusTabKey } from '@mygitnotes/core/focus-page';
import { CURRENT_FOCUS } from '../lib/focus-view.js';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { focusErrorMessage } from '../lib/focus-error-message.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { Select } from './Select.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { DivisionThumbnail } from './FocusDivision.js';

/**
 * Picks a Focus and one of its panes for a note or lane. Confirming leaves the caller where it is:
 * the item shrinks into the chosen pane of the thumbnail, or a static notice replaces the motion.
 */
export const AddToFocusDialog: React.FC<{ focus: NoteFocus; tab: FocusTab; label: string; onClose: () => void; }> = ({ focus, tab, label, onClose }) => {
  const { t } = useTranslation();
  const key = focusTabKey(tab);
  // A target needs room for one more tab unless it already holds this one; a named Focus also needs a writable source.
  const targets = [CURRENT_FOCUS, ...focus.focuses.map(item => item.id)].filter(target => {
    const layout = focus.layoutOf(target);
    return layout && focus.editableFocus(target) && (findFocusTab(layout, key) || focusTabCount(layout) < FOCUS_MAX_TABS);
  });
  const nameOf = (target: string) => target === CURRENT_FOCUS ? t('focus.current') : focus.focuses.find(item => item.id === target)?.name ?? target;
  const [target, setTarget] = useState(() => focus.shown && targets.includes(focus.shown) ? focus.shown : targets[0]);
  const layout = target ? focus.layoutOf(target) : undefined;
  const current = layout ? findFocusTab(layout, key)?.pane : undefined;
  const [pane, setPane] = useState(() => (target && focus.entryOf(target)?.activePane) || 0);
  const found = layout ? findFocusTabInPane(layout, pane, key) !== -1 : false;
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef<HTMLSpanElement>(null);
  const thumbnail = useRef<HTMLDivElement>(null);

  const land = () => {
    const from = flight.current, to = thumbnail.current?.querySelectorAll('[role="radio"]')[pane];
    if (!from || !to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.setTimeout(onClose, 1200);
      return;
    }
    const start = from.getBoundingClientRect(), end = to.getBoundingClientRect();
    const dx = end.left + end.width / 2 - (start.left + start.width / 2), dy = end.top + end.height / 2 - (start.top + start.height / 2);
    from.animate([{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0.2 }], { duration: 600, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }).finished.then(onClose, onClose);
  };

  return (
    <WorkspaceDialog title={t('focus.addTo')} onClose={onClose} className='focus-add-dialog'>
      <form
        className='screen-form'
        onSubmit={async event => {
          event.preventDefault();
          if (!target || placed) return;
          let ok: boolean;
          try {
            ok = await focus.place(target, tab, pane);
          } catch (caught) {
            setError(focusErrorMessage(t, caught));
            return;
          }
          if (!ok) {
            setError(t('focus.addFailed'));
            return;
          }
          setPlaced(true);
          requestAnimationFrame(land);
        }}
      >
        <p className='focus-add-item'>
          <span ref={flight}>{label}</span>
        </p>
        {targets.length > 1 && (
          <label>
            {t('focus.title')}
            <Select
              value={target}
              disabled={placed}
              onValueChange={value => {
                setTarget(value);
                setPane(focus.entryOf(value)?.activePane ?? 0);
              }}
              options={targets.map(value => ({ value, label: nameOf(value) }))}
            />
          </label>
        )}
        {layout && (
          <div ref={thumbnail}>
            <DivisionThumbnail division={layout.division} selected={pane} current={current} label={t('focus.choosePane', { name: nameOf(target) })} onSelect={setPane} />
          </div>
        )}
        {placed && <p role='status'>{t('focus.added', { name: nameOf(target), number: pane + 1 })}</p>}
        {error && <p role='alert'>{error}</p>}
        <div className='workspace-dialog-actions'>
          <Button type='button' onClick={onClose}>{t(placed ? 'common.close' : 'common.cancel')}</Button>
          <Button type='submit' variant='primary' disabled={!layout || placed}>{t(found ? 'focus.showThere' : 'focus.addTo')}</Button>
        </div>
      </form>
    </WorkspaceDialog>
  );
};
