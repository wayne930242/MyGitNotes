import path from 'node:path';
import { isNotebookContent } from './folders.js';
import { parseNoteContent } from './frontmatter.js';
import { SourceError } from './github-api.js';
import type { RemoteEntry, RemoteSource } from './remote-source.js';
import { NotebookConfig } from './types.js';

type Args = Record<string, unknown>;
export interface SkillFile {
  /** Directory holding `.agents/skills`; empty for the repository root. */
  owner: string;
  name: string;
  directory: string;
}

const SKILL_PATH = /^(?:(.+)\/)?\.agents\/skills\/([^/]+)\/(.+)$/;
const instructionFile = (dir: string) => dir ? `${dir}/AGENTS.md` : 'AGENTS.md';
const regular = (entry: RemoteEntry) => entry.type === 'blob' && entry.mode !== '120000';

function insideNotebook(dir: string, notebooks: NotebookConfig[]) {
  return notebooks.some(nb => dir === nb.root || (dir.startsWith(nb.root + '/') && isNotebookContent(dir.slice(nb.root.length + 1), nb)));
}

/** The repository root, notebook roots and their ancestors, and folders inside notebooks may hold agent files. */
function agentDirectory(dir: string, notebooks: NotebookConfig[]) {
  if (!dir) return true;
  if (dir.split('/').some(p => !p || p.startsWith('.'))) return false;
  return notebooks.some(nb => nb.root.startsWith(dir + '/')) || insideNotebook(dir, notebooks);
}

/** A readable skill file in an allowed skill location, using the workspace Agent skill allowlist. */
export function skillFile(file: string, notebooks: NotebookConfig[]): SkillFile | undefined {
  /* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
  if (file.includes('\\') || /[\x00-\x1f\x7f]/.test(file)) return;
  /* eslint-enable no-control-regex */
  const match = file.match(SKILL_PATH);
  if (!match) return;
  const [, owner = '', name, rest] = match;
  if (name.startsWith('.') || rest.split('/').some(p => !p || p.startsWith('.'))) return;
  if (!/\.(md|markdown|txt)$/i.test(rest) && rest !== 'agents/openai.yaml') return;
  if (!agentDirectory(owner, notebooks)) return;
  return { owner, name, directory: path.posix.join(owner, '.agents/skills', name) };
}

/** A target directory and each ancestor up to the repository root, root first. */
function chain(dir: string) {
  const parts = dir ? dir.split('/') : [];
  return ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))];
}

/** A notebook root, or the folder of a note or folder path inside a notebook; a missing path names a file to create. */
function target(args: Args, notebooks: NotebookConfig[], entries: RemoteEntry[]): string | undefined {
  if (args.notebookId !== undefined && args.path !== undefined) throw new SourceError('Pass notebookId or path, not both.');
  if (args.notebookId !== undefined) {
    const notebook = notebooks.find(nb => nb.id === args.notebookId);
    if (!notebook) throw new SourceError(`Unknown notebook: ${String(args.notebookId)}`, 404);
    return notebook.root;
  }
  if (args.path === undefined) return;
  const file = args.path;
  if (typeof file !== 'string' || file.includes('\\') || file.includes('\0') || file.split('/').some(p => !p || p === '.' || p === '..')) throw new SourceError('Use a repository-relative path with no traversal segments.');
  const dir = entries.some(e => e.path === file && e.type === 'tree') ? file : path.posix.dirname(file);
  if (!insideNotebook(dir, notebooks)) throw new SourceError('Target a notebook, or a note or folder inside one.', 403);
  return dir;
}

