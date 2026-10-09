// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreditCard } from 'lucide-react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebApp } from '../app/create-web-app.js';
import { AuthControls } from '../components/AuthControls.js';
import { NoteInfoPanel } from '../components/note-editor/NoteInfoPanel.js';
import { NoteLocationProvider } from './note-location.js';
import { SettingsModal } from '../components/SettingsModal.js';
import { useAccountControls, useAgentEnabled, useCommitMessagePolish, useFeatureGate, type WebFeature, WebFeaturesProvider } from './web-features.js';

vi.mock('../components/CoreUpdates.js', () => ({ CoreUpdates: () => null }));
vi.mock('../components/ProductVersion.js', () => ({ ProductVersion: () => null }));
vi.mock('../components/WorkspaceManifestEditor.js', () => ({ WorkspaceManifestEditor: () => null }));

const billing: WebFeature = { id: 'billing', routes: [{ path: '/billing', element: createElement('h1', null, 'Billing page') }], settingsSections: [{ id: 'plan', title: 'Plan', icon: CreditCard, element: createElement('p', null, 'Pro plan') }], accountControls: ({ local }) => createElement('span', null, `tenant menu ${local ? 'local' : 'hosted'}`) };

const settings = (features: WebFeature[]) => renderToStaticMarkup(createElement(WebFeaturesProvider, { features }, createElement(SettingsModal, { manifest: { repositories: [], defaultRepository: '', initialRepository: '', onManifestRevision: () => {} }, onRefreshWorkspace: async () => {}, currentTheme: { familyId: 'flexoki', mode: 'light' }, onSelectTheme: () => {} })));

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

async function settingsPage(features: WebFeature[]) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  const slot = document.createElement('div');
  slot.id = 'workspace-sidebar-slot';
  const container = document.createElement('div');
  document.body.append(slot, container);
  root = createRoot(container);
  const repositories = { repositories: [], onMembershipChanged: async () => {}, onOpenChanges: () => {} };
  await act(async () => root!.render(createElement(WebFeaturesProvider, { features }, createElement(SettingsModal, { manifest: { repositories: [], defaultRepository: '', initialRepository: '', onManifestRevision: () => {} }, repositories, onRefreshWorkspace: async () => {}, currentTheme: { familyId: 'flexoki', mode: 'light' }, onSelectTheme: () => {} }))));
  const page = { links: [...slot.querySelectorAll('a.sidebar-link')].map(link => link.getAttribute('href')), sections: [...container.querySelectorAll('[id^="settings-"]')].map(section => section.id), text: container.textContent };
  slot.remove();
  container.remove();
  vi.restoreAllMocks();
  return page;
}

it("puts an edition's section in place of the community section with the same id", async () => {
  const members: WebFeature = { id: 'members', settingsSections: [{ id: 'repositories', title: 'Members', icon: CreditCard, element: createElement('p', null, 'Edition members') }] };
  const community = await settingsPage([]);
  act(() => root?.unmount());
  root = undefined;
  const replaced = await settingsPage([members]);
  expect(replaced.links).toEqual(community.links);
  expect(replaced.links.filter(link => link === '#settings-repositories')).toHaveLength(1);
  expect(replaced.sections).toEqual(community.sections);
  expect(replaced.text).toContain('Edition members');
});

it('keeps the community repositories section when an edition replaces only another section', async () => {
  const theme: WebFeature = { id: 'theme', settingsSections: [{ id: 'theme', title: 'Brand theme', icon: CreditCard, element: createElement('p', null, 'Edition theme') }] };
  const page = await settingsPage([theme, billing]);
  expect(page.links.filter(link => link === '#settings-theme')).toHaveLength(1);
  expect(page.text).toContain('Edition theme');
  expect(page.links.filter(link => link === '#settings-repositories')).toHaveLength(1);
  expect(page.sections.filter(section => section === 'settings-repositories')).toHaveLength(1);
  expect(page.links.at(-1)).toBe('#settings-plan');
  expect(page.sections.at(-1)).toBe('settings-plan');
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

it("adds an edition's entries to the signed-in account menu", async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: true, login: 'octo', provider: 'github' }), { headers: { 'Content-Type': 'application/json' } }));
  const recent: WebFeature = { id: 'recent', accountMenuItems: ({ close }) => createElement('button', { onClick: close }, 'octo/journal') };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => root!.render(createElement(WebFeaturesProvider, { features: [recent] }, createElement(AuthControls))));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const menu = container.querySelector('details')!;
  await act(async () => {
    menu.open = true;
    menu.dispatchEvent(new Event('toggle'));
  });
  const entry = [...container.querySelectorAll('.header-user-items button')].find(button => button.textContent === 'octo/journal') as HTMLButtonElement;
  expect(entry).toBeDefined();
  await act(async () => entry.click());
  expect(menu.open).toBe(false);
  container.remove();
  vi.restoreAllMocks();
});

