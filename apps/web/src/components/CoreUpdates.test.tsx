// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { CoreUpdates } from './CoreUpdates.js';
import { CoreUpdateApiError, fetchCoreStatus, fetchCoreUpdateRun, runCoreUpdate } from '../lib/api.js';
import type { CoreStatus } from '@mygitnotes/core';
vi.mock('../lib/api.js', () => ({
  fetchCoreStatus: vi.fn(),
  fetchCoreUpdateRun: vi.fn(),
  installCoreSyncWorkflow: vi.fn(),
  runCoreUpdate: vi.fn(),
  CoreUpdateApiError: class extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  },
}));
const initial: CoreStatus = { state: 'update_available', canUpdate: true, current: { sha: 'a'.repeat(40), behind: 2, ahead: 0 }, upstreamSha: 'b'.repeat(40), upstream: 'upstream/core', running: { sha: 'a'.repeat(40), behind: 2, ahead: 0 }, runningBuild: 'aaaaaaa' };
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
const mount = () =>
  render(
    <I18nProvider>
      <CoreUpdates local={false} />
    </I18nProvider>,
  );
describe('Core update controls', () => {
  it('reports lag on entry and performs exactly one user-triggered update', async () => {
    vi.mocked(fetchCoreStatus).mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, state: 'up_to_date', canUpdate: false, current: { ...initial.current!, behind: 0 } });
    vi.mocked(runCoreUpdate).mockResolvedValue({ result: { success: true, alreadyUpToDate: false } });
    mount();
    await screen.findByText('Core commits behind upstream: 2.');
    expect(runCoreUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Update Core' }));
    await screen.findByText('Core branch updated successfully.');
    expect(runCoreUpdate).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Update Core' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Core is updated. Reload the page once the deployment finishes to run the new build.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
  });
  it('follows a dispatched run and reports success only after the target revision is confirmed', async () => {
    vi.mocked(fetchCoreStatus).mockResolvedValue(initial);
    vi.mocked(runCoreUpdate).mockResolvedValue({ result: { accepted: true, receipt: { requestId: 'request', targetSha: 'b'.repeat(40) } } });
    let finish!: (value: import('@mygitnotes/core').CoreUpdateRun) => void;
    vi.mocked(fetchCoreUpdateRun).mockImplementation(() =>
      new Promise(resolve => {
        finish = resolve;
      })
    );
    mount();
    await screen.findByText('Core commits behind upstream: 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Update Core' }));
    await screen.findByText('Sync requested; waiting for the workflow run.');
    expect(screen.queryByText('Core branch updated successfully.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Update Core' }) as HTMLButtonElement).disabled).toBe(true);
    finish({ state: 'succeeded', targetSha: 'b'.repeat(40), currentSha: 'b'.repeat(40) });
    await screen.findByText('Core branch updated successfully.');
    expect(sessionStorage.getItem('mygitnotes:core-update')).toBeNull();
    expect(screen.getByRole('button', { name: 'Update Core' }).querySelector('svg')!.getAttribute('class')).not.toContain('animate-spin');
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload } });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('keeps the restart instruction for a local update', async () => {
    vi.mocked(fetchCoreStatus).mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, state: 'up_to_date', canUpdate: false, current: { ...initial.current!, behind: 0 } });
    vi.mocked(runCoreUpdate).mockResolvedValue({ result: { success: true, alreadyUpToDate: false } });
    render(
      <I18nProvider>
        <CoreUpdates local />
      </I18nProvider>,
    );
    await screen.findByText('Core commits behind upstream: 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Update Core' }));
    await screen.findByText('Core branch updated successfully.');
    expect(screen.getByText(/restart the server/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
  });
  it('renders token write denial as an actionable named state', async () => {
    vi.mocked(fetchCoreStatus).mockResolvedValue(initial);
    vi.mocked(runCoreUpdate).mockRejectedValue(new CoreUpdateApiError('denied', 'PERMISSION_REQUIRED'));
    mount();
    await screen.findByText('Core commits behind upstream: 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Update Core' }));
    await screen.findByText(/Authorize repository Contents: write/);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Update Core' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['unsupported', 'reauthorization_required', 'workflow_missing', 'workflow_permission_required', 'secret_permission_required', 'diverged', 'permission_required', 'dirty', 'invalid_branch'] as const)('disables mutation for %s', async state => {
    vi.mocked(fetchCoreStatus).mockResolvedValue({ ...initial, state, canUpdate: false });
    mount();
    await waitFor(() => expect(document.querySelector(`[data-core-state="${state}"]`)).not.toBeNull());
    expect((screen.getByRole('button', { name: 'Update Core' }) as HTMLButtonElement).disabled).toBe(true);
    expect(runCoreUpdate).not.toHaveBeenCalled();
  });
});
