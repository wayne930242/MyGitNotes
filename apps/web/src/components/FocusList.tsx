import React from 'react';
import { focusTabCount } from '@mygitnotes/core/focus-page';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { useTranslation } from '../lib/i18n/index.js';
import { DivisionIcon } from './FocusDivision.js';

/** Screen's Focus section: the notebook's named Focus, each opening on the Notes page. */
export const FocusList: React.FC<{ focus: NoteFocus; onOpen: (id: string) => void }> = ({ focus, onOpen }) => {
  const { t } = useTranslation();
  if (!focus.error && !focus.focuses.length) return null;
  return <section className="focus-list" aria-labelledby="focus-list-title">
    <h3 id="focus-list-title">{t('focus.title')}</h3>
    {focus.error ? <p role="alert" className="screen-error">{focus.error}</p> : <ul>
      {focus.focuses.map(item => <li key={item.id}>
        <button type="button" onClick={() => onOpen(item.id)}>
          <DivisionIcon division={item.division} />
          <span>{item.name}</span>
          <small>{t('focus.tabCount', { count: focusTabCount(item) })}</small>
        </button>
      </li>)}
    </ul>}
  </section>;
};