it('opens every feature without gates, and shows the first denial otherwise', () => {
  function Probe({ id }: { id: string; }) {
    const gate = useFeatureGate(id);
    return createElement('span', null, gate.allowed ? 'open' : gate.reason);
  }
  const html = (features: WebFeature[], id: string) => renderToStaticMarkup(createElement(WebFeaturesProvider, { features }, createElement(Probe, { id })));
  expect(html([], 'agent')).toBe('<span>open</span>');
  expect(html([{ id: 'quiet' }, { id: 'open', gate: () => ({ allowed: true }) }], 'r2')).toBe('<span>open</span>');
  const denying: WebFeature = { id: 'plans', gate: id => id === 'r2' ? { allowed: false, reason: 'Upgrade' } : { allowed: true } };
  const later: WebFeature = { id: 'later', gate: () => ({ allowed: false, reason: 'Later' }) };
  expect(html([denying, later], 'r2')).toBe('<span>Upgrade</span>');
  expect(html([denying, later], 'agent')).toBe('<span>Later</span>');
});

it('lets the last feature that sets one supply the commit message polish', () => {
  const first = async () => 'first', second = async () => 'second';
  function Probe() {
    const polish = useCommitMessagePolish();
    return createElement('span', null, polish ? String(polish === second) : 'none');
  }
  const html = (features: WebFeature[]) => renderToStaticMarkup(createElement(WebFeaturesProvider, { features }, createElement(Probe)));
  expect(html([])).toBe('<span>none</span>');
  expect(html([{ id: 'a', commitMessagePolish: first }, { id: 'b' }, { id: 'c', commitMessagePolish: second }])).toBe('<span>true</span>');
});

it('asks a remote deployment for an agent session only when an edition says its server has one', () => {
  function Probe({ remote }: { remote: boolean; }) {
    return createElement('span', null, String(useAgentEnabled(remote)));
  }
  const html = (features: WebFeature[], remote: boolean) => renderToStaticMarkup(createElement(WebFeaturesProvider, { features }, createElement(Probe, { remote })));
  // A local workspace always asks; the community edition's remote one never does.
  expect(html([], false)).toBe('<span>true</span>');
  expect(html([], true)).toBe('<span>false</span>');
  expect(html([{ id: 'quiet' }, { id: 'declined', agent: false }], true)).toBe('<span>false</span>');
  expect(html([{ id: 'quiet' }, { id: 'hosted-agent', agent: true }], true)).toBe('<span>true</span>');
});

it("renders an edition's rows in a writable note's info panel and none without features", () => {
  const note = { notebookId: 'life', path: 'notes/life/a.md' };
  const location = (gists: boolean) => ({ notebook: 'Life', repository: 'owner/home', branch: 'main', path: note.path, gists });
  const panel = (features: WebFeature[], gists = true) =>
    renderToStaticMarkup(
      <WebFeaturesProvider features={features}>
        <NoteLocationProvider locate={() => location(gists)}>
          <NoteInfoPanel note={note} content='Body' metadata={{ publish: 'a' }} setMetadata={() => {}} locked={false} />
        </NoteLocationProvider>
      </WebFeaturesProvider>,
    );
  const pages: WebFeature = { id: 'pages', publish: ({ repository, metadata, locked }) => createElement('div', null, createElement('dt', null, 'Public page'), createElement('dd', null, `${repository} ${String(metadata.publish)} ${locked ? 'locked' : 'open'}`)) };
  expect(panel([])).not.toContain('Public page');
  expect(panel([pages])).toContain('<dt>Public page</dt><dd>owner/home a open</dd>');
  expect(panel([pages], false)).not.toContain('Public page');
});
