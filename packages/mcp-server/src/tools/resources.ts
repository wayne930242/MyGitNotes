import path from 'node:path';
import fs from 'node:fs';
import { isProductAgentDoc, listProductAgentDocs, readProductAgentDoc, resolveWorkspaceAgentPath } from '@mygitnotes/core';
import type { ToolContext } from './context.js';

export async function handleListAgentResources(ctx: ToolContext) {
  const instructions = fs.existsSync(path.join(ctx.repoRoot, 'AGENTS.md')) ? ['AGENTS.md'] : [];
  const docs = listProductAgentDocs(ctx.productRoot ?? ctx.repoRoot);
  return { instructions, docs };
}

export async function handleReadAgentResource(
  ctx: ToolContext,
  args?: { path?: string }
) {
  if (!args?.path) {
    return handleListAgentResources(ctx);
  }
  if (isProductAgentDoc(args.path)) {
    const productRoot = ctx.productRoot ?? ctx.repoRoot;
    if (!fs.existsSync(path.join(productRoot, args.path))) return { error: `Resource not found: ${args.path}` };
    return { path: args.path, content: readProductAgentDoc(productRoot, args.path) };
  }
  // Only workspace Agent documents are readable here, never arbitrary repository files.
  const safe = resolveWorkspaceAgentPath(ctx.repoRoot, args.path);
  if (!fs.existsSync(safe)) {
    return { error: `Resource not found: ${args.path}` };
  }
  const content = fs.readFileSync(safe, 'utf-8');
  return { path: args.path, content };
}
