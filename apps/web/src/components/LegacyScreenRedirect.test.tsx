// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NotebookConfig } from '../lib/types.js';
import { LegacyScreenRedirect } from './LegacyScreenRedirect.js';

const lookup = vi.hoisted(() => ({ findCompilationById: vi.fn() }));
vi.mock('../lib/compilation-lookup.js', () => lookup);

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const Probe = () => {
  const current = useLocation();
  return createElement('output', { 'data-testid': 'location' }, current.pathname + current.search);
};
const expectLocation = (expected: string) => waitFor(() => expect(screen.getByTestId('location').textContent).toBe(expected));

/** Like the app, which stops rendering the redirect once the route has left `/screen`. */
const Gate = ({ laneId, onMissing }: { laneId: string | null; onMissing: (message: string) => void; }) => useLocation().pathname.startsWith('/screen') ? createElement(LegacyScreenRedirect, { laneId, notebooks, onMissing }) : null;
const mount = (laneId: string | null, onMissing = vi.fn()) => {
  render(createElement(MemoryRouter, { initialEntries: ['/screen'] }, createElement(Probe), createElement(Gate, { laneId, onMissing })));
  return onMissing;
};

beforeEach(() => lookup.findCompilationById.mockReset());
afterEach(cleanup);

it("sends a lane id that a compilation kept to that compilation's study session", async () => {
  lookup.findCompilationById.mockResolvedValue({ notebookId: 'nb1', path: 'notes/nb1/sub/reading.compilation.yml' });
  mount('lane-1');
  await expectLocation('/notes/study?notebook=nb1&path=sub%2Freading.compilation.yml');
});
it('goes to the notes list with a notice when no compilation has the id', async () => {
  lookup.findCompilationById.mockResolvedValue(undefined);
  const onMissing = mount('gone');
  await expectLocation('/notes');
  expect(onMissing).toHaveBeenCalledWith('This compilation no longer exists.');
});
it('sends /screen alone to the notes list without a notice', async () => {
  const onMissing = mount(null);
  await expectLocation('/notes');
  expect(onMissing).not.toHaveBeenCalled();
});
