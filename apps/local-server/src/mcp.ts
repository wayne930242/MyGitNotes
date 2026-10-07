import { buildInfo } from './build-info.js';
import express, { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { type RemoteCache, type RemoteSource, SourceError, type WorkspaceConfigSource, WorkspaceSetupError } from '@mygitnotes/core';
import { callWorkspaceRemoteTool, isMutationTool, remoteTools, type ToolAssets } from '@mygitnotes/mcp-server';
import { type AssetStorage, resolveAssetScope } from './asset-storage.js';
import { CredentialRejected, credentialToken } from './auth.js';
import type { RecordStore } from './record-store/index.js';
import { openWorkspace, type RemoteHandle, type RequestWorkspace } from './request-workspace.js';

/** The JSON-RPC body of an ordinary call; a hosted asset upload carries its file inside the body and may be larger. */
const CALL_BODY_BYTES = 8 * 1024 * 1024;
const UPLOAD_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Reads the request body once the caller is known. A body that declares it fits an ordinary call needs no
 * further decision; a larger one (or one of unknown size) gets the upload ceiling only when the asset storage
 * has a bucket for one of the workspace's repositories, so a deployment without one keeps the ordinary limit.
 */
async function readBody(req: express.Request, res: express.Response, workspace: RequestWorkspace, assets: ToolAssetsFor) {
  const declared = Number(req.headers['content-length']);
  let limit = CALL_BODY_BYTES;
  if (!(declared <= CALL_BODY_BYTES)) {
    const repositories = (await workspace.all()).filter(entry => 'handle' in entry);
    const scopes = await Promise.all(repositories.map(entry => assets((entry as { handle: RemoteHandle; }).handle).scope()));
    if (scopes.some(Boolean)) limit = UPLOAD_BODY_BYTES;
  }
  await new Promise<void>((resolve, reject) => express.json({ limit })(req, res, error => error ? reject(error) : resolve()));
}

type ToolAssetsFor = (handle: { reader: RemoteSource; }) => ToolAssets;

/** The asset tools of one request: the storage's scope, resolved for the repository a call reaches, and its quota hooks. */
function toolAssets(storage: AssetStorage, req: express.Request, res: express.Response): ToolAssetsFor {
  // SAFETY: the workspace of a remote MCP call is built by openWorkspace, so its handles are this server's RemoteHandles.
  return (handle): ToolAssets => ({ scope: () => resolveAssetScope(storage, req, res, handle as RemoteHandle), reserve: storage.reserve && ((scope, key, bytes) => storage.reserve!(scope, key, bytes)), record: storage.record && ((scope, key, delta) => storage.record!(scope, key, delta)) });
}

export function createRemoteMCP(store: RecordStore, configSource: WorkspaceConfigSource, assetStorage: AssetStorage, cache?: RemoteCache): Router {
  const router = Router();
  router.post(['/', '/:token'], async (req, res) => {
    try {
      // A deployment without a usable source answers like one configured for local files.
      const settings = await configSource.settings(req).catch((error: unknown) => {
        if (error instanceof WorkspaceSetupError) return undefined;
        throw error;
      });
      if (!settings || settings.home.source.type === 'local') return res.status(503).json({ error: 'Configure a GitHub or GitLab source for remote MCP.' });
      const home = settings.home;
      const urlToken = typeof req.params.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.params.token) ? req.params.token : undefined;
      const bearer = urlToken || req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const grant = bearer ? await store.get(bearer) : null;
      // Rejections of an existing grant outlive the runtime logs so its owner can read the reason on the grant list.
      const remember = (reason: string) => store.recordRejection(bearer!, reason).catch(error => console.warn(`[mcp] rejection record failed: ${(error as Error).message}`));
      if (grant?.kind !== 'agent' || grant.source !== home.id || grant.audience !== `${process.env.APP_URL}/mcp`) {
        const reason = !bearer ? 'no-token' : !grant ? 'grant-missing' : grant.kind !== 'agent' ? 'grant-kind' : grant.source !== home.id ? 'grant-source' : 'grant-audience';
        console.warn(`[mcp] unauthorized: ${reason}`);
        if (grant?.kind === 'agent') await remember(reason);
        res.setHeader('WWW-Authenticate', 'Bearer realm="MyGitNotes MCP"');
        return res.status(401).json({ error: 'Create a MyGitNotes agent token after signing in.' });
      }
      let token: string;
      try {
        token = await credentialToken(store, grant.credential || grant.session, home.source);
      } catch (error) {
        if (!(error instanceof SourceError)) console.warn(`[mcp] credential lookup failed: ${(error as Error).message}`);
        await remember(error instanceof CredentialRejected ? error.reason : 'credential-unavailable');
        return res.status(error instanceof SourceError ? error.status : 503).json({ error: error instanceof SourceError ? error.message : 'Agent authorization service unavailable. Retry later.' });
      }
      const workspace = openWorkspace(settings, token, cache);
      const assets = toolAssets(assetStorage, req, res);
      try {
        await readBody(req, res, workspace, assets);
      } catch (error) {
        const status = (error as { status?: number; }).status;
        if (!status || status < 400 || status >= 500) throw error;
        return res.status(status).json({ error: status === 413 ? 'The request body is too large.' : 'The request body is not valid JSON.' });
      }
      const server = new Server({ name: 'mygitnotes', version: buildInfo.version }, { capabilities: { tools: {} }, instructions: 'Operate on the configured note repository. Use ls or glob to locate paths, read or find to inspect complete files, then pass the returned revision to a write operation. Before creating or editing notes, read the agent system of the notebook or note with get_system_prompt and list_skills; invoke_skill loads a skill, and read, write, append, edit and rm also work on skill files. Each successful mutation creates one atomic remote commit with a program-generated message. Respect read-only grants. Use Settings to revoke persistent connector URLs.' });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: remoteTools.filter(t => grant.write || !isMutationTool(t.name)) }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        try {
          const result = await callWorkspaceRemoteTool(workspace as import('@mygitnotes/core').WorkspaceRepositories<RemoteHandle>, params.name, params.arguments || {}, grant.write, process.env.APP_URL, assets);
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
