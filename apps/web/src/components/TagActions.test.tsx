// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TagActions } from './TagActions.js';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderTagActions(overrides: Partial<{
  onPreviewUsage: (tag: string) => Promise<number>;
  onRename: (from: string, to: string) => Promise<void>;
  onMerge: (from: string, into: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
  allTags: string[];
}> = {}) {
  const onPreviewUsage = overrides.onPreviewUsage ?? vi.fn().mockResolvedValue(0);
  const onRename = overrides.onRename ?? vi.fn().mockResolvedValue(undefined);
  const onMerge = overrides.onMerge ?? vi.fn().mockResolvedValue(undefined);
  const onDelete = overrides.onDelete ?? vi.fn().mockResolvedValue(undefined);
  const allTags = overrides.allTags ?? [];
  const utils = render(
    createElement(
      TagActions,
      { tag: 'alpha', allTags, onPreviewUsage, onRename, onMerge, onDelete, children: createElement('button', {}, '#alpha') }
    )
  );
  return { ...utils, onPreviewUsage, onRename, onMerge, onDelete };
}

async function openMenu() {
  const trigger = screen.getByRole('button', { name: /manage tag/i });
  trigger.focus();
  await act(async () => { fireEvent.keyDown(trigger, { key: 'Enter' }); });
}

describe('TagActions cancel during preview', () => {
  it('keeps Cancel enabled while the affected-note preview is still loading', async () => {
    const { promise } = deferred<number>();
    renderTagActions({ onPreviewUsage: vi.fn().mockReturnValue(promise) });

    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).not.toBeDisabled();

    const input = screen.getByPlaceholderText('New tag name');
    expect(input).not.toBeDisabled();
  });

  it('closes the form immediately when Cancel is clicked mid-preview', async () => {
    const { promise } = deferred<number>();
    renderTagActions({ onPreviewUsage: vi.fn().mockReturnValue(promise) });

    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText('New tag name')).not.toBeInTheDocument();
  });

  it('ignores a preview that resolves after the user already cancelled', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const onPreviewUsage = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderTagActions({ onPreviewUsage });

    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });

    await act(async () => { first.resolve(42); await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('…');

    await act(async () => { second.resolve(7); await second.promise; });
    expect(screen.getByText('7 notes affected across the workspace')).toBeInTheDocument();
  });

  it('ignores a preview that resolves after reopening a different form', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const onPreviewUsage = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderTagActions({ onPreviewUsage });

    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    await act(async () => { first.resolve(99); await Promise.resolve(); });
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('…');

    await act(async () => { second.resolve(3); await second.promise; });
    expect(screen.getByText('3 notes affected across the workspace')).toBeInTheDocument();
  });

  it('disables the confirm action until the count finishes loading', async () => {
    const { promise, resolve } = deferred<number>();
    renderTagActions({ onPreviewUsage: vi.fn().mockReturnValue(promise) });

    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });
    fireEvent.change(screen.getByPlaceholderText('New tag name'), { target: { value: 'beta' } });

    expect(screen.getByRole('button', { name: /Rename in/i })).toBeDisabled();

    await act(async () => { resolve(5); await promise; });
    expect(screen.getByRole('button', { name: /Rename in/i })).not.toBeDisabled();
  });
});

describe('TagActions form vs chip visibility', () => {
  it('hides the tag chip while the form is open and shows the tag being edited', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0) });

    expect(screen.getByText('#alpha')).toBeInTheDocument();
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });

    expect(screen.queryByText('#alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Rename #alpha')).toBeInTheDocument();
  });

  it('restores the chip after Cancel', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0) });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Rename')); });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('#alpha')).toBeInTheDocument();
  });
});

describe('TagActions merge target autocomplete', () => {
  it('suggests matching workspace tags excluding the source tag', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0), allTags: ['alpha', 'beta', 'betting', 'gamma'] });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    fireEvent.change(screen.getByPlaceholderText('Target tag'), { target: { value: 'bet' } });
    expect(screen.getByRole('option', { name: 'beta' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'betting' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeInTheDocument();
  });

  it('selects a suggestion with ArrowDown + Enter', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0), allTags: ['beta', 'betting'] });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    const input = screen.getByPlaceholderText('Target tag');
    fireEvent.change(input, { target: { value: 'bet' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(input).toHaveValue('bet');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('beta');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('submits on Enter without hijacking it when no suggestion has been arrow-selected yet', async () => {
    const onMerge = vi.fn().mockResolvedValue(undefined);
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(5), onMerge, allTags: ['beta', 'betting'] });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    const input = screen.getByPlaceholderText('Target tag');
    fireEvent.change(input, { target: { value: 'betting' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(onMerge).toHaveBeenCalledWith('alpha', 'betting');
  });

  it('selects a suggestion by click (touch tap)', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0), allTags: ['beta'] });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    const input = screen.getByPlaceholderText('Target tag');
    fireEvent.change(input, { target: { value: 'bet' } });
    fireEvent.click(screen.getByRole('option', { name: 'beta' }));

    expect(input).toHaveValue('beta');
  });

  it('shows a new-tag hint when the typed target does not exist yet', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0), allTags: ['beta'] });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    fireEvent.change(screen.getByPlaceholderText('Target tag'), { target: { value: 'brandnew' } });
    expect(screen.getByText('"brandnew" is not an existing tag yet.')).toBeInTheDocument();
  });

  it('hides the new-tag hint while the suggestion list is open to avoid overlapping it', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0), allTags: ['alphabet'] });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    fireEvent.change(screen.getByPlaceholderText('Target tag'), { target: { value: 'al' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.queryByText('"al" is not an existing tag yet.')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText('Target tag'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText('"al" is not an existing tag yet.')).toBeInTheDocument();
  });

  it('closes suggestions on Escape without closing the form', async () => {
    renderTagActions({ onPreviewUsage: vi.fn().mockResolvedValue(0), allTags: ['beta'] });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText('Merge into…')); });

    const input = screen.getByPlaceholderText('Target tag');
    fireEvent.change(input, { target: { value: 'bet' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Target tag')).toBeInTheDocument();
  });
});
