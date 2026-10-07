import { agentInstructionFile, skillFile } from './agent-system.js';
import { isNotebookContent } from './folders.js';
import { isNoteFile } from './note-file.js';
import { isVersionFile } from './note-versions.js';
import type { NotebookConfig } from './types.js';
import { workspaceAgentKind } from './workspace-agent.js';
import { workspaceDocument } from './workspace-documents.js';

/**
 * Whether a file has a history and versions in the app: a note, outline or compilation inside a notebook, or an
 * agent file (an `AGENTS.md` the system prompt reads, a skill file, or a workspace Agent document).
 */
export function historyFile(file: string, notebooks: readonly NotebookConfig[]): boolean {
  /* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
  if (typeof file !== 'string' || !file || file.length > 1024 || file.includes('\\') || /[\x00-\x1f\x7f]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..')) return false;
  /* eslint-enable no-control-regex */
  if (isVersionFile(file) || workspaceDocument(file)) return false;
  if (workspaceAgentKind(file) || agentInstructionFile(file, [...notebooks]) || skillFile(file, [...notebooks])) return true;
  const notebook = notebooks.find(nb => file.startsWith(`${nb.root}/`));
  return Boolean(notebook && isNotebookContent(file.slice(notebook.root.length + 1), notebook) && isNoteFile(file));
}
