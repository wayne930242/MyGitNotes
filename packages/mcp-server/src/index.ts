import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMCPServer } from './server.js';

export * from './server.js';
export * from './tools.js';
export * from './guards.js';

async function main() {
  // Determine repo root from command line arg or current working directory
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

  const server = createMCPServer(repoRoot);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // Log to stderr only so stdio protocol on stdout is not polluted
  console.error(`[github-notes-mcp] Stdio server running for root: ${repoRoot}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('[github-notes-mcp] Fatal error:', err); process.exit(1); });
}
export * from './remote-tools.js';
