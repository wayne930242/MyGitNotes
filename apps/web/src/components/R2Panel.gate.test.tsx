// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { type WebFeature, WebFeaturesProvider } from '../lib/web-features.js';
import { R2Panel, type R2PanelProps } from './R2Panel.js';

afterEach(cleanup);

const props: R2PanelProps = { notebookId: 'nb', listing: { prefix: '', objects: [{ key: 'docs/guide.pdf', size: 10, lastModified: '2026-01-01T00:00:00Z' }] }, directory: '', mutable: true, showHidden: false, busy: false, run: vi.fn(async () => true), onNavigate: vi.fn(), onRefresh: vi.fn(async () => undefined), onNotesChanged: vi.fn(async () => {}) };
const view = (features: WebFeature[]) => createElement(I18nProvider, null, createElement(WebFeaturesProvider, { features }, createElement(R2Panel, props)));

it("shows an edition gate's reason in place of the R2 panel, and lists the objects when it allows", () => {
  const gated = (allowed: boolean): WebFeature => ({ id: 'plans', gate: id => id === 'r2' ? { allowed, reason: 'R2 storage is part of Pro.' } : { allowed: true } });
  const { rerender } = render(view([gated(false)]));
  expect(screen.getByRole('status').textContent).toBe('R2 storage is part of Pro.');
  expect(screen.queryByText('docs')).toBeNull();
  rerender(view([gated(true)]));
  expect(screen.queryByText('R2 storage is part of Pro.')).toBeNull();
  expect(screen.getByText('docs')).toBeTruthy();
});

it('is unchanged without features', () => {
  render(view([]));
  expect(screen.getByText('docs')).toBeTruthy();
});
