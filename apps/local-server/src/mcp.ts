import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { GitHubSource, SourceConfig, sourceIdentity } from '@github-notes/core';
import { callRemoteTool, remoteTools, isMutationTool } from '@github-notes/mcp-server';
import { SessionStore } from './auth.js';

export function createRemoteMCP(base: string, source: SourceConfig | undefined): Router {
  const router = Router();
  router.post(['/', '/:token'], async (req, res) => {
    if (source?.type !== 'github') return res.status(503).json({ error: 'Configure a GitHub source for remote MCP.' });
    try {
      const urlToken = typeof req.params.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.params.token) ? req.params.token : undefined;
      const bearer = urlToken || req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const store = new SessionStore(base);
      const grant = bearer ? await store.get(bearer) : null;
      if (grant?.kind !== 'agent' || grant.source !== sourceIdentity(source) || grant.audience !== `${process.env.APP_URL}/mcp`) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="GitHub Notes MCP"');
        return res.status(401).json({ error: 'Create a GitHub Notes agent token after signing in.' });
      }
      const credential = grant.credential ? await store.get(grant.credential) : await store.get(grant.session);
      if (!credential || !['credential', 'session'].includes(credential.kind)) return res.status(401).json({ error: 'Agent authorization unavailable. Sign in and create a new grant.' });
      if (credential.upstreamExpiresAt && credential.upstreamExpiresAt <= Date.now()) return res.status(401).json({ error: 'GitHub authorization expired. Sign in again to reconnect existing agent grants.' });
      const reader = new GitHubSource(source.repository, source.branch, credential.token);
      const server = new Server({ name: 'github-notes', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: 'Operate on the configured note repository. Use ls or glob to locate paths, read or find to inspect complete files, then pass the returned revision to a write operation. Each successful mutation creates one atomic remote commit with a program-generated message. Respect read-only grants. Use Settings to revoke persistent connector URLs.' });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: remoteTools.filter(t => grant.write || !isMutationTool(t.name)) }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        try { const result = await callRemoteTool(reader, params.name, params.arguments || {}, grant.write); return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }; }
        catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }] }; }
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch { if (!res.headersSent) res.status(503).json({ error: 'MCP session service unavailable.' }); }
  });
  router.all(['/', '/:token'], (_req, res) => res.status(405).set('Allow', 'POST').end());
  return router;
}
