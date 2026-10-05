import { ChevronDown, Info, MessageSquarePlus, Power, Send, ShieldCheck, ShieldOff, Square } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '../Button.js';
import { FolderPickerDialog } from '../FolderPickerDialog.js';
import { Select } from '../Select.js';
import { AgentDialogCard } from './AgentDialogCard.js';
import { AgentTranscript, type ChatLinks } from './AgentTranscript.js';
import { type PiLocation, type PiSessionInfo, usePiAgent } from '../../lib/pi-agent/session.js';
import { type AgentFocus, focusLabel, selectionPosition } from '../../lib/pi-agent/transcript.js';
import { useTranslation } from '../../lib/i18n/index.js';
import './pi-agent.css';

type ContextMode = 'line' | 'path' | 'none';
const CONTEXT_MODES: readonly ContextMode[] = ['line', 'path', 'none'];
const CONTEXT_KEY = 'mygitnotes.piAgent.context';
const noSelection = { from: 0, to: 0 };
const noCaret = { subscribe: () => () => {}, get: () => noSelection };

function savedContextMode(): ContextMode {
  try {
    const saved = localStorage.getItem(CONTEXT_KEY);
    return CONTEXT_MODES.includes(saved as ContextMode) ? saved as ContextMode : 'line';
  } catch {
    return 'line';
  }
}

