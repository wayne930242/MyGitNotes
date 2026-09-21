import { buildInfo } from './build-info.js';
import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRemoteSource, type RemoteCache, SourceConfig, SourceError, sourceIdentity } from '@mygitnotes/core';
import { callRemoteTool, isMutationTool, remoteTools } from '@mygitnotes/mcp-server';
import { CredentialRejected, credentialToken, SessionStore } from './auth.js';

export function createRemoteMCP(base: string, source: SourceConfig | undefined, cache?: RemoteCache): Router {
  const router = Router();
  router.post(['/', '/:token'], async (req, res) => {
    if (!source || source.type === 'local') return res.status(503).json({ error: 'Configure a GitHub or GitLab source for remote MCP.' });
    try {
      const urlToken = typeof req.params.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.params.token) ? req.params.token : undefined;
      const bearer = urlToken || req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const store = new SessionStore(base);
      const grant = bearer ? await store.get(bearer) : null;
      // Rejections of an existing grant outlive the runtime logs so its owner can read the reason on the grant list.
      const remember = (reason: string) => store.recordRejection(bearer!, reason).catch(error => console.warn(`[mcp] rejection record failed: ${(error as Error).message}`));
      if (grant?.kind !== 'agent' || grant.source !== sourceIdentity(source) || grant.audience !== `${process.env.APP_URL}/mcp`) {
        const reason = !bearer ? 'no-token' : !grant ? 'grant-missing' : grant.kind !== 'agent' ? 'grant-kind' : grant.source !== sourceIdentity(source) ? 'grant-source' : 'grant-audience';
        console.warn(`[mcp] unauthorized: ${reason}`);
        if (grant?.kind === 'agent') await remember(reason);
        res.setHeader('WWW-Authenticate', 'Bearer realm="MyGitNotes MCP"');
        return res.status(401).json({ error: 'Create a MyGitNotes agent token after signing in.' });
      }
      let token: string;
      try {
        token = await credentialToken(base, grant.credential || grant.session);
      } catch (error) {
        if (!(error instanceof SourceError)) console.warn(`[mcp] credential lookup failed: ${(error as Error).message}`);
        await remember(error instanceof CredentialRejected ? error.reason : 'credential-unavailable');
        return res.status(error instanceof SourceError ? error.status : 503).json({ error: error instanceof SourceError ? error.message : 'Agent authorization service unavailable. Retry later.' });
      }
      const reader = createRemoteSource(source, token, fetch, cache);
      const server = new Server({ name: 'mygitnotes', version: buildInfo.version }, { capabilities: { tools: {} }, instructions: 'Operate on the configured note repository. Use ls or glob to locate paths, read or find to inspect complete files, then pass the returned revision to a write operation. Before creating or editing notes, read the agent system of the notebook or note with get_system_prompt and list_skills; invoke_skill loads a skill, and read, write, append, edit and rm also work on skill files. Each successful mutation creates one atomic remote commit with a program-generated message. Respect read-only grants. Use Settings to revoke persistent connector URLs.' });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: remoteTools.filter(t => grant.write || !isMutationTool(t.name)) }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        try {
          const result = await callRemoteTool(reader, params.name, params.arguments || {}, grant.write, process.env.APP_URL);
          return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }] };
        }
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.warn(`[mcp] session service unavailable: ${(error as Error).message}`);
      if (!res.headersSent) res.status(503).json({ error: 'MCP session service unavailable.' });
    }
  });
  router.all(['/', '/:token'], (_req, res) => res.status(405).set('Allow', 'POST').end());
  return router;
}
