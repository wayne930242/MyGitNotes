import { STUDY_FILE, STUDY_MAX_BYTES, managedNotebook } from '@mygitnotes/core';
import express, { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {
  loadWorkspaceConfig,
  scanAssets, assetInfo, assetHash, assetRoot, assetPath, isAssetPath, decodeAsset,
  parseWorkspaceConfig,
  serializeWorkspaceConfig,
  readNoteFile,
  writeNoteFile,
  deleteNoteFile,
  replaceNoteTags,
  scanNotebookNotes,
  scanNotebookFolders,
  classifyResource,
  resolveSafePath,
  sanitizeFilename,
  WORKSPACE_CONFIG_FILENAME,
  resolveWorkspaceConfigPath,
  extractFirstH1,
  parseNoteContent,
  workspaceAgentKind, workspaceAgentResource, listWorkspaceAgentFiles, resolveWorkspaceAgentPath,
  type WorkspaceAgentResource,
  loadNoteTemplate,
  renderNoteTemplate,
  formatTemplateDate,
} from '@mygitnotes/core';
import {
  getGitStatus,
  getCurrentBranch,
  stageAndCommit,
  getDiff,
  getRecentCommits,
  generateCommitMessage,
  updateCore,
  listChanges, changeFile, fileDiff, commitStagedFiles, commitSelectedFiles,
  syncWorkspace, SyncError,
} from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';

import { SCREEN_PAGE_FILE } from '@mygitnotes/core';

function validateWorkspacePath(
  repoRoot: string,
  reqPath: string,
  candidate: unknown,
  config: ReturnType<typeof loadWorkspaceConfig>
): void {
  if (typeof candidate !== 'string') throw new Error('Paths must be strings.');
  resolveSafePath(repoRoot, candidate);
  const resource = classifyResource(candidate, config);
  const agentAccess = (reqPath.startsWith('/api/agent-resources') || reqPath.startsWith('/api/git/')) && workspaceAgentKind(candidate);
  const screenAccess = reqPath.startsWith('/api/git/') && (candidate === SCREEN_PAGE_FILE || candidate === STUDY_FILE || resource.type === 'workspace_config');
  const fileAccess = reqPath.startsWith('/api/git/') && config && managedNotebook(candidate, config.notebooks);
  if (agentAccess) resolveWorkspaceAgentPath(repoRoot, candidate);
  if (!agentAccess && !screenAccess && !fileAccess && (!['note', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type) || !resource.notebookId)) {
    const err = new Error('Path is outside configured workspace resources.') as Error & { status?: number };
    err.status = 403;
    throw err;
  }
}

function handlePathValidationError(res: express.Response, error: unknown): void {
  const status = (error as { status?: number }).status || 400;
  res.status(status).json({ error: (error as Error).message });
}

export function createLocalApp(repoRoot: string): express.Express {
const app = express();
app.use(async (req, res, next) => {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (await getCurrentBranch(repoRoot) !== 'main') return res.status(403).json({ error: 'Switch to the main workspace branch to edit notes.' });
    }
    const config = loadWorkspaceConfig(repoRoot);
    const candidate = req.query.path;
    if (typeof candidate === 'string') {
      validateWorkspacePath(repoRoot, req.path, candidate, config);
    }
    next();
  } catch (error) { handlePathValidationError(res, error); }
});
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  try {
    const config = loadWorkspaceConfig(repoRoot);
    const candidates = [req.body?.path, ...(Array.isArray(req.body?.files) ? req.body.files : [])].filter(p => p !== undefined);
    for (const candidate of candidates) {
      validateWorkspacePath(repoRoot, req.path, candidate, config);
    }
    next();
  } catch (error) { handlePathValidationError(res, error); }
});

