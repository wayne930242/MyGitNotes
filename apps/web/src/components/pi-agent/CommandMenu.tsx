import { useEffect, useRef } from 'react';
import type { PiCommand } from '../../lib/pi-agent/commands.js';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';

/**
 * The commands matching what follows `/` in the message box, floating just above it. The message box keeps focus
 * and drives the highlight (see AgentPanel), so typing narrows the list without leaving the box.
 */
export function CommandMenu({ id, commands, highlight, onPick }: { id: string; commands: PiCommand[]; highlight: number; onPick: (command: PiCommand) => void; }) {
  const { t } = useTranslation();
  const list = useRef<HTMLUListElement>(null);
  // Keeps the highlighted row in view by scrolling only this list; scrollIntoView would also move the panels around it.
  useEffect(() => {
    const element = list.current;
    const item = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !item) return;
    if (item.offsetTop < element.scrollTop) element.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > element.scrollTop + element.clientHeight) element.scrollTop = item.offsetTop + item.offsetHeight - element.clientHeight;
  }, [highlight]);
  return (
    <ul ref={list} id={id} className='pi-agent-commands' role='listbox' aria-label={t('piAgent.commands')}>
      {commands.length === 0 && <li className='pi-agent-commands-empty'>{t('piAgent.commands.none')}</li>}
      {commands.map((command, index) => (
        <li
          key={`${command.source}:${command.name}`}
          id={`${id}-${index}`}
          role='option'
          aria-selected={index === highlight}
          title={command.description}
          // Keeps focus in the message box, so the pick lands there.
          onMouseDown={event => event.preventDefault()}
          onClick={() => onPick(command)}
        >
          <span className='pi-agent-command-name'>/{command.name}{command.usage && <span className='pi-agent-command-usage'>{command.usage}</span>}</span>
          {command.description && <span className='pi-agent-command-description'>{command.description}</span>}
          <span className='pi-agent-badge'>{t(`piAgent.commands.source.${command.source}` as TranslationKey)}</span>
        </li>
      ))}
    </ul>
  );
}
