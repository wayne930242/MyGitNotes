// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AssetLibrary } from './AssetLibrary.js';
import type { AssetItem } from '../lib/types.js';

afterEach(cleanup);
const first = { path: 'assets/a.png', name: 'a.png', directory: 'pictures', size: 1, rawUrl: '/a.png', markdownRef: '![](a.png)' } as AssetItem;
const second = { ...first, path: 'assets/b.png', name: 'b.png' };

it('retains a manually edited move destination on refresh and resets it when selecting another asset', () => {
  const props = { assets: [first, second], initialAssetPath: first.path, onMoveAsset: vi.fn(async () => first), onDeleteAsset: vi.fn(async () => {}) };
  const { rerender } = render(<AssetLibrary {...props} />);
  expect(screen.getByLabelText('Asset folder')).toHaveValue('pictures');
  expect(screen.getByLabelText('Select a.png')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('Move asset to folder'), { target: { value: 'chosen-destination' } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  rerender(<AssetLibrary {...props} assets={[{ ...first }, second]} />);
  expect(screen.getByLabelText('Move asset to folder')).toHaveValue('chosen-destination');
  expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Select b.png'));
  expect(screen.getByLabelText('Move asset to folder')).toHaveValue('pictures');
  expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
});

it('applies directory and asset requests in their existing order while allowing manual browsing between requests', () => {
  const assets = [first, second];
  const { rerender } = render(<AssetLibrary assets={assets} initialDirectory='other' initialAssetPath={first.path} />);
  expect(screen.getByLabelText('Asset folder')).toHaveValue('pictures');
  fireEvent.change(screen.getByLabelText('Asset folder'), { target: { value: 'manual' } });
  rerender(<AssetLibrary assets={assets} initialDirectory='other' initialAssetPath={first.path} />);
  expect(screen.getByLabelText('Asset folder')).toHaveValue('manual');
  rerender(<AssetLibrary assets={assets} initialDirectory='next' initialAssetPath={first.path} />);
  expect(screen.getByLabelText('Asset folder')).toHaveValue('next');
  rerender(<AssetLibrary assets={[...assets]} initialDirectory='next' initialAssetPath={first.path} />);
  expect(screen.getByLabelText('Asset folder')).toHaveValue('pictures');
  expect(screen.getByLabelText('Select a.png')).toHaveAttribute('aria-pressed', 'true');
});
