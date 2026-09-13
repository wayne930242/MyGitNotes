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
  scanNotebookNotes,
  scanNotebookFolders,
  classifyResource,
  resolveSafePath,
  sanitizeFilename,
  WORKSPACE_CONFIG_FILENAME,
  extractFirstH1,
  parseNoteContent,
  workspaceAgentKind, workspaceAgentResource, listWorkspaceAgentFiles, resolveWorkspaceAgentPath,
  type WorkspaceAgentResource,
} from '@github-notes/core';
import {
  getGitStatus,
  getCurrentBranch,
  stageAndCommit,
  getDiff,
  getRecentCommits,
  generateCommitMessage,
  updateCore,
  runGit,
} from '@github-notes/git';

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
      resolveSafePath(repoRoot, candidate);
      const resource = classifyResource(candidate, config);
      const agentAccess = (req.path.startsWith('/api/agent-resources') || req.path.startsWith('/api/git/')) && workspaceAgentKind(candidate);
      if (agentAccess) resolveWorkspaceAgentPath(repoRoot, candidate);
      if (!agentAccess && (!['note', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type) || !candidate.startsWith('notes/'))) return res.status(403).json({ error: 'Path is outside configured workspace resources.' });
    }
    next();
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  try {
    const config = loadWorkspaceConfig(repoRoot);
    const candidates = [req.body?.path, ...(Array.isArray(req.body?.files) ? req.body.files : [])].filter(p => p !== undefined);
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') throw new Error('Paths must be strings.');
      resolveSafePath(repoRoot, candidate);
      const resource = classifyResource(candidate, config);
      const agentAccess = (req.path.startsWith('/api/agent-resources') || req.path.startsWith('/api/git/')) && workspaceAgentKind(candidate);
      if (agentAccess) resolveWorkspaceAgentPath(repoRoot, candidate);
      if (!agentAccess && (!['note', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type) || !candidate.startsWith('notes/'))) return res.status(403).json({ error: 'Path is outside configured workspace resources.' });
    }
    next();
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
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
    let configRel = path.posix.join('notes', WORKSPACE_CONFIG_FILENAME);
    let configPath = path.join(repoRoot, configRel);
    if (!fs.existsSync(configPath) && fs.existsSync(path.join(repoRoot, WORKSPACE_CONFIG_FILENAME))) {
      configRel = WORKSPACE_CONFIG_FILENAME;
      configPath = path.join(repoRoot, WORKSPACE_CONFIG_FILENAME);
    }
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

    // Restore from Git HEAD
    await runGit(['checkout', 'HEAD', '--', notePath], repoRoot);
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

  const base = path.basename(relPath, '.md');
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
    await runGit(['checkout', 'HEAD', '--', relPath], repoRoot);
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
    const diff = await getDiff(repoRoot, filePath);
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
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets')) {
      return next();
    }
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

return app;
}
