import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { loadWorkspaceConfig, parseWorkspaceConfig, resolveWorkspaceConfigPath, serializeWorkspaceConfig, WORKSPACE_CONFIG_FILENAME } from '@mygitnotes/core';
import { getCurrentBranch, getGitStatus, stageAndCommit } from '@mygitnotes/git';

export function createLocalWorkspaceRouter(repoRoot: string): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const config = loadWorkspaceConfig(repoRoot);
      const branch = await getCurrentBranch(repoRoot);
      const gitStatus = await getGitStatus(repoRoot);
      res.json({ repoRoot, branch, config, gitStatus, isCoreBranch: branch === 'core', source: { type: 'local', identity: `local:${repoRoot}` }, capabilities: { write: branch === 'main', local: true } });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Update workspace config
  router.put('/config', async (req: Request, res: Response) => {
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

  return router;
}
