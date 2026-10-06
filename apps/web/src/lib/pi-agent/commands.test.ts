import { describe, expect, it } from 'vitest';
import { commandsFromResponse, commandWithFocus, matchCommands, parseComposerInput, type PiCommand, slashQuery } from './commands.js';
import { splitUserMessage, withFocus } from './transcript.js';

describe('parseComposerInput', () => {
  it('reads ! and !! as shell commands, the latter kept out of the context', () => {
    expect(parseComposerInput('!ls -la')).toEqual({ kind: 'shell', command: 'ls -la', excludeFromContext: false });
    expect(parseComposerInput('  !! git status ')).toEqual({ kind: 'shell', command: 'git status', excludeFromContext: true });
    expect(parseComposerInput('!')).toEqual({ kind: 'message', text: '!' });
    expect(parseComposerInput('!!')).toEqual({ kind: 'message', text: '!!' });
    expect(parseComposerInput('!!!x')).toEqual({ kind: 'message', text: '!!!x' });
  });

  it('runs /compact, /name and /new itself, and leaves every other command to Pi', () => {
    expect(parseComposerInput('/compact keep the API notes')).toEqual({ kind: 'builtin', name: 'compact', args: 'keep the API notes' });
    expect(parseComposerInput('/name  Plan review ')).toEqual({ kind: 'builtin', name: 'name', args: 'Plan review' });
    expect(parseComposerInput('/new')).toEqual({ kind: 'builtin', name: 'new', args: '' });
    expect(parseComposerInput('/newsletter draft')).toEqual({ kind: 'command', text: '/newsletter draft' });
    expect(parseComposerInput('/skill:review this')).toEqual({ kind: 'command', text: '/skill:review this' });
    expect(parseComposerInput('Hello /there')).toEqual({ kind: 'message', text: 'Hello /there' });
  });
});

describe('commandWithFocus', () => {
  const focus = { file: 'notes/plan.md', line: 4, column: 1 };

  it("keeps the command first, putting the editor context in a skill's arguments and nowhere else", () => {
    expect(commandWithFocus('/reload', focus)).toBe('/reload');
    expect(commandWithFocus('/template a b', focus)).toBe('/template a b');
    expect(commandWithFocus('/skill:review tighten this', focus)).toBe(`/skill:review ${withFocus('tighten this', focus)}`);
    expect(commandWithFocus('/skill:review', focus)).toBe(`/skill:review ${withFocus('', focus)}`);
    expect(commandWithFocus('/skill:review now', undefined)).toBe('/skill:review now');
  });

  it('reads back as the skill, the file and the arguments once Pi expands the skill', () => {
    const sent = commandWithFocus('/skill:review tighten this', focus);
    // Pi replaces `/skill:name` with the skill block and appends the trimmed arguments after a blank line.
    const expanded = `<skill name="review" location="/home/me/.pi/skills/review/SKILL.md">\nReferences are relative to /home/me/.pi/skills/review.\n\nBody\n</skill>\n\n${sent.slice('/skill:review '.length).trim()}`;
    expect(splitUserMessage(expanded)).toEqual({ skill: 'review', text: 'tighten this', focus });
  });
});

describe('the command menu', () => {
  const commands: PiCommand[] = [{ name: 'skill:review', source: 'skill' }, { name: 'reload', source: 'extension' }, { name: 'preview', source: 'prompt' }];

  it('opens only while a command name is being typed', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/rev')).toBe('rev');
    expect(slashQuery('/reload now')).toBeUndefined();
    expect(slashQuery('text')).toBeUndefined();
  });

  it('matches anywhere in the name, ranking names that start with the query first', () => {
    expect(matchCommands(commands, 'rev').map(command => command.name)).toEqual(['preview', 'skill:review']);
    expect(matchCommands(commands, 'RE').map(command => command.name)).toEqual(['reload', 'preview', 'skill:review']);
    expect(matchCommands(commands, '').map(command => command.name)).toEqual(['preview', 'reload', 'skill:review']);
  });

  it("reads Pi's command list, dropping malformed entries", () => {
    expect(commandsFromResponse({ commands: [{ name: 'reload', source: 'extension', description: 'Reload' }, { name: 'skill:x', source: 'skill', description: '' }, { name: 'bad', source: 'tui' }, { source: 'skill' }, null] })).toEqual([{ name: 'reload', source: 'extension', description: 'Reload' }, { name: 'skill:x', source: 'skill' }]);
    expect(commandsFromResponse(undefined)).toEqual([]);
  });
});
