---
title: Configuring Note Sources
tags: [configuration, getting-started]
status: done
---
# Configuring Note Sources

Application deployment is configured independently from note storage. This demo site reads and writes notes from the `main` branch of `wayne930242/github-notes`, while application product code is maintained on `core`.

## Local Directory

Specify your local folder in `github-notes.server.yaml` at the application root:

```yaml
source:
  type: local
  path: /absolute/path/to/my-notes
```

Local sources operate directly on the target folder's working tree. Edits are auto-saved to disk, and commits create local Git history entries.

## GitHub Repository

```yaml
source:
  type: github
  repository: your-account/your-notes
  branch: main
```

You can also configure sources using `.env` variables (`GITHUB_NOTES_SOURCE`, `GITHUB_NOTES_REPOSITORY`, `GITHUB_NOTES_BRANCH`). Environment variables take precedence over YAML. Keep access tokens in local `.env` or deployment secrets.

The `.github-notes.yaml` file in the source repository defines notebooks. New workspaces use the root config; legacy `notes/.github-notes.yaml` maintains backward compatibility. Each notebook's `root` is a path relative to the repository root.
