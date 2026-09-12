import path from 'node:path';
import fs from 'node:fs';
import { assertSafeRepoPath } from '../guards.js';
import type { ToolContext } from './context.js';

export async function handleListAgentResources(ctx: ToolContext) {
  const instructions: string[] = [];
  const docs: string[] = [];

  // Check root AGENTS.md
  if (fs.existsSync(path.join(ctx.repoRoot, 'AGENTS.md'))) {
    instructions.push('AGENTS.md');
  }

  // Check docs/agent/
  const agentDocsDir = path.join(ctx.repoRoot, 'docs/agent');
  if (fs.existsSync(agentDocsDir)) {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          docs.push(path.relative(ctx.repoRoot, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(agentDocsDir);
  }

  return { instructions, docs };
}

export async function handleReadAgentResource(
  ctx: ToolContext,
  args: { path: string }
) {
  const safe = assertSafeRepoPath(ctx.repoRoot, args.path);
  if (!fs.existsSync(safe)) {
    return { error: `Resource not found: ${args.path}` };
  }
  const content = fs.readFileSync(safe, 'utf-8');
  return { path: args.path, content };
}
