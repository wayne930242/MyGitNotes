import { FolderCog, MessageSquarePlus, Power, Send, Square } from 'lucide-react';
import { type FormEvent, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../Button.js';
import { AgentDialogCard } from './AgentDialogCard.js';
import { AgentTranscript } from './AgentTranscript.js';
import type { CaretStore } from '../../lib/pi-agent/caret-store.js';
import { usePiAgent } from '../../lib/pi-agent/session.js';
import { caretPosition } from '../../lib/pi-agent/transcript.js';
import { useTranslation } from '../../lib/i18n/index.js';
import './pi-agent.css';

export interface AgentPanelProps {
  notebookId: string;
  /** The note's repository-relative path; the panel resolves it to the absolute path Pi reads. */
  notePath: string;
  /** The editor body the caret offset counts in, and the frontmatter lines above it. */
  content: string;
  lineNumberOffset: number;
  caret: CaretStore;
}

/** Restarts Pi in another folder after the user confirms that the conversation ends with it. */
function SwitchFolder({ onDone }: { onDone: () => void; }) {
  const { t } = useTranslation();
  const agent = usePiAgent();
  const [cwd, setCwd] = useState(agent.session?.cwd ?? agent.defaultCwd);
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const roots = [...new Set([agent.defaultCwd, ...agent.workspaceRoots].filter(Boolean))];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await agent.switchCwd(cwd, approve);
      onDone();
    } catch {
      /* The provider shows the error. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className='pi-agent-switch' onSubmit={event => void submit(event)} aria-label={t('piAgent.switchFolder')}>
      <label>
        <span>{t('piAgent.folder')}</span>
        <input className='ui-control' value={cwd} list='pi-agent-roots' onChange={event => setCwd(event.target.value)} spellCheck={false} />
        <datalist id='pi-agent-roots'>{roots.map(root => <option key={root} value={root} />)}</datalist>
      </label>
      <label className='pi-agent-check'>
        <input type='checkbox' checked={approve} onChange={event => setApprove(event.target.checked)} />
        <span>{t('piAgent.approve')}</span>
      </label>
      <p className='pi-agent-hint'>{t('piAgent.switchWarning')}</p>
      <div className='pi-agent-dialog-actions'>
        <Button type='submit' variant='danger' disabled={busy || !cwd.trim()}>{t('piAgent.switchConfirm')}</Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

/** The document panel's agent tab: a conversation with the workspace's Pi process about the note in focus. */
export function AgentPanel({ notebookId, notePath, content, lineNumberOffset, caret }: AgentPanelProps) {
  const { t } = useTranslation();
  const agent = usePiAgent();
  const [draft, setDraft] = useState('');
  const [attachFocus, setAttachFocus] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [file, setFile] = useState<{ notePath: string; path?: string; error?: string; }>({ notePath });
  const offset = useSyncExternalStore(caret.subscribe, caret.get);
  const position = caretPosition(content, offset, lineNumberOffset);
  const { locate } = agent;

  useEffect(() => {
    let current = true;
    locate(notePath, notebookId).then(path => current && setFile({ notePath, path }), (reason: Error) => current && setFile({ notePath, error: reason.message }));
    return () => {
      current = false;
    };
  }, [locate, notePath, notebookId]);

  const session = agent.session;
  const live = Boolean(session && session.status !== 'exited');
  const ready = live && agent.connected;
  const located = file.notePath === notePath ? file.path : undefined;
  const send = () => {
    const text = draft.trim();
    if (!text || !ready) return;
    agent.send(text, attachFocus && located ? { file: located, ...position } : undefined);
    setDraft('');
  };

  return (
    <section className='pi-agent-panel' aria-label={t('piAgent.title')}>
      <header className='pi-agent-header'>
        <span className='pi-agent-status' data-status={live ? session!.status : 'none'}>{t(live ? `piAgent.status.${session!.status}` as const : 'piAgent.status.none')}</span>
        {session && (
          <span className='pi-agent-cwd' title={session.cwd}>
            <bdi>{session.cwd}</bdi>
          </span>
        )}
        <Button size='icon' title={t('piAgent.switchFolder')} aria-label={t('piAgent.switchFolder')} aria-expanded={switching} onClick={() => setSwitching(open => !open)}>
          <FolderCog aria-hidden='true' />
        </Button>
        <Button size='icon' title={t('piAgent.newConversation')} aria-label={t('piAgent.newConversation')} disabled={!ready} onClick={agent.newConversation}>
          <MessageSquarePlus aria-hidden='true' />
        </Button>
        <Button size='icon' title={t('piAgent.end')} aria-label={t('piAgent.end')} disabled={!live} onClick={() => void agent.end()}>
          <Power aria-hidden='true' />
        </Button>
      </header>
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
      <AgentTranscript transcript={agent.transcript}>{agent.transcript.dialogs.map(dialog => <AgentDialogCard key={dialog.id} dialog={dialog} onAnswer={answer => agent.answer(dialog, answer)} />)}</AgentTranscript>
      {[...Object.values(agent.transcript.widgets).flat(), ...Object.values(agent.transcript.statuses)].length > 0 && <div className='pi-agent-widgets'>{Object.entries(agent.transcript.widgets).map(([key, lines]) => <pre key={key}>{lines.join('\n')}</pre>)} {Object.entries(agent.transcript.statuses).map(([key, text]) => <span key={key}>{text}</span>)}</div>}
      <form
        className='pi-agent-composer'
        onSubmit={event => {
          event.preventDefault();
          send();
        }}
      >
        <label className='pi-agent-check' title={located ?? file.error}>
          <input type='checkbox' checked={attachFocus} onChange={event => setAttachFocus(event.target.checked)} />
          <span className='pi-agent-focus-chip'>{notePath.slice(notePath.lastIndexOf('/') + 1)}:{position.line}:{position.column}</span>
        </label>
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
