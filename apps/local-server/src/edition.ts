/**
 * The server surface another edition builds on (see docs/adr/0002-open-core-editions.md). Importing it starts
 * nothing; `index.ts` is the community edition's own entry point.
 */
export { type AppServices, applicationRoot, createApp } from './app.js';
export { type AuthServices, authToken, createAuth, credentialToken, CredentialRejected, grantsRouter, signInRouter } from './auth.js';
export { createPiAgent, type PiAgent } from './pi-agent.js';
export { createRemoteCache } from './remote-cache-store.js';
export { openWorkspace, requestWorkspace, workspaceOf } from './request-workspace.js';
export { createRecordStore, DirectoryRecordBackend, type GrantSummary, type RecordBackend, type RecordStore, RedisRecordBackend, SealedRecordStore, sealedElsewhere, type StoredRecord } from './record-store/index.js';
