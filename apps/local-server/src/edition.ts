/**
 * The server surface another edition builds on (see docs/adr/0002-open-core-editions.md). Importing it starts
 * nothing; `index.ts` is the community edition's own entry point.
 */
export { applicationRoot, type AppServices, createApp } from './app.js';
export { type AuthServices, authToken, createAuth, CredentialRejected, credentialToken, grantsRouter, signInRouter } from './auth.js';
export { createPiAgent, type PiAgent } from './pi-agent.js';
export { createRemoteCache } from './remote-cache-store.js';
export { openWorkspace, requestWorkspace, workspaceOf } from './request-workspace.js';
export { createRecordStore, DirectoryRecordBackend, type GrantSummary, type RecordBackend, type RecordStore, RedisRecordBackend, sealedElsewhere, SealedRecordStore, type StoredRecord } from './record-store/index.js';
