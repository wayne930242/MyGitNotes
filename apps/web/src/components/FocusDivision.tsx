import './focus.css';
import React from 'react';
import { focusPaneCount, type FocusDivision } from '@mygitnotes/core/focus-page';
import { useTranslation } from '../lib/i18n/index.js';

const panes = (division: FocusDivision) => Array.from({ length: focusPaneCount(division) }, (_, index) => index);

/** The division's panes drawn as a small grid, used in the division picker and Focus lists. */
export const DivisionIcon: React.FC<{ division: FocusDivision }> = ({ division }) => (
  <span className="focus-division" data-division={division} aria-hidden="true">
    {panes(division).map(pane => <span key={pane} />)}
  </span>
);

/** A larger division drawing whose panes are choices; `current` marks the pane that already holds the item. */
export const DivisionThumbnail: React.FC<{
  division: FocusDivision; selected: number; current?: number; label: string; onSelect: (pane: number) => void;
}> = ({ division, selected, current, label, onSelect }) => {
  const { t } = useTranslation();
  return (
    <div className="focus-division focus-division-thumbnail" data-division={division} role="radiogroup" aria-label={label}
      onKeyDown={event => {
        const count = focusPaneCount(division);
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const next = (selected + step + count) % count;
        onSelect(next);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      }}>
      {panes(division).map(pane => (
        <button key={pane} type="button" role="radio" aria-checked={pane === selected} tabIndex={pane === selected ? 0 : -1}
          data-current={pane === current || undefined} onClick={() => onSelect(pane)}>
          <span>{t('focus.paneNumber', { number: pane + 1 })}</span>
          {pane === current && <small>{t('focus.currentPane')}</small>}
        </button>
      ))}
    </div>
  );
};
