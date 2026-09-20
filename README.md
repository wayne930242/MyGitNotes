# MyGitNotes

A local-first workspace for Markdown notes, flashcards, reading screens, and knowledge graphs. Your content stays in Git; run the interface locally or deploy with Docker, Docker Compose, or Vercel.

[English](README.md) · [繁體中文](README.zh-TW.md)

[Live Demo](https://my-gh-core.vercel.app) · [Flashcard Demo](https://my-gh-core.vercel.app/screen/lanes/explore) · [Example Workspace](https://github.com/wayne930242/MyGitNotes/tree/main)

![MyGitNotes architecture](docs/assets/mygitnotes-architecture-en.png)

## Why combine both sides

Local-first tools keep files on your device; cloud-document tools give you a browser and multi-device experience. MyGitNotes points both ways of working at the same Markdown and Git workspace. There is no second cloud copy to export, import, or reconcile.

## How it works

Markdown is the content source, Git records and publishes changes, and the repository owner controls credentials and access. A local checkout, Docker container, or Vercel deployment provides the interface and MCP endpoint. Remote mode reads and writes the selected GitHub or GitLab repository; Compose can provide Redis for sessions and MCP grants.

One repository uses two branches in separate worktrees:

- **core** contains product source, packages, tests, scripts, and documentation.
- **main** contains workspace configuration, notebooks, assets, and workspace Agent settings.

Core updates fast-forward the product branch and preserve workspace content. The product source does not store personal notes.

The Files page manages notebook folders, Markdown notes, text files, and attachments. Uploads support 3 MiB; reads and changed content support 5 MiB, with up to 200 changed files per operation.

## Core updates

Settings checks the repository's Core revision and the running build separately. Local updates require a clean product checkout on `core`; the workspace branch does not control this operation. After updating, run `pnpm migrate-workspace` with the updated Core and restart the server.

For GitHub workspaces, use **Install Core sync** when Settings reports a missing workflow, then **Update Core**. Bootstrap also installs the [canonical workflow](packages/core/assets/mygitnotes-core-sync.yml) as `.github/workflows/mygitnotes-core-sync.yml` on `main`; repositories with another default branch install it there through Settings. The workflow fetches MyGitNotes upstream and pushes a fast-forward of `core`. Settings follows the correlated run and verifies the resulting revision before reporting success. Existing workflow files are preserved.

GitHub OAuth requests `repo workflow`. Older grants show **Re-authorize GitHub**. The app encrypts the user's grant and stores it as the repository Actions secret `MYGITNOTES_CORE_SYNC_TOKEN`, which the runner uses for its push. People who can modify that repository's workflows can use this stored credential through a workflow. The user-token push raises configured deployment events; deployment completion is separate from Core sync completion.

GitHub App installations configure **Contents**, **Workflows**, **Actions**, and **Secrets** write permissions in the App settings; App sign-in does not request OAuth scopes. GitLab Core updates are not supported yet, and GitLab sign-in retains its existing `api` scope.

## Deploy

Choose one path. Prepare the listed accounts and values first, then follow its numbered steps in order.

### 1. Local development with a workspace checkout

**Prepare:** Node.js 22+, pnpm 9+, Git 2.42+, and a GitHub checkout of MyGitNotes Core. No OAuth account is needed for local mode.

1. Clone the product repository: `git clone --branch core --single-branch https://github.com/wayne930242/MyGitNotes.git mygitnotes`
2. Enter the Core checkout: `cd mygitnotes`
3. Install dependencies: `pnpm install`
4. Build the product packages needed by the bootstrap script: `pnpm build`
5. Create a local workspace checkout and set `MYGITNOTES_LOCAL_PATH` in .env: `pnpm bootstrap-workspace`
6. Start the local server and web app: `pnpm dev`
7. Open http://localhost:5173; the workspace created in step 5 appears in the Notes view.

The bootstrap command creates or checks out the main branch in a sibling worktree, then records its path in .env. To use an existing workspace instead, set `MYGITNOTES_LOCAL_PATH` in .env to its absolute path before step 6. Local mode does not require GitHub sign-in.

To open a different workspace checkout for local development, run `REPO_ROOT=/absolute/path/to/workspace pnpm dev`.

### 2. Docker Compose with a remote repository

**Prepare:** Docker with Compose, a public URL or http://localhost:4321, and a session secret. For GitHub sign-in, prepare a GitHub OAuth App: set its Homepage URL to `APP_URL` and callback to `APP_URL`/api/auth/github/callback. For GitLab, prepare the GitLab OAuth App in path 7 instead. Generate `SESSION_SECRET` before step 1 with `openssl rand -hex 32`. Compose supplies Redis in its private network, so no Redis account is needed.

1. Copy the environment template: `cp docker.env.example .env.docker`
2. In .env.docker, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=owner/repo`, `MYGITNOTES_BRANCH=main`, `APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_APP_TYPE=oauth-app`.
3. Fill `SESSION_SECRET` with the value generated in Prepare.
4. Check the resolved Compose configuration: `docker compose -f compose.yaml config --quiet`
5. Build and start MyGitNotes and Redis: `docker compose -f compose.yaml up -d --build`
6. Open `APP_URL`; the Notes view loads and GitHub sign-in opens the OAuth App configured in step 2.

Compose publishes the app on 127.0.0.1:4321 by default and stores Redis data in the redis-data volume. Set `MYGITNOTES_PORT` to change the browser-facing port; use the same URL in `APP_URL`.

After updating the product checkout, rebuild with `docker compose up -d --build`. `docker compose down` preserves the Redis volume; `docker compose down -v` deletes it and invalidates stored sessions and MCP grants.

### 3. Plain Docker with a remote repository

**Prepare:** Docker, `APP_URL` as http://localhost:4321 or a public HTTPS origin, and a persistent Docker volume for encrypted sessions and MCP grants. For GitHub sign-in, set the OAuth App Homepage URL to `APP_URL` and callback to `APP_URL`/api/auth/github/callback; for GitLab, prepare the OAuth App in path 7 instead. Generate `SESSION_SECRET` before step 1 with `openssl rand -hex 32`.

1. Copy the environment template: `cp docker.env.example .env.docker`
2. In .env.docker, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=owner/repo`, `MYGITNOTES_BRANCH=main`, `APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_APP_TYPE=oauth-app`; set `REDIS_URL` here only when using your own Redis.
3. Fill `SESSION_SECRET` with the value generated in Prepare.
4. Build the image: `docker build -t mygitnotes:local .`
5. Create persistent session storage: `docker volume create mygitnotes-sessions`
6. Start the container:
   `docker run -d --name mygitnotes --init --restart unless-stopped -p 127.0.0.1:4321:4321 --env-file .env.docker --mount type=volume,source=mygitnotes-sessions,target=/app/.github-notes-sessions mygitnotes:local`
7. Open `APP_URL`; the Notes view loads and GitHub sign-in opens the OAuth App configured in step 2.

The volume in step 5 preserves sessions, provider credentials, and MCP grants across container replacements. When `REDIS_URL` is set in step 2, native Redis takes precedence over Redis REST.

For public access from paths 2 or 3, set `APP_URL` to the HTTPS origin and route the reverse proxy to 127.0.0.1:4321. Preserve the public Host header, forward /api/*, /mcp/*, /raw-assets/*, and /r2-assets/*, and allow streamed MCP responses. A proxy in another container must share the app network and forward to mygitnotes:4321.

### 4. Local checkout inside a container

**Prepare:** Docker, Git, and an existing workspace checkout on main with .mygitnotes.yaml and your notes. On Linux, give UID/GID 1000:1000 read/write access to the checkout.

1. Set `WORKSPACE_PATH` to the absolute workspace path: `export WORKSPACE_PATH=/absolute/path/to/workspace`
2. Set the workspace commit author: `git -C "$WORKSPACE_PATH" config user.name "Your Name"`
3. Set the workspace commit email: `git -C "$WORKSPACE_PATH" config user.email you@example.com`
4. Check the bind mount and Compose settings: `docker compose -f compose.local.yaml config --quiet`
5. Build and start the container: `docker compose -f compose.local.yaml up -d --build`
6. Open http://localhost:4321; the mounted workspace appears in the Notes view.

This mode is an anonymous desktop workflow restricted to loopback hosts. Local edits and Screen / Study YAML files persist in the mounted checkout. Configure remote Git credentials there to commit and sync.

### 5. Vercel through GitHub Actions sparse checkout (default)

**Prepare:** A Vercel project, GitHub repository containing the core and main branches, and an Upstash Redis database. For GitHub sign-in, prepare a GitHub OAuth App; for GitLab sign-in, prepare the GitLab OAuth App in path 7. For GitHub sign-in, set the OAuth callback to https://<your-project>.vercel.app/api/auth/github/callback; for GitLab, use the callback in path 7. Generate `SESSION_SECRET` before step 1 with `openssl rand -hex 32`. Install the Vercel and GitHub CLIs. Create `VERCEL_TOKEN` in Vercel Account Settings → Tokens before step 1, scoped to the team that owns this project; save its value.

1. Authenticate the Vercel CLI: `vercel login`
2. Authenticate the GitHub CLI: `gh auth login`
3. Link the Vercel project from the Core checkout: `vercel link`. Read orgId and projectId from the resulting .vercel/project.json for steps 10 and 11.
4. Copy the environment template: `cp .env.example .env`
5. Fill .env with the runtime fields below. Use the workspace repository and main branch, the callback URL and `SESSION_SECRET` from Prepare, and the Redis REST URL and token from Upstash.
6. Import those values into Vercel production: `pnpm env:vercel production`
7. In Vercel, open **Settings → Git** and disconnect the Git integration so it does not start a second, full-repository deployment.
8. Set the default GitHub repository for gh to the repository that contains this workflow; replace OWNER/WORKSPACE_REPO with its owner and name: `gh repo set-default OWNER/WORKSPACE_REPO`
9. Store the token prepared above as a GitHub Actions secret: `gh secret set VERCEL_TOKEN` (paste it when prompted)
10. Replace ORG_ID with orgId from step 3 and add it as a GitHub Actions variable: `gh variable set VERCEL_ORG_ID --body ORG_ID`
11. Replace PROJECT_ID with projectId from step 3 and add it as a GitHub Actions variable: `gh variable set VERCEL_PROJECT_ID --body PROJECT_ID`
12. Run the production workflow from core: `gh workflow run deploy-vercel-sparse.yml --ref core`
13. Wait with `gh run watch`; then confirm the deployment is Ready in `vercel ls --prod` and the domain serves the Notes view.

~~~bash
MYGITNOTES_SOURCE=github
MYGITNOTES_REPOSITORY=owner/workspace-repo
MYGITNOTES_BRANCH=main
APP_URL=https://<your-project>.vercel.app
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_APP_TYPE=oauth-app
SESSION_SECRET=<output of openssl rand -hex 32>
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
~~~

The workflow deploys product paths from core; note-only changes on main do not trigger a build. The app reads workspace content from main at runtime. The workflow deploys from core by default; set the `MYGITNOTES_DEPLOY_BRANCH` repository variable only for another deploy branch. Set `MYGITNOTES_SESSION_NAMESPACE` only when deployments share one Redis database; use a unique value per deployment.

### 6. Vercel through Git integration (opt out of Actions deployment)

**Prepare:** Complete path 5 steps 1–6, including CLI authentication, Vercel project linking, GitHub OAuth App, Upstash Redis, and runtime fields. Skip the `VERCEL_TOKEN` preparation in path 5. Keep the Vercel Git integration connected and set the Vercel production branch to core.

1. In GitHub, set the workflow opt-out variable: `gh variable set MYGITNOTES_VERCEL_DEPLOY --body git-integration`
2. In Vercel **Settings → Git**, confirm the production branch is core; vercel.json enables deployments from core.
3. In Vercel **Deployments**, confirm the latest core deployment is Ready and the domain serves the Notes view.

This path clones the full repository on Vercel. It does not need `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID`.

### 7. GitLab source overlay for paths 2, 3, and 5

**Prepare:** Create a GitLab OAuth application on the selected GitLab site with the api scope and callback `APP_URL`/api/auth/gitlab/callback. For self-managed GitLab, use its HTTPS base URL, including an installation subpath, and ensure the deployment can reach and trust it. Keep `APP_URL`, `SESSION_SECRET`, and session storage from the selected base path.

1. In .env.docker for Docker, or .env for Vercel, set `MYGITNOTES_SOURCE=gitlab`, `MYGITNOTES_REPOSITORY=group/subgroup/project`, `MYGITNOTES_BRANCH=main`, `MYGITNOTES_GITLAB_URL=https://gitlab.com`, `GITLAB_CLIENT_ID`, and `GITLAB_CLIENT_SECRET`.
2. For Vercel path 5, import the updated .env fields with `pnpm env:vercel production`; Docker paths 2 and 3 use the .env.docker from step 1.
3. For Compose path 2, continue at step 5; for Docker path 3, continue at steps 4–6; for Vercel path 5, run `gh workflow run deploy-vercel-sparse.yml --ref core`.
4. Open `APP_URL`; GitLab sign-in opens the OAuth application from the preparation step and the Notes view loads.

Keep the GitHub deployment settings from path 5 when using Actions; replace only the note-source and OAuth provider fields. GitLab writes require push access to main; public repositories support anonymous reads.

## Update and migrate

Run `pnpm update-core` from a clean `core` checkout to fast-forward the product branch and migrate its configured workspace; then run `pnpm install && pnpm dev` to restart with the updated Core. Run `pnpm migrate-workspace` from that checkout to migrate the workspace on its own. If `schema_version` is incompatible, the local server stops and its error names `pnpm migrate-workspace` or, when the workspace requires a newer Core, `pnpm update-core`.

To convert an older workspace whose `main` still contains product files, clean the checkout and run `pnpm convert-workspace` on `main` once. Then create a separate Core worktree with `git worktree add --track -b core ../mygitnotes-core origin/core`, set `MYGITNOTES_LOCAL_PATH` in that worktree's .env to the converted checkout, and start from the Core worktree. `pnpm update-core` runs only on `core`.

## Optional: private R2 assets

Store large files in a private Cloudflare R2 bucket and reference them in notes as `r2:<object-key>`. Set `MYGITNOTES_R2_ACCOUNT_ID`, `MYGITNOTES_R2_ACCESS_KEY_ID`, `MYGITNOTES_R2_SECRET_ACCESS_KEY`, and `MYGITNOTES_R2_BUCKET` in the deployment environment. Browser uploads also require a bucket CORS rule allowing PUT, GET, and HEAD from `APP_URL`. A read-only R2 token supports previews; Files-page management needs Object Read & Write. The MCP asset tools follow the same setting: with R2 configured `add_asset` uploads to the bucket and answers with the `r2:<object-key>` reference instead of committing the binary, `list_assets` reports bucket objects beside repository files, and `delete_asset` accepts that reference. A bucket-bound upload is not held to the 3 MiB repository limit; over hosted `/mcp` its ceiling is the 64 MiB request body, and the Files page uploads straight to the bucket with no ceiling. See [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) and [R2 object access](https://developers.cloudflare.com/r2/api/s3/api/).

## Features

- Notes use ordinary Markdown with optional YAML frontmatter; Git preserves history and records explicit commits.
- Browse notes in List, Card, or Kanban views; search full text, manage folders and files, and explore a knowledge graph.
- Screen lanes organize notebook content; Markdown pages can also become flashcards.
- Choose from **nine palette families**, each with light and dark variants. **Flexoki** is the default; choices are saved in the browser.
- Connect local agents through stdio or remote agents through Streamable HTTP MCP with named read-only or write grants.

## Documentation

- [Agent and developer documentation](docs/agent/index.md)
- [Architecture](docs/agent/architecture/index.md)
- [MCP interface and security model](docs/agent/mcp/index.md)
- [Demo workspace](examples/demo-workspace/README.md)
- [Study and flashcard guide](docs/agent/study.md)

## License

MIT