/** Skill entry files; along a chain the nearest directory wins a shared name, and without one every skill is listed. */
function skillEntries(entries: RemoteEntry[], notebooks: NotebookConfig[], dirs?: string[]) {
  const found = entries.filter(regular).map(entry => ({ entry, skill: skillFile(entry.path, notebooks) })).filter((f): f is { entry: RemoteEntry; skill: SkillFile; } => Boolean(f.skill && f.entry.path === f.skill.directory + '/SKILL.md')).sort((a, b) => a.entry.path.localeCompare(b.entry.path));
  if (!dirs) return found;
  const chosen = new Map<string, (typeof found)[number]>();
  for (const dir of [...dirs].reverse()) for (const f of found) if (f.skill.owner === dir && !chosen.has(f.skill.name)) chosen.set(f.skill.name, f);
  return [...chosen.values()].sort((a, b) => a.skill.name.localeCompare(b.skill.name));
}

async function describe(reader: RemoteSource, found: { entry: RemoteEntry; skill: SkillFile; }[]) {
  await reader.prefetchFiles(found.map(f => f.entry.path));
  return Promise.all(found.map(async ({ entry, skill }) => {
    const { metadata, content } = parseNoteContent((await reader.readFile(entry.path)).toString('utf8'));
    return { name: skill.name, description: typeof metadata.description === 'string' ? metadata.description : '', path: entry.path, directory: skill.directory, content };
  }));
}

/** The system prompt and skills that govern a notebook or note, read from one pinned revision. */
export async function callAgentSystem(reader: RemoteSource, operation: string, args: Args): Promise<Record<string, unknown>> {
  const [config, snapshot] = await Promise.all([reader.config(), reader.getSnapshot()]);
  const notebooks = config.notebooks;
  const revision = snapshot.sha;
  const dir = target(args, notebooks, snapshot.entries);
  if (operation === 'get_system_prompt') {
    if (dir === undefined) throw new SourceError('Pass notebookId or path.');
    const paths = chain(dir).map(instructionFile).filter(file => snapshot.entries.some(e => e.path === file && regular(e)));
    await reader.prefetchFiles(paths);
    const files = await Promise.all(paths.map(async file => ({ path: file, content: (await reader.readFile(file)).toString('utf8') })));
    return { revision, target: dir, files, content: files.map(f => f.content.trimEnd()).join('\n\n') };
  }
  const found = skillEntries(snapshot.entries, notebooks, dir === undefined ? undefined : chain(dir));
  if (operation === 'list_skills') {
    const skills = await describe(reader, found);
    return { revision, target: dir ?? null, skills: skills.map(skill => ({ name: skill.name, description: skill.description, path: skill.path, directory: skill.directory })) };
  }
  if (operation === 'invoke_skill') {
    if (typeof args.name !== 'string' || !args.name) throw new SourceError('name is required.');
    const matches = found.filter(f => f.skill.name === args.name);
    if (!matches.length) throw new SourceError(`Skill not found: ${args.name}`, 404);
    if (matches.length > 1) throw new SourceError(`Skill ${args.name} exists in ${matches.map(f => f.skill.directory).join(', ')}. Pass notebookId or path.`, 409);
    const [skill] = await describe(reader, matches);
    const files = snapshot.entries.filter(e => regular(e) && e.path.startsWith(skill.directory + '/') && e.path !== skill.path && skillFile(e.path, notebooks)).map(e => e.path).sort();
    return { revision, ...skill, files };
  }
  throw new SourceError('Unknown agent system operation.');
}

/** Tells an agent that read a note to load that note's agent system before it creates or edits notes there. */
export async function agentSystemHint(reader: RemoteSource, file: string): Promise<string | undefined> {
  const [config, snapshot] = await Promise.all([reader.config(), reader.getSnapshot()]);
  const dirs = chain(path.posix.dirname(file).replace(/^\.$/, ''));
  const instructed = snapshot.entries.some(e => regular(e) && dirs.some(dir => e.path === instructionFile(dir)));
  if (!instructed && !skillEntries(snapshot.entries, config.notebooks, dirs).length) return;
  return `Before creating or editing notes here, read the agent system: call get_system_prompt and list_skills with path "${file}".`;
}