/** Restarts Pi in another notebook folder after the user confirms that the conversation ends with it. */
function SwitchFolder({ onDone }: { onDone: () => void; }) {
  const { t } = useTranslation();
  const agent = usePiAgent();
  const [busy, setBusy] = useState(false);
  const initial = agent.session?.location ?? { notebookId: agent.target?.notebookId ?? agent.notebooks[0]?.id ?? '', folder: null };
  const submit = async (location: PiLocation) => {
    setBusy(true);
    try {
      await agent.switchFolder(location);
      onDone();
    } catch {
      /* The provider shows the error. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <FolderPickerDialog title={t('piAgent.switchFolder')} notebooks={agent.notebooks} folders={agent.folders} initial={initial} allowRepository confirmLabel={t('piAgent.switchConfirm')} confirmVariant='danger' busy={busy} onClose={onDone} onConfirm={location => void submit(location)}>
      <p className='pi-agent-hint'>{t('piAgent.switchWarning')}</p>
    </FolderPickerDialog>
  );
}

/**
 * What Pi's extensions report for its status line and widgets (quota, MCP, LSP…), kept out of the panel's
 * height behind an info button at the start of the send row.
 */
function ExtensionInfo() {
  const { t } = useTranslation();
  const { widgets, statuses } = usePiAgent().transcript;
  const [open, setOpen] = useState(false);
  const widgetEntries = Object.entries(widgets).filter(([, lines]) => lines.length > 0);
  const statusEntries = Object.entries(statuses);
  if (widgetEntries.length + statusEntries.length === 0) return null;
  return (
    <div className='pi-agent-info' onKeyDown={event => event.key === 'Escape' && setOpen(false)}>
      <Button size='icon' title={t('piAgent.extensionInfo')} aria-label={t('piAgent.extensionInfo')} aria-expanded={open} onClick={() => setOpen(current => !current)}>
        <Info aria-hidden='true' />
      </Button>
      {open && <div className='pi-agent-info-popover' role='status'>{widgetEntries.map(([key, lines]) => <pre key={key}>{lines.join('\n')}</pre>)} {statusEntries.map(([key, text]) => <p key={key}>{text}</p>)}</div>}
    </div>
  );
}

/**
 * Where links in Pi's replies resolve: the session folder in repository terms, and the repository on disk,
 * read off the session's absolute folder by dropping that relative folder from its end.
 */
function chatLinks(session: PiSessionInfo | null, notebooks: { id: string; root: string; }[]): ChatLinks | undefined {
  const notebook = session && notebooks.find(candidate => candidate.id === session.location.notebookId);
  if (!session || !notebook) return undefined;
  const folder = session.location.repository ? '' : [notebook.root, session.location.folder].filter(part => part && part !== '.').join('/');
  const cwd = session.cwd.replace(/\/+$/, '');
  const repositoryRoot = folder ? cwd.endsWith(`/${folder}`) ? cwd.slice(0, -folder.length - 1) : undefined : cwd;
  return repositoryRoot === undefined ? undefined : { notebookId: notebook.id, base: { folder, repositoryRoot } };
}

/** How the session's folder reads in the header: the notebook title, then the folder inside it, or the project's folder name. */
function locationLabel(location: PiLocation | undefined, cwd: string | undefined, notebooks: { id: string; title: string; }[]): string {
  if (!location) return '';
  if (location.repository) return cwd?.replace(/\/+$/, '').split('/').pop() ?? '';
  const title = notebooks.find(notebook => notebook.id === location.notebookId)?.title ?? location.notebookId;
  return location.folder ? `${title} / ${location.folder}` : title;
}

/** A conversation with the workspace's Pi process, naming the file in focus (see AgentTarget) with each message. */
export function AgentPanel() {
  const { t } = useTranslation();
  const agent = usePiAgent();
  const target = agent.target;
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState(savedContextMode);
  const [switching, setSwitching] = useState(false);
  const [file, setFile] = useState<{ path: string; absolute?: string; error?: string; } | null>(null);
  const caret = target?.caret ?? noCaret;
  const selection = useSyncExternalStore(caret.subscribe, caret.get);
  const position = target?.caret && target.content ? selectionPosition(target.content(), selection, target.lineNumberOffset) : undefined;
  const { locate } = agent;

  useEffect(() => {
    if (!target) return;
    let current = true;
    locate(target.path, target.notebookId).then(absolute => current && setFile({ path: target.path, absolute }), (reason: Error) => current && setFile({ path: target.path, error: reason.message }));
    return () => {
      current = false;
    };
  }, [locate, target]);

  const chooseMode = (next: ContextMode) => {
    setMode(next);
    try {
      localStorage.setItem(CONTEXT_KEY, next);
    } catch { /* The choice still applies until the panel closes. */ }
  };

  const session = agent.session;
  const model = agent.modelState;
  const links = useMemo(() => chatLinks(session, agent.notebooks), [session, agent.notebooks]);
  const live = Boolean(session && session.status !== 'exited');
  const ready = live && agent.connected;
  const located = target && file?.path === target.path ? file.absolute : undefined;
  // Without a caret (a compilation pane), a line request sends the path alone, and the switch says so.
  const effectiveMode: ContextMode = mode === 'line' && !position ? 'path' : mode;
  const focus: AgentFocus | undefined = !located || effectiveMode === 'none' ? undefined : effectiveMode === 'line' && position ? { file: located, ...position } : { file: located };
  const send = () => {
    const text = draft.trim();
    if (!text || !ready) return;
    agent.send(text, focus);
    setDraft('');
  };

  return (
    <section className='pi-agent-panel' aria-label={t('piAgent.title')}>
      <header className='pi-agent-header'>
        <span className='pi-agent-status' data-status={live ? session!.status : 'none'}>{t(live ? `piAgent.status.${session!.status}` as const : 'piAgent.status.none')}</span>
        {/* The folder name opens the folder picker; its tooltip names the absolute folder Pi runs in. */}
        <button type='button' className='pi-agent-cwd' title={session?.cwd ? `${t('piAgent.switchFolder')}\n${session.cwd}` : t('piAgent.switchFolder')} aria-haspopup='dialog' aria-expanded={switching} onClick={() => setSwitching(open => !open)}>
          <span>{locationLabel(session?.location, session?.cwd, agent.notebooks) || t('piAgent.switchFolder')}</span>
          <ChevronDown aria-hidden='true' />
        </button>
        {live && session!.trusted !== undefined && <span className='pi-agent-trust' data-trusted={session!.trusted} title={t('piAgent.trustHint')}>{session!.trusted ? <ShieldCheck aria-hidden='true' /> : <ShieldOff aria-hidden='true' />} {t(session!.trusted ? 'piAgent.trusted' : 'piAgent.untrusted')}</span>}
        <Button size='icon' title={t('piAgent.newConversation')} aria-label={t('piAgent.newConversation')} disabled={!ready} onClick={agent.newConversation}>
          <MessageSquarePlus aria-hidden='true' />
        </Button>
        <Button size='icon' title={t('piAgent.end')} aria-label={t('piAgent.end')} disabled={!live} onClick={() => void agent.end()}>
          <Power aria-hidden='true' />
        </Button>
      </header>
      {ready && agent.modelState.models.length > 0 && (
        <div className='pi-agent-model-row'>
          <Select className='pi-agent-model' aria-label={t('piAgent.model')} title={t('piAgent.model')} value={model.model ?? ''} onValueChange={agent.setModel} options={model.model && !model.models.some(option => option.value === model.model) ? [{ value: model.model, label: model.model }, ...model.models] : model.models} />
          {model.levels.length > 1 && <Select className='pi-agent-thinking' aria-label={t('piAgent.thinkingLevel')} title={t('piAgent.thinkingLevel')} value={model.thinking ?? ''} onValueChange={agent.setThinking} options={model.levels.map(level => ({ value: level, label: level }))} />}
        </div>
      )}
      {switching && <SwitchFolder onDone={() => setSwitching(false)} />}
      {agent.error && <p role='alert' className='pi-agent-error'>{agent.error}</p>}
      {!live && (
        <div className='pi-agent-idle'>
          <p>{t(session?.status === 'exited' ? 'piAgent.exited' : 'piAgent.notRunning')}</p>
          {session?.exit?.stderr && <pre className='pi-agent-pre'>{session.exit.stderr}</pre>}
          <Button variant='primary' onClick={() => void agent.start()}>{t('piAgent.start')}</Button>
        </div>
      )}
      {/* Pi's questions scroll with the conversation, so a tall one never pushes the composer out of the panel. */}
      <AgentTranscript transcript={agent.transcript} links={links}>{agent.transcript.dialogs.map(dialog => <AgentDialogCard key={dialog.id} dialog={dialog} onAnswer={answer => agent.answer(dialog, answer)} />)}</AgentTranscript>
      <form
        className='pi-agent-composer'
        onSubmit={event => {
          event.preventDefault();
          send();
        }}
      >
        {target && (
          <div className='pi-agent-context'>
            <div className='pi-agent-modes' role='radiogroup' aria-label={t('piAgent.context')}>{CONTEXT_MODES.map(option => <button key={option} type='button' role='radio' aria-checked={effectiveMode === option} disabled={option === 'line' && !target.caret} onClick={() => chooseMode(option)}>{t(`piAgent.context.${option}` as const)}</button>)}</div>
            {focus && <span className='pi-agent-focus-chip' title={located}>{focusLabel(focus)}</span>}
            {!located && file?.error && <span className='pi-agent-focus-chip' title={file.error}>{target.path.slice(target.path.lastIndexOf('/') + 1)}</span>}
          </div>
        )}
        <textarea
          className='ui-control'
          rows={3}
          value={draft}
          placeholder={t(ready ? 'piAgent.placeholder' : 'piAgent.connecting')}
          aria-label={t('piAgent.message')}
          disabled={!ready}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className='pi-agent-dialog-actions'>
          <ExtensionInfo />
          {agent.transcript.running && (
            <Button onClick={agent.abort} title={t('piAgent.abort')}>
              <Square aria-hidden='true' />
              {t('piAgent.abort')}
            </Button>
          )}
          <Button type='submit' variant='primary' disabled={!ready || !draft.trim()}>
            <Send aria-hidden='true' />
            {t(agent.transcript.running ? 'piAgent.steer' : 'piAgent.send')}
          </Button>
        </div>
      </form>
    </section>
  );
}