app.get('/raw-assets/by-hash/:hash', (req, res) => {
  try {
    if (!/^[a-f0-9]{40}$/.test(req.params.hash)) return res.status(400).json({ error: 'Invalid asset hash.' });
    const config = loadWorkspaceConfig(repoRoot);
    const asset = config?.notebooks.flatMap(nb => scanAssets(repoRoot, nb)).find(a => a.hash === req.params.hash);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.sendFile(resolveSafePath(repoRoot, asset.path));
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});

// Static asset handler for notes assets
app.use('/raw-assets', (req, res, next) => {
  try {
    const relPath = decodeURIComponent(req.path.replace(/^\//, ''));
    const config = loadWorkspaceConfig(repoRoot);
    if (!config || classifyResource(relPath, config).type !== 'asset') return res.status(403).send('Path is not a workspace asset');
    const safePath = resolveSafePath(repoRoot, relPath);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (fs.existsSync(safePath)) {
      res.sendFile(safePath);
    } else {
      res.status(404).send('Asset not found');
    }
  } catch (err: unknown) {
    res.status(400).send(err instanceof Error ? err.message : 'Invalid asset path');
  }
});

// 1. Workspace Configuration & Status
app.get('/api/workspace', async (req: Request, res: Response) => {
  try {
    const config = loadWorkspaceConfig(repoRoot);
    const branch = await getCurrentBranch(repoRoot);
    const gitStatus = await getGitStatus(repoRoot);
    res.json({
      repoRoot,
      branch,
      config,
      gitStatus,
      isCoreBranch: branch === 'core',
      source: { type: 'local', identity: `local:${repoRoot}` },
      capabilities: { write: branch === 'main', local: true },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update workspace config
app.put('/api/workspace/config', async (req: Request, res: Response) => {
  try {
    const { configYaml } = req.body;
    const validated = parseWorkspaceConfig(configYaml);
    const configRel = resolveWorkspaceConfigPath(repoRoot) ?? path.posix.join('notes', WORKSPACE_CONFIG_FILENAME);
    const configPath = path.join(repoRoot, configRel);
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, serializeWorkspaceConfig(validated), 'utf-8');

    await stageAndCommit(repoRoot, [configRel], 'chore(workspace): update configuration');
    res.json({ success: true, config: validated });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 2. Notes API
app.get('/api/notes', (req: Request, res: Response) => {
  try {
    const config = loadWorkspaceConfig(repoRoot);
    if (!config) {
      return res.json({ notes: [] });
    }

    const notebookId = req.query.notebookId as string | undefined;
    const notebooks = notebookId
      ? config.notebooks.filter((nb) => nb.id === notebookId)
      : config.notebooks;

    const allNotes = [];
    for (const nb of notebooks) {
      allNotes.push(...scanNotebookNotes(repoRoot, nb));
    }

    res.json({ notes: allNotes });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/folders', (req, res) => {
  try { const config = loadWorkspaceConfig(repoRoot); res.json({ folders: config?.notebooks.flatMap(nb => scanNotebookFolders(repoRoot, nb)) || [] }); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); }
});

app.get('/api/templates/render', (req: Request, res: Response) => {
  try {
    const notebookId = req.query.notebookId as string;
    const templateId = req.query.templateId as string;
    const title = (req.query.title as string) || '';
    const config = loadWorkspaceConfig(repoRoot);
    const notebook = config?.notebooks.find((nb) => nb.id === notebookId);
    if (!notebook) return res.status(404).json({ error: `Notebook not found: ${notebookId}` });
    const template = loadNoteTemplate(repoRoot, notebook, templateId);
    const rendered = renderNoteTemplate(template, { title, date: formatTemplateDate() });
    res.json(rendered);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Read single note
app.get('/api/notes/read', (req: Request, res: Response) => {
  try {
    const relPath = req.query.path as string;
    const notebookId = (req.query.notebookId as string) || 'default';
    if (!relPath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const note = readNoteFile(repoRoot, relPath, notebookId);
    res.json({ note });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Save note & create commit
app.post('/api/notes', async (req: Request, res: Response) => {
  try {
    const { path: notePath, content, metadata, commitMessage, notebookId } = req.body;
    if (!notePath || typeof content !== 'string') {
      return res.status(400).json({ error: 'path and content are required' });
    }

    if (req.body.createOnly && fs.existsSync(resolveSafePath(repoRoot, notePath))) return res.status(409).json({ error: 'A note already exists at this path.' });
    const saved = writeNoteFile(repoRoot, notePath, content, metadata, notebookId);

    // If noCommit is requested or commit is false, write file and leave working tree dirty
    if (req.body.noCommit === true || req.body.commit === false) {
      return res.json({ success: true, note: saved, committed: false });
    }

    // Commit change
    let message = commitMessage;
    if (!message) {
      message = await generateCommitMessage({
        filePath: notePath,
        diff: content,
      });
    }

    const commit = await stageAndCommit(repoRoot, [notePath], message);
    res.json({ success: true, note: saved, commit, committed: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete note & create commit (or leave uncommitted if noCommit is true)
app.delete('/api/notes', async (req: Request, res: Response) => {
  try {
    const notePath = req.query.path as string;
    const noCommit = req.query.noCommit === 'true' || req.body?.noCommit === true;
    if (!notePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    deleteNoteFile(repoRoot, notePath);
    if (noCommit) {
      return res.json({ success: true, committed: false });
    }

    const commit = await stageAndCommit(
      repoRoot,
      [notePath],
      `docs(notes): delete ${path.basename(notePath)}`
    );
    res.json({ success: true, commit, committed: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Restore note before commit
app.post('/api/notes/restore', async (req: Request, res: Response) => {
  try {
    const { path: notePath, content, metadata, notebookId } = req.body;
    if (!notePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    if (typeof content === 'string') {
      const restored = writeNoteFile(repoRoot, notePath, content, metadata, notebookId);
      return res.json({ success: true, note: restored });
    }

    const change = (await listChanges(repoRoot)).find(file => file.path === notePath);
    if (!change) return res.status(409).json({ error: 'This note has no changes to restore.' });
    const restored = await changeFile(repoRoot, notePath, 'restore', req.body.revision || change.revision);
    if (!change.tracked) return res.json({ success: true, note: null, ...restored });
    let resolvedNb = notebookId;
    if (!resolvedNb) {
      try {
        const config = loadWorkspaceConfig(repoRoot);
        if (config) {
          const matched = config.notebooks.find((nb) => {
            const rootRel = nb.root.replace(/\\/g, '/');
            return notePath === rootRel || notePath.startsWith(`${rootRel}/`);
          });
          if (matched) resolvedNb = matched.id;
        }
      } catch {}
    }
    const restoredNote = readNoteFile(repoRoot, notePath, resolvedNb || 'default');
    res.json({ success: true, note: restoredNote });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Apply an explicit tags array to each of the given notes and create one commit for the
// whole batch. Used for tag rename/merge/delete and for undoing any of them (the caller
// computes the target `tags` per note; this endpoint only writes and commits).
app.post('/api/tags/apply', async (req: Request, res: Response) => {
  try {
    const entries = req.body?.entries;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500) {
      return res.status(400).json({ error: 'entries must be an array of 1 to 500 items.' });
    }
    for (const entry of entries) {
      if (typeof entry?.path !== 'string' || !Array.isArray(entry.tags) || entry.tags.some((tag: unknown) => typeof tag !== 'string')) {
        return res.status(400).json({ error: 'Each entry requires a path and a tags array of strings.' });
      }
    }
    const config = loadWorkspaceConfig(repoRoot);
    if (!config) return res.status(400).json({ error: 'Workspace not configured.' });

    const result = await serializeWorkspaceMutation(repoRoot, async () => {
      // Validate and compute every entry's patched content before writing any of them, so a
      // later entry failing validation cannot leave an earlier one written but uncommitted.
      const planned: { path: string; safePath: string; patched: string }[] = [];
      for (const entry of entries) {
        let safePath: string;
        try {
          safePath = resolveSafePath(repoRoot, entry.path);
          if (classifyResource(entry.path, config).type !== 'note' || !fs.existsSync(safePath)) throw new Error('not a note');
        } catch {
          throw Object.assign(new Error(`Not a configured note: ${entry.path}`), { status: 403 });
        }
        const raw = fs.readFileSync(safePath, 'utf-8');
        const patched = replaceNoteTags(raw, entry.tags);
        if (patched === raw) continue;
        planned.push({ path: entry.path, safePath, patched });
      }
      if (planned.length === 0) return { success: true, changedPaths: [] as string[] };
      for (const entry of planned) fs.writeFileSync(entry.safePath, entry.patched, 'utf-8');
      const changedPaths = planned.map(entry => entry.path);
      const message = typeof req.body.message === 'string' && req.body.message.trim()
        ? req.body.message.trim()
        : `docs(notes): update tags in ${changedPaths.length} note${changedPaths.length === 1 ? '' : 's'}`;
      const commit = await stageAndCommit(repoRoot, changedPaths, message);
      return { success: true, changedPaths, commit };
    });
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Helper to extract first heading, skill name, or clean folder title
function extractResourceTitle(fullPath: string, relPath: string): string {
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const { metadata } = parseNoteContent(raw);
    if (typeof metadata.name === 'string' && metadata.name.trim()) {
      return metadata.name.trim();
    }
    if (typeof metadata.title === 'string' && metadata.title.trim()) {
      return metadata.title.trim();
    }
    const h1 = extractFirstH1(raw);
    if (h1) return h1;
  } catch {}

  const base = path.basename(relPath).replace(/\.(md|markdown|mdx|txt)$/i, '');
  if (base.toLowerCase() === 'index' || base.toLowerCase() === 'skill') {
    const dir = path.basename(path.dirname(relPath));
    return dir.charAt(0).toUpperCase() + dir.slice(1).replace(/-/g, ' ');
  }
  return base.charAt(0).toUpperCase() + base.slice(1).replace(/-/g, ' ');
}

// 3. Agent Resources (Instructions, Skills & Docs)
app.get('/api/agent-resources', async (req: Request, res: Response) => {
  try {
    const branch = await getCurrentBranch(repoRoot);
    const instructions: WorkspaceAgentResource[] = [];
    const skills: WorkspaceAgentResource[] = [];
    const docs: WorkspaceAgentResource[] = [];
    const groups = { instructions, skills, docs };
    for (const file of listWorkspaceAgentFiles(repoRoot)) {
      const resource = workspaceAgentResource(file, branch === 'main');
      if (!/^notes\/[^/]+\/AGENTS\.md$/.test(file)) {
        resource.name = extractResourceTitle(resolveWorkspaceAgentPath(repoRoot, file), file) || resource.name;
      }
      groups[workspaceAgentKind(file)!].push(resource);
    }

    res.json({ instructions, skills, docs });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/agent-resources/read', (req: Request, res: Response) => {
  try {
    const targetPath = req.query.path as string;
    if (!targetPath) return res.status(400).json({ error: 'path query required' });
    const safePath = resolveWorkspaceAgentPath(repoRoot, targetPath);
    const content = fs.readFileSync(safePath, 'utf-8');
    res.json({ path: targetPath, content });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Save agent resource file (workspace Agent documents)
app.post('/api/agent-resources/save', async (req: Request, res: Response) => {
  try {
    const { path: relPath, content } = req.body;
    if (!relPath || typeof content !== 'string') {
      return res.status(400).json({ error: 'path and content are required' });
    }
    const safePath = resolveWorkspaceAgentPath(repoRoot, relPath);
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf-8');
    res.json({ success: true, path: relPath });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Restore agent resource from Git HEAD (workspace Agent documents)
app.post('/api/agent-resources/restore', async (req: Request, res: Response) => {
  try {
    const { path: relPath } = req.body;
    if (!relPath) {
      return res.status(400).json({ error: 'path is required' });
    }
    const safePath = resolveWorkspaceAgentPath(repoRoot, relPath);
    const change = (await listChanges(repoRoot)).find(file => file.path === relPath);
    if (!change?.tracked || !change.available) return res.status(409).json({ error: 'This file has no committed version to restore.' });
    await changeFile(repoRoot, relPath, 'restore', req.body.revision || change.revision);
    const content = fs.readFileSync(safePath, 'utf-8');
    res.json({ success: true, path: relPath, content });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4. Assets API
app.get('/api/assets', (req: Request, res: Response) => {
  try {
    const config = loadWorkspaceConfig(repoRoot);
    if (!config) return res.json({ assets: [] });

    const notebookId = req.query.notebookId as string;
    const nb = config.notebooks.find((n) => n.id === notebookId) || config.notebooks[0];
    if (!nb) return res.json({ assets: [] });

    const assets = scanAssets(repoRoot, nb);

    res.json({ notebookId: nb.id, assets });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/assets', async (req: Request, res: Response) => {
  try {
    const { notebookId, filename, base64Content, directory = '' } = req.body;
    if (!notebookId || !filename || !base64Content) {
      return res.status(400).json({ error: 'notebookId, filename, base64Content required' });
    }

    const config = loadWorkspaceConfig(repoRoot);
    if (!config) return res.status(400).json({ error: 'Workspace not configured' });

    const nb = config.notebooks.find((n) => n.id === notebookId);
    if (!nb) return res.status(404).json({ error: `Notebook ${notebookId} not found` });

    const relPath = assetPath(nb, directory, filename);
    const safeFilename = path.posix.basename(relPath);
    const targetPath = resolveSafePath(repoRoot, relPath);
    const buffer = decodeAsset(base64Content);
    if (fs.existsSync(targetPath)) return res.status(409).json({ error: 'An asset already exists at this path.' });
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buffer, { flag: 'wx' });

    const commit = await stageAndCommit(
      repoRoot,
      [relPath],
      `chore(assets): add asset ${safeFilename}`
    );

    res.json({
      success: true,
      filename: safeFilename,
      ...assetInfo(relPath, assetRoot(nb), assetHash(buffer), buffer.length),
      commit,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch('/api/assets', async (req, res) => {
  try {
    const config = loadWorkspaceConfig(repoRoot);
    const { path: file, directory = '', filename } = req.body;
    const nb = config?.notebooks.find(nb => typeof file === 'string' && isAssetPath(file, nb));
    if (!nb) return res.status(403).json({ error: 'Path is not a workspace asset.' });
    const destination = assetPath(nb, directory, filename || path.posix.basename(file));
    const from = resolveSafePath(repoRoot, file); const to = resolveSafePath(repoRoot, destination);
    if (!fs.existsSync(from)) return res.status(404).json({ error: 'Asset not found.' });
    if (fs.existsSync(to)) return res.status(409).json({ error: 'Destination already exists.' });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.lstatSync(from).isFile() || fs.lstatSync(from).isSymbolicLink()) return res.status(403).json({ error: 'Source must be a regular asset file.' });
    fs.linkSync(from, to);
    try { fs.unlinkSync(from); } catch (error) { fs.unlinkSync(to); throw error; }
    const commit = await stageAndCommit(repoRoot, [file, destination], `chore(assets): move ${path.posix.basename(file)}`);
    res.json({ success: true, path: destination, commit });
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});

// Delete asset file
app.delete('/api/assets', async (req: Request, res: Response) => {
  try {
    const assetPath = req.query.path as string;
    const noCommit = req.query.noCommit === 'true' || req.body?.noCommit === true;
    if (!assetPath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const config = loadWorkspaceConfig(repoRoot);
    if (!config?.notebooks.some(nb => isAssetPath(assetPath, nb))) return res.status(403).json({ error: 'Path is not a workspace asset.' });
    const safePath = resolveSafePath(repoRoot, assetPath);
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }
    if (noCommit) {
      return res.json({ success: true, committed: false });
    }
    const commit = await stageAndCommit(
      repoRoot,
      [assetPath],
      `chore(assets): delete ${path.basename(assetPath)}`
    );
    res.json({ success: true, commit, committed: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 5. Git Status & Commits
const canManageChange = (file: string) => {
  try {
    const target = resolveSafePath(repoRoot, file);
    if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) return false;
    if (workspaceAgentKind(file)) { resolveWorkspaceAgentPath(repoRoot, file); return true; }
    const config = loadWorkspaceConfig(repoRoot);
    const resource = classifyResource(file, config);
    return Boolean(config && managedNotebook(file, config.notebooks)) || file === STUDY_FILE || file === SCREEN_PAGE_FILE || resource.type === 'workspace_config' || file.startsWith('notes/') && ['note', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type);
  } catch { return false; }
};
app.get('/api/git/changes', async (_req, res) => {
  try { res.json({ changes: (await listChanges(repoRoot)).map(file => ({ ...file, available: file.available && canManageChange(file.path),
    unavailableReason: file.kind === 'conflict' ? 'conflict' : !canManageChange(file.path) ? 'protected' : !file.available ? 'unsupported' : undefined })) }); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
app.get('/api/git/file-diff', async (req, res) => {
  try {
    const file = String(req.query.path || '');
    if (!canManageChange(file)) return res.status(403).json({ error: 'This file is outside workspace resources.' });
    res.json({ diff: await fileDiff(repoRoot, file, req.query.side === 'staged' ? 'staged' : req.query.side === 'current' ? 'current' : 'working') });
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
app.post('/api/git/change', async (req, res) => {
  try {
    const { path: file, action, revision } = req.body;
    if (!['stage', 'unstage', 'restore'].includes(action) || typeof revision !== 'string') return res.status(400).json({ error: 'An action and reviewed revision are required.' });
    if (!canManageChange(file)) return res.status(403).json({ error: 'This file is outside workspace resources.' });
    res.json({ success: true, ...await changeFile(repoRoot, file, action, revision) });
  } catch (error) { res.status(409).json({ error: (error as Error).message }); }
});
app.post('/api/git/commit-staged', async (req, res) => {
  try {
    const { files, revisions, message, selected } = req.body;
    if (!Array.isArray(files) || !files.length || files.some(file => !canManageChange(file)) || typeof message !== 'string') return res.status(400).json({ error: 'Select writable workspace files and provide a message.' });
    const commit = await (selected === true ? commitSelectedFiles : commitStagedFiles)(repoRoot, files.map(file => ({ path: file, revision: revisions?.[file] })), message);
    res.json({ success: true, commit });
  } catch (error) { res.status(409).json({ error: (error as Error).message }); }
});
app.get('/api/git/status', async (req: Request, res: Response) => {
  try {
    const status = await getGitStatus(repoRoot);
    const commits = await getRecentCommits(repoRoot, 10);
    res.json({ status, commits });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/git/diff', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string | undefined;
    let diff = await getDiff(repoRoot, filePath);
    // The new Screen YAML has no Git diff until tracked; still make it reviewable.
    if ((!filePath || filePath === SCREEN_PAGE_FILE) && (await getGitStatus(repoRoot)).untracked.includes(SCREEN_PAGE_FILE)) {
      const file = resolveSafePath(repoRoot, SCREEN_PAGE_FILE);
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 512 * 1024) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        diff += `\n--- /dev/null\n+++ ${SCREEN_PAGE_FILE}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}`;
      }
    }
    if ((!filePath || filePath === STUDY_FILE) && (await getGitStatus(repoRoot)).untracked.includes(STUDY_FILE)) {
      const file = resolveSafePath(repoRoot, STUDY_FILE);
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= STUDY_MAX_BYTES) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        diff += `\n--- /dev/null\n+++ ${STUDY_FILE}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}`;
      }
    }
    res.json({ diff });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/git/semantic-commit', async (req: Request, res: Response) => {
  try {
    const { diff, filePath } = req.body;
    const message = await generateCommitMessage({ diff, filePath });
    res.json({ message });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/git/commit', async (req: Request, res: Response) => {
  try {
    const { files, message } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0 || !message) {
      return res.status(400).json({ error: 'files (array) and message (string) required' });
    }
    const result = await stageAndCommit(repoRoot, files, message);
    res.json({ success: true, commit: result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/git/sync', async (req, res) => {
  const strategy = req.body?.strategy;
  if (strategy !== undefined && strategy !== 'remote' && strategy !== 'local') return res.status(400).json({ error: 'Unknown sync strategy.' });
  try {
    res.json({ result: await serializeWorkspaceMutation(repoRoot, () => syncWorkspace(repoRoot, strategy)) });
  } catch (error) {
    if (!(error instanceof SyncError)) return res.status(500).json({ error: (error as Error).message });
    res.status(error.code === 'INVALID_BRANCH' ? 403 : error.code === 'FAILED' ? 502 : 409).json({ error: error.message, code: error.code, files: error.files });
  }
});

// 6. Core Update Endpoint
app.post('/api/core/update', async (req: Request, res: Response) => {
  try {
    const { autoPush } = req.body || {};
    const result = await updateCore({ repoRoot, autoPush: Boolean(autoPush) });
    res.json({ result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 7. Static Web UI Serving
const webDist = path.join(repoRoot, 'apps/web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { redirect: false }));
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets') || req.path.startsWith('/r2-assets')) {
      return next();
    }
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

return app;
}
