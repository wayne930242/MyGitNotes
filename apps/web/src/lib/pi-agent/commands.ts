import { type AgentFocus, withFocus } from './transcript.js';

/**
 * A slash command the panel offers. Pi reports its extension commands, prompt templates and skills through
 * `get_commands`; `builtin` ones are TUI commands RPC mode lacks, which the panel runs through their RPC equivalents.
 */
export interface PiCommand {
  name: string;
  description?: string;
  source: 'builtin' | 'extension' | 'prompt' | 'skill';
  /** What follows the name, shown in the menu, such as `<name>` for /name. */
  usage?: string;
}

/** The TUI built-ins the panel runs itself; /reload comes from the bridge's own extension. */
export type BuiltinCommand = 'compact' | 'name' | 'new';
export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = ['compact', 'name', 'new'];

/** What a submitted message asks for: a shell command, a built-in, a command Pi expands itself, or a plain message. */
export type ComposerInput = { kind: 'shell'; command: string; excludeFromContext: boolean; } | { kind: 'builtin'; name: BuiltinCommand; args: string; } | { kind: 'command'; text: string; } | { kind: 'message'; text: string; };

/** Reads the message box as Pi's terminal editor does: `!cmd` runs a shell command, `!!cmd` keeps it out of the context, `/` names a command. */
export function parseComposerInput(text: string): ComposerInput {
  const trimmed = text.trim();
  const shell = /^(!!?)(?!!)\s*(\S[\s\S]*)$/.exec(trimmed);
  if (shell) return { kind: 'shell', command: shell[2].trim(), excludeFromContext: shell[1] === '!!' };
  const builtin = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (builtin && (BUILTIN_COMMANDS as readonly string[]).includes(builtin[1])) return { kind: 'builtin', name: builtin[1] as BuiltinCommand, args: (builtin[2] ?? '').trim() };
  if (trimmed.startsWith('/')) return { kind: 'command', text: trimmed };
  return { kind: 'message', text: trimmed };
}

/**
 * A command as Pi should receive it. Pi recognizes a command only at the very start of the message, so the editor
 * context never goes before one; a skill still gets it inside its arguments, which Pi appends after the skill.
 */
export function commandWithFocus(text: string, focus: AgentFocus | undefined): string {
  const skill = /^(\/skill:\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!skill || !focus) return text;
  return `${skill[1]} ${withFocus(skill[2] ?? '', focus)}`;
}

/** The command name being typed, while the message is still just `/` and a name; undefined once arguments start. */
export function slashQuery(draft: string): string | undefined {
  return /^\/(\S*)$/.exec(draft)?.[1];
}

/** Commands whose name contains `query`, names that start with it first, each group in alphabetical order. */
export function matchCommands(commands: readonly PiCommand[], query: string): PiCommand[] {
  const needle = query.toLowerCase();
  const rank = (command: PiCommand) => command.name.toLowerCase().startsWith(needle) ? 0 : 1;
  return commands.filter(command => command.name.toLowerCase().includes(needle)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

const SOURCES = new Set(['extension', 'prompt', 'skill']);

/** Reads a `get_commands` answer, keeping only well-formed entries. */
export function commandsFromResponse(data: unknown): PiCommand[] {
  const list = typeof data === 'object' && data !== null ? (data as { commands?: unknown; }).commands : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown): PiCommand[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { name, description, source } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !name || typeof source !== 'string' || !SOURCES.has(source)) return [];
    return [{ name, source: source as PiCommand['source'], ...(typeof description === 'string' && description ? { description } : {}) }];
  });
}
