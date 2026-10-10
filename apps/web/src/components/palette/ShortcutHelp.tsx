import './shortcut-help.css';
import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ResolvedCommand } from '../../lib/commands/registry.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { describeKeys, formatKeys } from '../../lib/keyboard/keys.js';
import { keymapEntry, SHORTCUT_GROUPS } from '../../lib/keyboard/keymap.js';
import { type KeyEnvironment, keyEnvironment } from '../../lib/keyboard/platform.js';

interface ShortcutHelpProps {
  /** Every registry command: each KEYMAP entry and each registered palette-only command. */
  commands: readonly ResolvedCommand[];
  env?: KeyEnvironment;
}

/** Why a row cannot be used here, or null. Keys a CodeMirror keymap or a widget handles act wherever their scope has focus. */
function unavailableReason(command: ResolvedCommand, notHere: string): string | null {
  if (command.handler !== null && command.handler !== 'dispatcher') return null;
  if (!command.registered) return notHere;
  return command.availability.enabled ? null : command.availability.reason;
}

/** The keyboard shortcut list, generated from the registry, grouped and filtered by name or key. */
export function ShortcutHelp({ commands, env = keyEnvironment }: ShortcutHelpProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const headingPrefix = useId();
  const then = t('shortcuts.then');
  const rows = useMemo(() =>
    commands.map(command => {
      const labels = command.keys.map(keys => formatKeys(keys, env));
      const scopes = command.scopes?.map(scope => t(`shortcuts.scope.${scope}`)) ?? [];
      // Typed key text (`mod+/`, `ctrl+shift+p`) and the shown labels (`⌘/`, `G then N`) both find a row.
      const keyText = command.handler ? keymapEntry(command.id).bindings.map(binding => binding.keys) : [];
      const haystack = [command.title, command.englishTitle, command.description ?? '', command.id, ...scopes, ...keyText, ...command.keys.map(keys => describeKeys(keys, env, then)), ...labels.flat()].join('\n').toLocaleLowerCase();
      return { command, labels, scopes, haystack, reason: unavailableReason(command, t('shortcuts.unavailableHere')) };
    }), [commands, env, t, then]);
  const needle = filter.trim().toLocaleLowerCase();
  const shown = needle ? rows.filter(row => needle.split(/\s+/).every(word => row.haystack.includes(word))) : rows;
  return (
    <div className='shortcut-help' data-registry-count={commands.length}>
      <label className='keyboard-shortcuts-search'>
        <Search aria-hidden='true' />
        <input type='search' aria-label={t('shortcuts.filter')} placeholder={t('shortcuts.filterPlaceholder')} value={filter} onChange={event => setFilter(event.target.value)} autoComplete='off' />
      </label>
      <p className='shortcut-help-count' role='status'>{shown.length ? t('shortcuts.count', { count: shown.length }) : t('shortcuts.noShortcutResults')}</p>
      <div className='shortcut-help-groups'>
        {SHORTCUT_GROUPS.map(group => {
          const groupRows = shown.filter(row => row.command.group === group);
          if (!groupRows.length) return null;
          const headingId = `${headingPrefix}-${group}`;
          return (
            <section key={group} className='shortcut-help-group' aria-labelledby={headingId}>
              <h3 id={headingId}>{t(`shortcuts.group.${group}`)}</h3>
              <ul>
                {groupRows.map(({ command, labels, scopes, reason }) => (
                  <li key={command.id} data-shortcut-id={command.id} data-unavailable={reason ? true : undefined}>
                    <span className='shortcut-help-name'>
                      <span>{command.title}</span>
                      {command.description && <small>{command.description}</small>}
                      {scopes.length > 0 && <small className='shortcut-help-scope'>{scopes.join(' · ')}</small>}
                      {reason && <small className='shortcut-help-reason'>{reason}</small>}
                    </span>
                    <span className='shortcut-help-keys'>
                      {labels.length
                        ? labels.map((chords, index) => (
                          <span key={index} className='shortcut-help-binding'>
                            {index > 0 && <small>/</small>}
                            {chords.map((label, chord) => (
                              <span key={chord}>
                                {chord > 0 && <small>{then}</small>}
                                <kbd>{label}</kbd>
                              </span>
                            ))}
                          </span>
                        ))
                        : <small>{t('shortcuts.noKey')}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
