import { Info, Plug, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../Button.js';
import { type PiMcpServer, type PiSessionInfo, usePiAgent } from '../../lib/pi-agent/session.js';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';

/** The part of Pi's surroundings the info drawer shows: its trust decision, its MCP servers, or its extensions' reports. */
export type InfoSection = 'trust' | 'mcp' | 'extensions';
const SECTIONS: readonly InfoSection[] = ['trust', 'mcp', 'extensions'];
const SECTION_KEY = 'mygitnotes.piAgent.infoSection';

/** The open section, remembered so the drawer stays open across reloads until the user closes it. */
export function useInfoSection(): [InfoSection | null, (section: InfoSection | null) => void] {
  const [section, setSection] = useState<InfoSection | null>(() => {
    try {
      const saved = localStorage.getItem(SECTION_KEY);
      return SECTIONS.includes(saved as InfoSection) ? saved as InfoSection : null;
    } catch {
      return null;
    }
  });
  const choose = (next: InfoSection | null) => {
    setSection(next);
    try {
      if (next) localStorage.setItem(SECTION_KEY, next);
      else localStorage.removeItem(SECTION_KEY);
    } catch { /* The drawer still opens until the panel closes. */ }
  };
  return [section, choose];
}

const off = (server: PiMcpServer) => server.status === 'disabled' || server.status === 'blocked';
const MCP_STATUSES = new Set(['connected', 'cached', 'not-connected', 'needs-auth', 'failed', 'blocked']);
/** How a status badge reads at a glance: working, idle, or needing attention. */
const MCP_TONES: Record<string, string> = { connected: 'ok', 'needs-auth': 'warning', failed: 'warning', blocked: 'warning' };

/** Which sections have something to show for this session. */
function availableSections(session: PiSessionInfo | null, extensionCount: number): InfoSection[] {
  const live = session && session.status !== 'exited';
  return SECTIONS.filter(section => section === 'trust' ? live && session.trusted !== undefined : section === 'mcp' ? live && session.mcpServers !== undefined : extensionCount > 0);
}

function useExtensionEntries() {
  const { widgets, statuses } = usePiAgent().transcript;
  return { widgets: Object.entries(widgets).filter(([, lines]) => lines.length > 0), statuses: Object.entries(statuses) };
}

/** The buttons at the start of the send row; each opens its section of the drawer, and the open one closes it. */
export function InfoToggles({ section, onToggle }: { section: InfoSection | null; onToggle: (section: InfoSection | null) => void; }) {
  const { t } = useTranslation();
  const session = usePiAgent().session;
  const extensions = useExtensionEntries();
  const sections = availableSections(session, extensions.widgets.length + extensions.statuses.length);
  const servers = session?.mcpServers ?? [];
  const labels: Record<InfoSection, string> = { trust: t(session?.trusted ? 'piAgent.trusted' : 'piAgent.untrusted'), mcp: t('piAgent.mcp.label', { enabled: servers.filter(server => !off(server)).length, total: servers.length }), extensions: t('piAgent.extensionInfo') };
  const icon = (key: InfoSection) => key === 'trust' ? session?.trusted ? <ShieldCheck aria-hidden='true' /> : <ShieldOff aria-hidden='true' /> : key === 'mcp' ? <Plug aria-hidden='true' /> : <Info aria-hidden='true' />;
  return sections.map(key => <Button key={key} size='icon' className='pi-agent-info-toggle' data-section={key} data-trusted={key === 'trust' ? session?.trusted : undefined} title={labels[key]} aria-label={labels[key]} aria-pressed={section === key} onClick={() => onToggle(section === key ? null : key)}>{icon(key)}</Button>);
}

/** A status report that clamps to two lines until clicked, since some extensions report long ones. */
function StatusLine({ name, text }: { name: string; text: string; }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className='pi-agent-info-row'>
      <span className='pi-agent-badge'>{name}</span>
      <button type='button' className='pi-agent-info-text' aria-expanded={expanded} title={expanded ? undefined : text} onClick={() => setExpanded(current => !current)}>{text}</button>
    </li>
  );
}

/** The drawer between the message box and the send row, showing the open section until the user closes it. */
export function InfoDrawer({ section, onClose }: { section: InfoSection | null; onClose: () => void; }) {
  const { t } = useTranslation();
  const session = usePiAgent().session;
  const extensions = useExtensionEntries();
  if (!section || !availableSections(session, extensions.widgets.length + extensions.statuses.length).includes(section)) return null;
  const servers = session!.mcpServers ?? [];
  const enabled = servers.filter(server => !off(server));
  const disabled = servers.filter(off);
  const status = (server: PiMcpServer) => MCP_STATUSES.has(server.status) ? t(`piAgent.mcp.status.${server.status}` as TranslationKey) : server.status;
  const serverRow = (server: PiMcpServer) => (
    <li key={server.name} className='pi-agent-info-row'>
      <span className='pi-agent-info-name'>{server.name}</span>
      {(server.status !== 'disabled') && <span className='pi-agent-badge' data-tone={MCP_TONES[server.status] ?? 'muted'} title={server.blockedReason}>{status(server)}</span>}
      {server.toolCount > 0 && <span className='pi-agent-badge'>{t(server.toolCount === 1 ? 'piAgent.mcp.tool' : 'piAgent.mcp.tools', { count: server.toolCount })}</span>}
    </li>
  );
  const titles: Record<InfoSection, string> = { trust: t('piAgent.info.trust'), mcp: t('piAgent.info.mcp'), extensions: t('piAgent.extensionInfo') };
  return (
    <section className='pi-agent-info-drawer' aria-label={titles[section]}>
      <header>
        <h3>{titles[section]}</h3>
        <Button size='icon' title={t('piAgent.info.close')} aria-label={t('piAgent.info.close')} onClick={onClose}>
          <X aria-hidden='true' />
        </Button>
      </header>
      <div className='pi-agent-info-body'>
        {section === 'trust' && (
          <>
            <span className='pi-agent-badge' data-tone={session!.trusted ? 'ok' : 'warning'}>{t(session!.trusted ? 'piAgent.trusted' : 'piAgent.untrusted')}</span>
            <p>{t('piAgent.trustHint')}</p>
          </>
        )}
        {section === 'mcp' && (
          <>
            <h4>{t('piAgent.mcp.enabled', { count: enabled.length })}</h4>
            <ul>{enabled.map(serverRow)}</ul>
            {disabled.length > 0 && (
              <>
                <h4>{t('piAgent.mcp.disabled', { count: disabled.length })}</h4>
                <ul>{disabled.map(serverRow)}</ul>
              </>
            )}
          </>
        )}
        {section === 'extensions' && (
          <>
            {extensions.statuses.length > 0 && <ul>{extensions.statuses.map(([key, text]) => <StatusLine key={key} name={key} text={text} />)}</ul>}
            {extensions.widgets.map(([key, lines]) => (
              <div key={key} className='pi-agent-info-widget'>
                <span className='pi-agent-badge'>{key}</span>
                <pre>{lines.join('\n')}</pre>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
