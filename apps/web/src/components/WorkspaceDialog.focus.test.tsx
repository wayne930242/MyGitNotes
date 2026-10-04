// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkspaceDialog } from './WorkspaceDialog.js';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.restoreAllMocks();
});
function Harness() {
  const [step, setStep] = useState('closed');
  return (
    <>
      <button onClick={() => setStep('chooser')}>Open chooser</button>
      {step === 'chooser' && (
        <WorkspaceDialog title='Choose outline' onClose={() => setStep('closed')}>
          <button onClick={() => setStep('create')}>New outline</button>
        </WorkspaceDialog>
      )}
      {step === 'create' && <input aria-label='New title' autoFocus />}
    </>
  );
}
it('retains the succeeding native creation field focus rather than returning to the previous trigger', () => {
  render(<Harness />);
  screen.getByText('Open chooser').focus();
  fireEvent.click(screen.getByText('Open chooser'));
  fireEvent.click(screen.getByText('New outline'));
  expect(screen.getByRole('textbox', { name: 'New title' })).toHaveFocus();
});
it('still returns focus to its trigger when simply dismissed', () => {
  render(<Harness />);
  const trigger = screen.getByText('Open chooser');
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(trigger).toHaveFocus();
});
