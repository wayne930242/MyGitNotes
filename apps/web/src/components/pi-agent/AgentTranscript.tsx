import { AlertTriangle, CircleCheck, CircleX, Info, LoaderCircle, Wrench } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { NoteHtml } from '../NoteHtml.js';
import { type ChatLinkBase, renderChatMarkdown } from '../../lib/markdown.js';
import { type AssistantBlock, focusLabel, type TranscriptState } from '../../lib/pi-agent/transcript.js';
import { useTranslation } from '../../lib/i18n/index.js';

const OUTPUT_LIMIT = 4000;

/** One line naming a tool call's main argument: a path, a command or a pattern. */
function argsSummary(args: unknown): string {
  if (typeof args !== 'object' || args === null) return '';
  const record = args as Record<string, unknown>;
  const main = record.path ?? record.command ?? record.pattern ?? record.query ?? record.url ?? record.question;
  if (typeof main === 'string') return main;
  const json = JSON.stringify(args);
  return json === '{}' ? '' : json;
}

function ToolCall({ block, transcript }: { block: Extract<AssistantBlock, { type: 'toolCall'; }>; transcript: TranscriptState; }) {
  const { t } = useTranslation();
  const outcome = transcript.tools[block.id];
  const state = !outcome ? 'pending' : outcome.running ? 'running' : outcome.isError ? 'error' : 'done';
  const Icon = state === 'running' || state === 'pending' ? LoaderCircle : state === 'error' ? CircleX : CircleCheck;
  const output = outcome?.text ?? '';
  return (
    <details className='pi-agent-tool' data-state={state}>
      <summary>
        <Wrench aria-hidden='true' />
        <span className='pi-agent-tool-name'>{block.name}</span>
        <span className='pi-agent-tool-args' title={argsSummary(block.args)}>{argsSummary(block.args)}</span>
        <Icon aria-label={t(`piAgent.tool.${state}`)} className='pi-agent-tool-state' />
      </summary>
      {block.args !== undefined && <pre className='pi-agent-pre'>{JSON.stringify(block.args, null, 2)}</pre>}
      {output && <pre className='pi-agent-pre'>{output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}\n…` : output}</pre>}
    </details>
  );
}

/** Pi writes Markdown; the reply is re-rendered as it streams in. */
function MarkdownText({ text, links }: { text: string; links?: ChatLinks; }) {
  const html = useMemo(() => renderChatMarkdown(text, links?.base), [text, links?.base]);
  return <NoteHtml className='prose-custom pi-agent-markdown' html={html} notebookId={links?.notebookId} />;
}

/** Where reply links resolve: the session's notebook, which scopes them to its repository, and its folder. */
export interface ChatLinks {
  notebookId: string;
  base: ChatLinkBase;
}

function Blocks({ blocks, transcript, links }: { blocks: AssistantBlock[]; transcript: TranscriptState; links?: ChatLinks; }) {
  const { t } = useTranslation();
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'text') return block.text ? <MarkdownText key={index} text={block.text} links={links} /> : null;
        if (block.type === 'thinking') {
          return (
            <details key={index} className='pi-agent-thinking'>
              <summary>{t('piAgent.thinking')}</summary>
              <p className='pi-agent-text'>{block.text}</p>
            </details>
          );
        }
        return <ToolCall key={block.id || index} block={block} transcript={transcript} />;
      })}
    </>
  );
}

const NOTICE_ICONS = { info: Info, warning: AlertTriangle, error: CircleX };
/** How near the bottom still counts as at it, so a fraction of a pixel never stops the list following. */
const PIN_SLACK_PX = 24;

/** The conversation: sent messages with the note they named, Pi's replies with its tool calls, and notices; `children` follow the latest entry, as Pi's open questions do. */
export function AgentTranscript({ transcript, links, children }: { transcript: TranscriptState; links?: ChatLinks; children?: ReactNode; }) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Follows the latest entry while the reader is at the bottom, which the list starts at, so a restored history
  // opens on its end; reading further up stops following. Scrolls only this list; scrollIntoView would also
  // move the panels around it.
  const pinned = useRef(true);
  const follow = () => {
    if (list.current && pinned.current) list.current.scrollTop = list.current.scrollHeight;
  };
  useLayoutEffect(follow, [transcript]);
  // Markdown, math and diagrams can grow after they render, so the list keeps its end in view as they do.
  useEffect(() => {
    if (!content.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(follow);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const element = list.current;
    if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < PIN_SLACK_PX;
  };
  return (
    <div ref={list} className='pi-agent-transcript' aria-live='polite' onScroll={onScroll}>
      <div ref={content} className='pi-agent-transcript-content'>
        {transcript.entries.length === 0 && !transcript.streaming && <p className='pi-agent-empty'>{t('piAgent.empty')}</p>}
        {transcript.entries.map(entry => {
          if (entry.kind === 'user') {
            return (
              <div key={entry.key} className='pi-agent-message' data-role='user'>
                {entry.focus && <span className='pi-agent-focus-chip' title={entry.focus.file}>{focusLabel(entry.focus)}</span>}
                <p className='pi-agent-text'>{entry.text}</p>
              </div>
            );
          }
          if (entry.kind === 'assistant') {
            return (
              <div key={entry.key} className='pi-agent-message' data-role='assistant'>
                <Blocks blocks={entry.blocks} transcript={transcript} links={links} />
                {entry.error && <p role='alert' className='pi-agent-error'>{entry.error}</p>}
              </div>
            );
          }
          const Icon = NOTICE_ICONS[entry.level];
          return (
            <p key={entry.key} className='pi-agent-notice' data-level={entry.level}>
              <Icon aria-hidden='true' />
              {entry.text === 'compacted' ? t('piAgent.compacted') : entry.text}
            </p>
          );
        })}
        {transcript.streaming && (
          <div className='pi-agent-message' data-role='assistant' data-streaming='true'>
            <Blocks blocks={transcript.streaming} transcript={transcript} links={links} />
          </div>
        )}
        {transcript.running && !transcript.streaming && (
          <p className='pi-agent-working'>
            <LoaderCircle aria-hidden='true' />
            {t('piAgent.working')}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
