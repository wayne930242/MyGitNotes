// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PanelProvider, usePanelContext } from '../lib/panel-context.js';
import { EditorModal } from './EditorModal.js';

afterEach(cleanup);

const Rail = () => createElement('output', { 'aria-label': 'rail' }, usePanelContext().hasOpenNote ? 'hidden' : 'shown');

it('hides the workspace rail while zoom waits for the note, as zoom itself does', () => {
  const modal = (loading: boolean, isOpen = true) => createElement(PanelProvider, null, createElement(Rail), createElement(EditorModal, { note: null, loading, isOpen, renderCompilation: () => null }));
  const { rerender } = render(modal(true));
  expect(screen.getByText('Loading note…')).toBeTruthy();
  expect(screen.getByLabelText('rail').textContent).toBe('hidden');
  rerender(modal(false, false));
  expect(screen.getByLabelText('rail').textContent).toBe('shown');
});
