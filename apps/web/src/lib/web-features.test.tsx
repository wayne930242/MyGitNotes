// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreditCard } from 'lucide-react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebApp } from '../app/create-web-app.js';
import { SettingsModal } from '../components/SettingsModal.js';
import { useAccountControls, type WebFeature, WebFeaturesProvider } from './web-features.js';

vi.mock('../components/CoreUpdates.js', () => ({ CoreUpdates: () => null }));
vi.mock('../components/ProductVersion.js', () => ({ ProductVersion: () => null }));
vi.mock('../components/WorkspaceManifestEditor.js', () => ({ WorkspaceManifestEditor: () => null }));

const billing: WebFeature = { id: 'billing', routes: [{ path: '/billing', element: createElement('h1', null, 'Billing page') }], settingsSections: [{ id: 'plan', title: 'Plan', icon: CreditCard, element: createElement('p', null, 'Pro plan') }], accountControls: ({ local }) => createElement('span', null, `tenant menu ${local ? 'local' : 'hosted'}`) };

const settings = (features: WebFeature[]) => renderToStaticMarkup(createElement(WebFeaturesProvider, { features }, createElement(SettingsModal, { config: null, canWrite: false, configRevision: '', onConfigRevision: () => {}, branch: 'main', onRefreshWorkspace: async () => {}, currentTheme: { familyId: 'flexoki', mode: 'light' }, onSelectTheme: () => {} })));

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  window.history.replaceState(null, '', '/');
});

it("appends an edition's settings sections and leaves the page unchanged without features", () => {
  const plain = settings([]);
  expect(plain).not.toContain('settings-plan');
  const extended = settings([billing]);
  expect(extended).toContain('id="settings-plan"');
  expect(extended).toContain('Pro plan');
  expect(extended.replace(/<div id="settings-plan".*?Pro plan<\/p><\/div>/, '')).toBe(plain);
});

it('lets the last feature that sets them replace the account controls', () => {
  function Probe() {
    const render = useAccountControls();
    return render ? render({ local: false }) : createElement('span', null, 'community controls');
  }
  expect(renderToStaticMarkup(createElement(WebFeaturesProvider, { features: [] }, createElement(Probe)))).toBe('<span>community controls</span>');
  expect(renderToStaticMarkup(createElement(WebFeaturesProvider, { features: [{ id: 'none' }, billing] }, createElement(Probe)))).toBe('<span>tenant menu hosted</span>');
});

it('routes an edition page beside the workspace routes', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '', '/billing');
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(createElement(WebApp, { features: [billing] })));
  expect(container.textContent).toBe('Billing page');
});
