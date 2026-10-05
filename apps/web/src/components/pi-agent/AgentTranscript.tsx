import { AlertTriangle, CircleCheck, CircleX, Info, LoaderCircle, Wrench } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
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

function Blocks({ blocks, transcript }: { blocks: AssistantBlock[]; transcript: TranscriptState; }) {
  const { t } = useTranslation();
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'text') return block.text ? <p key={index} className='pi-agent-text'>{block.text}</p> : null;
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

/** The conversation: sent messages with the note they named, Pi's replies with its tool calls, and notices; `children` follow the latest entry, as Pi's open questions do. */
export function AgentTranscript({ transcript, children }: { transcript: TranscriptState; children?: ReactNode; }) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  // Scrolls only this list; scrollIntoView would also move the panels around it.
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [transcript]);
  return (
    <div ref={list} className='pi-agent-transcript' aria-live='polite'>
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
              <Blocks blocks={entry.blocks} transcript={transcript} />
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
          <Blocks blocks={transcript.streaming} transcript={transcript} />
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
  );
}
