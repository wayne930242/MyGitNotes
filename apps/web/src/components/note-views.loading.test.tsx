// @vitest-environment jsdom
import type React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { CardView } from './CardView.js';
import { ListView } from './ListView.js';
afterEach(cleanup);
const props = { notes: [], uncommitted: [], statuses: [], onOpenNote: () => {}, onDeleteNote: () => {}, onUpdateNoteStatus: () => {}, onNewNote: () => {} } as unknown as React.ComponentProps<typeof ListView> & React.ComponentProps<typeof CardView>;
describe.each([['ListView', ListView], ['CardView', CardView]] as const)('%s with nothing to show', (_name, View) => {
  it('waits for the first page instead of announcing that nothing was found', () => {
    render(
      <I18nProvider>
        <View {...props} loading />
      </I18nProvider>,
    );
    expect(screen.queryByText('No notes found')).toBeNull();
  });
  it('announces the empty result once the page has arrived', () => {
    render(
      <I18nProvider>
        <View {...props} />
      </I18nProvider>,
    );
    expect(screen.getByText('No notes found')).toBeTruthy();
  });
});
