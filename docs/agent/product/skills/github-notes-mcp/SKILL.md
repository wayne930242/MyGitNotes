---
name: github-notes-mcp
description: Use when building, testing, configuring, or safely calling the GitHub Notes Model Context Protocol (MCP) server.
---

# GitHub Notes MCP Workflow

Follow this workflow when developing or interacting with the GitHub Notes MCP server.

## Transport & Boundaries

- Local default transport is `stdio`.
- Expose narrow, repository-scoped tools rather than generic shell execution or arbitrary file access.
- Paths outside repository root, containing `..`, or escaping via symlinks must be rejected.
- Normal write operations are restricted to user workspace branches (`main`).
- Multi-file note saves execute as an atomic transaction and return the resulting Git commit hash.

## Verifying MCP Functionality

Run unit tests:
```bash
pnpm --filter @mygitnotes/mcp-server test
```
