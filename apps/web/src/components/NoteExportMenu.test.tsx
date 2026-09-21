// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteExportMenu } from './NoteExportMenu.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.querySelectorAll('iframe').forEach(frame => frame.remove());
});

const menu = () => render(<NoteExportMenu className='x' path='notes/a/a.md' title='Alpha' content={'# Alpha\n\nBody text.'} copyState='idle' onCopy={vi.fn()} />);
const open = async () => {
  const trigger = screen.getByRole('button', { name: 'Export' });
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
};

it('lists Copy, Download (.md) and Download (PDF)', async () => {
  menu();
  await open();
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Copy', 'Download (.md)', 'Download (PDF)']);
});

it('downloads the note content as a markdown file named after the note', async () => {
  let blob: Blob | undefined;
  URL.createObjectURL = vi.fn((value: Blob | MediaSource) => (blob = value as Blob, 'blob:note'));
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('a.md');
  });
  menu();
  await open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download (.md)' }));
  expect(click).toHaveBeenCalledOnce();
  expect(await blob?.text()).toBe('# Alpha\n\nBody text.');
});

it('prints the rendered note from a hidden frame for PDF export', async () => {
  menu();
  await open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download (PDF)' }));
  const frame = document.querySelector('iframe');
  expect(frame?.srcdoc).toContain('<title>Alpha</title>');
  expect(frame?.srcdoc).toContain('<h1');
  expect(frame?.srcdoc).toContain('Body text.');
});
