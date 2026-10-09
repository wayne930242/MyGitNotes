# Deploy MyGitNotes

[English](deploy.md) · [繁體中文](deploy.zh-TW.md)

Run MyGitNotes locally first with the [quick start](../README.md#quick-start), then choose the deployment path that matches your hosting setup.

## Vercel through GitHub Actions sparse checkout (default)

### Vercel preparation

**Accounts and services**

- A Vercel project, GitHub repository containing the core and main branches, and an Upstash Redis database.
- For GitHub sign-in, prepare a GitHub OAuth App and set the OAuth callback to `https://<your-project>.vercel.app/api/auth/github/callback`.
- For GitLab sign-in, prepare the GitLab OAuth App described in [GitLab source overlay](#gitlab-source-overlay). For GitHub Enterprise, register the app on that site as described in [GitHub Enterprise source overlay](#github-enterprise-source-overlay).

**Values to generate**

- Generate `SESSION_SECRET` before the first phase with `openssl rand -hex 32`.
- Create `VERCEL_TOKEN` in Vercel Account Settings → Tokens before the first phase, scoped to the team that owns this project; save its value.

**Tools to install**

- Install the Vercel and GitHub CLIs.

### Set runtime values

1. Authenticate the Vercel CLI: `vercel login`
2. Authenticate the GitHub CLI: `gh auth login`
3. Link the Vercel project from the Core checkout: `vercel link`. Read orgId and projectId from the resulting .vercel/project.json for the [GitHub Actions configuration phase](#connect-github-actions).
4. Copy the environment template: `cp .env.example .env`
5. Fill .env with the runtime fields below. Use the workspace repository and main branch, the callback URL and `SESSION_SECRET` from [Vercel preparation](#vercel-preparation), and the Redis REST URL and token from Upstash.
6. Import those values into Vercel production: `pnpm env:vercel production`

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

### Connect GitHub Actions

1. In Vercel, open **Settings → Git** and disconnect the Git integration so it does not start a second, full-repository deployment.
2. Set the default GitHub repository for gh to the repository that contains this workflow; replace OWNER/WORKSPACE_REPO with its owner and name: `gh repo set-default OWNER/WORKSPACE_REPO`
3. Store the token prepared above as a GitHub Actions secret: `gh secret set VERCEL_TOKEN` (paste it when prompted)
4. Replace ORG_ID with orgId from the [linking step](#set-runtime-values) and add it as a GitHub Actions variable: `gh variable set VERCEL_ORG_ID --body ORG_ID`
5. Replace PROJECT_ID with projectId from the [linking step](#set-runtime-values) and add it as a GitHub Actions variable: `gh variable set VERCEL_PROJECT_ID --body PROJECT_ID`

### Deploy and verify

1. Run the production workflow from core: `gh workflow run deploy-vercel-sparse.yml --ref core`
2. Wait with `gh run watch`; then confirm the deployment is Ready in `vercel ls --prod` and the domain serves the Notes view.

The workflow deploys product paths from core; note-only changes on main do not trigger a build. The app reads workspace content from main at runtime. The workflow deploys from core by default; set the `MYGITNOTES_DEPLOY_BRANCH` repository variable only for another deploy branch. Set `MYGITNOTES_SESSION_NAMESPACE` only when deployments share one Redis database; use a unique value per deployment.

### Alternative: Vercel through Git integration (opt out of Actions deployment)

**Accounts and services**

- Complete the [runtime values phase](#set-runtime-values), including CLI authentication, Vercel project linking, GitHub OAuth App, Upstash Redis, and runtime fields.
- Keep the Vercel Git integration connected and set the Vercel production branch to core.

**Values to generate**

- Skip the `VERCEL_TOKEN` preparation described in [Vercel preparation](#vercel-preparation).

**Tools to install**

- Use the Vercel and GitHub CLIs from the default Vercel path.

1. In GitHub, set the workflow opt-out variable: `gh variable set MYGITNOTES_VERCEL_DEPLOY --body git-integration`
2. In Vercel **Settings → Git**, confirm the production branch is core; vercel.json enables deployments from core.
3. In Vercel **Deployments**, confirm the latest core deployment is Ready and the domain serves the Notes view.

This path clones the full repository on Vercel. It does not need `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID`.

## Lightweight Vercel deployment (no Redis, visitors choose their repository)

This path needs no Redis and no fixed note repository.
Each visitor signs in with GitHub, picks one of their own repositories, and works in it.
The sign-in, including the GitHub token, and the chosen repository are sealed with `SESSION_SECRET` in HttpOnly cookies, so the server stores nothing.
A repository without a MyGitNotes manifest opens with its top-level folders as notebooks, and a notice offers to commit the manifest.

The trade-offs follow from keeping nothing on the server: there are no MCP connector grants, no GitLab sign-in, and no Core update panel, and signing in again is needed after the GitHub App's refresh token expires (six months) or after a failed refresh.

### Lightweight preparation

**Accounts and services**

- A Vercel project, as in [Vercel preparation](#vercel-preparation); no Upstash Redis.
- A GitHub App (**Settings → Developer settings → GitHub Apps → New GitHub App**):
  - Homepage URL: `APP_URL`; Callback URL: `APP_URL`/api/auth/github/callback.
  - Keep **Expire user authorization tokens** on, and turn on **Request user authorization (OAuth) during installation**.
  - Turn off **Webhook**.
  - Repository permissions: **Contents** read and write, **Metadata** read-only.
  - Choose **Any account** so visitors can install it on their own repositories.
  - Generate a client secret, and note the client ID and the app's URL name (the slug in `https://github.com/apps/<slug>`).

**Values to generate**

- Generate `SESSION_SECRET` with `openssl rand -hex 32`.
  Rotating it signs every visitor out and forgets their repository choice.

### Lightweight runtime values

Fill .env with these fields and import them with `pnpm env:vercel production`; leave `MYGITNOTES_REPOSITORY`, `MYGITNOTES_BRANCH` and every Redis variable unset.

```dotenv
APP_URL=https://<your-project>.vercel.app
MYGITNOTES_SOURCE=github
GITHUB_APP_TYPE=github-app
GITHUB_APP_SLUG=<the GitHub App's URL name>
GITHUB_CLIENT_ID=<the GitHub App's client ID>
GITHUB_CLIENT_SECRET=<the GitHub App's client secret>
SESSION_SECRET=<output of openssl rand -hex 32>
```

Deploy as in [Connect GitHub Actions](#connect-github-actions) and [Deploy and verify](#deploy-and-verify), then open the domain: it shows the sign-in screen, and after sign-in the repository picker.

A visitor without a notes repository chooses **Create a new notes repository** in the picker: GitHub's new-repository page opens prefilled with the starter template, and once they create it and grant it to the app, the picker selects it.
The template defaults to the public [`wayne930242/mygitnotes-starter`](https://github.com/wayne930242/mygitnotes-starter); set `MYGITNOTES_STARTER_TEMPLATE=<owner>/<name>` to offer your own template repository instead.

Any deployment can use these cookie sessions with `MYGITNOTES_STORAGE=cookie`; Vercel uses them automatically when no Redis is configured.
A deployment that sets `MYGITNOTES_REPOSITORY` keeps serving that one repository, with or without Redis.

## Docker Compose with a remote repository

### Docker Compose preparation

**Accounts and services**

- Docker with Compose, a public URL or http://localhost:4321, and Compose's private Redis network. No Redis account is needed.
- For GitHub sign-in, prepare a GitHub OAuth App: set its Homepage URL to `APP_URL` and callback to `APP_URL`/api/auth/github/callback.
- For GitLab sign-in, use the [GitLab source overlay](#gitlab-source-overlay).

**Values to generate**

- Generate `SESSION_SECRET` before the [Docker Compose deployment](#docker-compose-with-a-remote-repository) with `openssl rand -hex 32`.

**Tools to install**

- Install Docker with Compose.

1. Copy the environment template: `cp docker.env.example .env.docker`
2. In .env.docker, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=owner/repo`, `MYGITNOTES_BRANCH=main`, `APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_APP_TYPE=oauth-app`.
3. Fill `SESSION_SECRET` with the value generated in [Docker Compose preparation](#docker-compose-preparation).
4. Check the resolved Compose configuration: `docker compose -f compose.yaml config --quiet`
5. Build and start MyGitNotes and Redis: `docker compose -f compose.yaml up -d --build`
6. Open `APP_URL`; the Notes view loads and GitHub sign-in opens the OAuth App configured in the environment configuration step.

Compose publishes the app on 127.0.0.1:4321 by default and stores Redis data in the redis-data volume. Set `MYGITNOTES_PORT` to change the browser-facing port; use the same URL in `APP_URL`.

After updating the product checkout, rebuild with `docker compose up -d --build`. `docker compose down` preserves the Redis volume; `docker compose down -v` deletes it and invalidates stored sessions and MCP grants.

## Plain Docker with a remote repository

### Plain Docker preparation

**Accounts and services**

- Docker, `APP_URL` as http://localhost:4321 or a public HTTPS origin, and a persistent Docker volume for encrypted sessions and MCP grants.
- For GitHub sign-in, set the OAuth App Homepage URL to `APP_URL` and callback to `APP_URL`/api/auth/github/callback.
- For GitLab sign-in, use the [GitLab source overlay](#gitlab-source-overlay).

**Values to generate**

- Generate `SESSION_SECRET` before the [plain Docker deployment](#plain-docker-with-a-remote-repository) with `openssl rand -hex 32`.

**Tools to install**

- Install Docker.

1. Copy the environment template: `cp docker.env.example .env.docker`
2. In .env.docker, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=owner/repo`, `MYGITNOTES_BRANCH=main`, `APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_APP_TYPE=oauth-app`; set `REDIS_URL` here only when using your own Redis.
3. Fill `SESSION_SECRET` with the value generated in [Plain Docker preparation](#plain-docker-preparation).
4. Build the image: `docker build -t mygitnotes:local .`
5. Create persistent session storage: `docker volume create mygitnotes-sessions`
6. Start the container:
   `docker run -d --name mygitnotes --init --restart unless-stopped -p 127.0.0.1:4321:4321 --env-file .env.docker --mount type=volume,source=mygitnotes-sessions,target=/app/.github-notes-sessions mygitnotes:local`
7. Open `APP_URL`; the Notes view loads and GitHub sign-in opens the OAuth App configured in the environment configuration step.

The volume created by the [persistent session storage step](#plain-docker-with-a-remote-repository) preserves sessions, provider credentials, and MCP grants across container replacements. When `REDIS_URL` is set in the environment configuration, native Redis takes precedence over Redis REST.

## Public access behind a reverse proxy

This subsection applies to [Docker Compose](#docker-compose-with-a-remote-repository) and [plain Docker](#plain-docker-with-a-remote-repository). Set `APP_URL` to the HTTPS origin and route the reverse proxy to 127.0.0.1:4321. Preserve the public Host header, forward /api/*, /mcp/*, /raw-assets/*, and /r2-assets/*, and allow streamed MCP responses. A proxy in another container must share the app network and forward to mygitnotes:4321.

## Local checkout inside a container

### Local checkout preparation

**Accounts and services**

- An existing workspace checkout on main with .mygitnotes.yaml and your notes. On Linux, give UID/GID 1000:1000 read/write access to the checkout.

**Values to generate**

- None.

**Tools to install**

- Docker and Git.

1. Set `WORKSPACE_PATH` to the absolute workspace path: `export WORKSPACE_PATH=/absolute/path/to/workspace`
2. Set the workspace commit author: `git -C "$WORKSPACE_PATH" config user.name "Your Name"`
3. Set the workspace commit email: `git -C "$WORKSPACE_PATH" config user.email you@example.com`
4. Check the bind mount and Compose settings: `docker compose -f compose.local.yaml config --quiet`
5. Build and start the container: `docker compose -f compose.local.yaml up -d --build`
6. Open http://localhost:4321; the mounted workspace appears in the Notes view.

This mode is an anonymous desktop workflow restricted to loopback hosts. Local edits and Screen / Study YAML files persist in the mounted checkout. Configure remote Git credentials there to commit and sync.

## GitLab source overlay

This subsection applies on top of [Vercel through GitHub Actions sparse checkout](#vercel-through-github-actions-sparse-checkout-default), [Docker Compose](#docker-compose-with-a-remote-repository), or [plain Docker](#plain-docker-with-a-remote-repository).

### GitLab preparation

**Accounts and services**

- Create a GitLab OAuth application on the selected GitLab site with the api scope and callback `APP_URL`/api/auth/gitlab/callback.
- For self-managed GitLab, use its HTTPS base URL, including an installation subpath, and ensure the deployment can reach and trust it.
- Keep `APP_URL`, `SESSION_SECRET`, and session storage from the selected base path.

**Values to generate**

- None beyond the selected base path.

**Tools to install**

- Use the tools from the selected base path.

1. In .env.docker for Docker, or .env for Vercel, set `MYGITNOTES_SOURCE=gitlab`, `MYGITNOTES_REPOSITORY=group/subgroup/project`, `MYGITNOTES_BRANCH=main`, `MYGITNOTES_GITLAB_URL=https://gitlab.com`, `GITLAB_CLIENT_ID`, and `GITLAB_CLIENT_SECRET`.
2. For Vercel, import the updated .env fields with `pnpm env:vercel production`; Docker uses the .env.docker from the source configuration step.
3. For Compose, continue at the build and start step; for plain Docker, continue at the image build and container start steps; for Vercel, run `gh workflow run deploy-vercel-sparse.yml --ref core`.
4. Open `APP_URL`; GitLab sign-in opens the OAuth application from the preparation phase and the Notes view loads.

Keep the GitHub deployment settings from [Vercel through GitHub Actions sparse checkout](#vercel-through-github-actions-sparse-checkout-default) when using Actions; replace only the note-source and OAuth provider fields. GitLab writes require push access to main; public repositories support anonymous reads.

## GitHub Enterprise source overlay

This subsection applies on top of [Vercel through GitHub Actions sparse checkout](#vercel-through-github-actions-sparse-checkout-default), [Docker Compose](#docker-compose-with-a-remote-repository), or [plain Docker](#plain-docker-with-a-remote-repository). It keeps the notes in a repository on GitHub Enterprise Server (GHES) or GitHub Enterprise Cloud with data residency (GHE.com) instead of github.com.

### GitHub Enterprise preparation

**Accounts and services**

- Register a GitHub OAuth App or GitHub App on the same Enterprise site, with callback `APP_URL`/api/auth/github/callback. Personal access token sign-in is not supported.
- Ensure the deployment can reach and trust the site over HTTPS. The site's API must be reachable too: `https://<site>/api/v3` on GHES, `https://api.<host>` on GHE.com.
- Keep `APP_URL`, `SESSION_SECRET`, and session storage from the selected base path.

**Values to generate**

- None beyond the selected base path.

**Tools to install**

- Use the tools from the selected base path.

1. In .env.docker for Docker, or .env for Vercel, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=team/notes`, `MYGITNOTES_BRANCH=main`, `MYGITNOTES_GITHUB_URL=https://ghe.example.com` (`https://octocorp.ghe.com` on GHE.com; an installation subpath is accepted), and the `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` of the app registered on that site. `GITHUB_NOTES_GITHUB_URL` is read too. The setting is ignored unless `MYGITNOTES_SOURCE=github`; with it empty or `https://github.com`, nothing changes from a github.com deployment.
2. For Vercel, import the updated .env fields with `pnpm env:vercel production`; Docker uses the .env.docker from the source configuration step.
3. For Compose, continue at the build and start step; for plain Docker, continue at the image build and container start steps; for Vercel, run `gh workflow run deploy-vercel-sparse.yml --ref core`.
4. Open `APP_URL`; sign-in opens the Enterprise site and the Notes view loads.

What follows the site: repository reads and writes, sign-in, the repository picker when `MYGITNOTES_REPOSITORY` is empty, the GitHub App installation link (`<site>/github-apps/<slug>/installations/new`), and Gist publishing (a note's **Open the Gist** link asks the site's Gist API for the Gist's address and opens it there). Every repository of a workspace is on the deployment's site; one on another site is unavailable, since that site's sign-in does not reach it.

Earlier versions ignored `url` on a `github` source. A manifest or server YAML that carries one now names that site, so remove a leftover `url` (for example a repository's web address) from a github.com source, and do not leave it empty.

Differences from github.com:

- **Create from template**: github.com offers the starter template. An Enterprise site offers the create link only when `MYGITNOTES_STARTER_TEMPLATE` names a template on that site; otherwise people pick an existing repository.
- **Core updates** keep following github.com and are not offered for a product repository on an Enterprise site, so the site's token is never sent to github.com.
- **Archive downloads** accept a redirect only to the site's own codeload (`https://codeload.<host>/…`, or `https://<host>/codeload/…` without subdomain isolation), over HTTPS on the port the site's URL names (none for the default).
- The Pro service stays github.com only.

## Core updates

Settings checks the repository's Core revision and the running build separately. Local updates require a clean product checkout on `core`; the workspace branch does not control this operation. After updating, run `pnpm migrate-workspace` with the updated Core and restart the server.

A hosted deployment offers Core updates only for its product repository, the repository whose `core` branch it deploys. Name it with `MYGITNOTES_PRODUCT_REPOSITORY` (`owner/name`) or `product_repository: owner/name` in `mygitnotes.server.yaml`; it is on the deployment's GitHub site (`MYGITNOTES_GITHUB_URL`, github.com when unset). A fork-model deployment, whose notes repository also carries `core`, names that same repository. Without one, Settings shows no Core update and the update routes answer 404 without asking the provider.

For GitHub workspaces, use **Install Core sync** when Settings reports a missing workflow, then **Update Core**. Bootstrap also installs the [canonical workflow](../packages/core/assets/mygitnotes-core-sync.yml) as `.github/workflows/mygitnotes-core-sync.yml` on `main`; repositories with another default branch install it there through Settings. The workflow fetches MyGitNotes upstream and pushes a fast-forward of `core`. Settings follows the correlated run and verifies the resulting revision before reporting success. Existing workflow files are preserved.

GitHub OAuth requests `repo workflow gist`; `gist` lets a note's Info tab publish its body as a secret Gist. Older grants show **Re-authorize GitHub**, and publishing from them asks the user to sign in again. The app encrypts the user's grant and stores it as the repository Actions secret `MYGITNOTES_CORE_SYNC_TOKEN`, which the runner uses for its push. People who can modify that repository's workflows can use this stored credential through a workflow. The user-token push raises configured deployment events; deployment completion is separate from Core sync completion.

GitHub App installations configure **Contents**, **Workflows**, **Actions**, and **Secrets** write permissions in the App settings; App sign-in does not request OAuth scopes. GitLab Core updates are not supported yet, and GitLab sign-in retains its existing `api` scope.

## Update and migrate

Run `pnpm update-core` from a clean `core` checkout to fast-forward the product branch from `upstream/core` (or `origin/core` when no `upstream` remote exists) and migrate its configured workspace; then run `pnpm install && pnpm dev` to restart with the updated Core. Run `pnpm migrate-workspace` from that checkout to migrate the workspace on its own. If `schema_version` is incompatible, the local server stops and its error names `pnpm migrate-workspace` or, when the workspace requires a newer Core, `pnpm update-core`.

To convert an older workspace whose `main` still contains product files, clean the checkout and run `pnpm convert-workspace` on `main` once. Then create a separate Core worktree with `git worktree add --track -b core ../mygitnotes-core origin/core`, set `MYGITNOTES_LOCAL_PATH` in that worktree's .env to the converted checkout, and start from the Core worktree. `pnpm update-core` runs only on `core`.

### Upgrading a hosted deployment to schema 4

A hosted deployment of this Core keeps reading a schema 3 manifest that declares no notebook with `source`, while an older Core refuses schema 4. Deploy the code first and move the manifest afterwards, in this order:

1. Name the product repository in the deployment's environment before deploying: `MYGITNOTES_PRODUCT_REPOSITORY=owner/name`, or `product_repository` in `mygitnotes.server.yaml` (see [Core updates](#core-updates)). A self-hosted remote deployment must set it to keep Core updates: without it, Settings no longer shows Core updates and the update routes answer 404. On Vercel, set it before the deployment starts, so the deployment carries it.
2. Deploy the new Core and wait until the deployment is live.
3. Check that browsing and committing notes work, that an existing MCP connection still lists its notebooks, and that Settings offers Core updates.
4. Later, in a clean checkout of the notes repository's branch, migrate its manifest from the new Core checkout with `pnpm migrate-workspace --workspace <checkout>`. It commits `chore: migrate the workspace manifest to schema 4`, which only changes `schema_version`; check it with `git -C <checkout> show --stat HEAD`, then push it.

Until that commit is pushed, rolling back needs only the previous code. Once it is pushed, revert it together with the code, because the previous Core refuses schema 4. A manifest that still declares notebooks with `source` makes its repository unavailable on this Core: convert it first, as [Converting `source` notebooks](#converting-source-notebooks) describes.

## Notebooks in other repositories

A workspace can serve notebooks from several repositories. Each repository's own `.mygitnotes.yaml` (`schema_version: 4`) declares the notebooks it holds, with `root` and `assets` relative to that repository, and sets the repository's title, the notebook it opens at and its preferences. The repository the deployment names (`MYGITNOTES_REPOSITORY`, `MYGITNOTES_LOCAL_PATH` or the top-level `source:`) is the default repository, where the workspace opens. A local deployment adds further repositories by mapping them to worktrees in `mygitnotes.server.yaml`, with `path` relative to that file; each is on the branch its worktree has checked out:

```yaml
repositories:
  - type: github
    repository: owner/trpg-notes
    path: ../trpg-notes
```

A repository that cannot be reached, or whose manifest does not load, shows as unavailable with the reason; the other repositories work normally, and Settings opens the broken manifest so it can be fixed. Each repository keeps its own Screen, Focus and Study files and Agent files, and a commit that spans repositories creates one commit in each.

### Converting `source` notebooks

Schema 3 let the home manifest declare a notebook of another repository with `source`. Schema 4 removed `source`, and a manifest that still uses it makes its repository unavailable with `Notebook <id> uses source, which schema 4 removed. Run pnpm convert-sources in <repository>.` Convert it once, from the Core checkout whose `mygitnotes.server.yaml` maps each named repository to its worktree:

```sh
pnpm convert-sources            # shows the plan; asks before writing in a terminal
pnpm convert-sources --yes      # applies it without asking
pnpm convert-sources --workspace ../hub --yes   # converts another mapped worktree's manifest
```

For each notebook with `source`, the command adds the notebook, unchanged but for `source`, to the manifest of the repository it names, creating that manifest when the repository has none (titled by the repository's name, opening at the first notebook moved to it, with a copy of the converting manifest's preferences, shown in full before writing); an existing manifest keeps its title, default notebook and preferences. It then removes the notebook from the converting manifest and moves both to `schema_version: 4`. It refuses before writing anything when a named repository has no mapped worktree, when the target already has a different notebook with the same id or an overlapping root, or when a manifest it touches has uncommitted changes. When the notebook the converting manifest opens at moves away, the plan names the old and the new `default_notebook` (its first remaining notebook). Focus and Study entries of a moved notebook found in the converting repository's files are listed and left in place.

Converting the deployment's own source also keeps every repository's alias, the first part of its notebooks' keys in URLs and Focus layouts. Schema 3 derived aliases in the order the manifest's notebooks named repositories with `source`, and this Core derives them in the order of `repositories`, so the command lists the repositories notebooks move to first under `repositories`, in that order, keeping the others after; the plan shows the new order and the resulting aliases.

Each repository's change is one commit. When a commit fails, the command stops and prints the command that commits what it wrote; run `pnpm convert-sources` again afterwards, and notebooks already present, identically, in their repository are skipped. A run that finds such a manifest still uncommitted stops before committing anything else and prints that command again. When every notebook would leave the converting manifest, the command stops unless `--remove-emptied` is given, which deletes that manifest in its commit and removes the repository from `repositories` in `mygitnotes.server.yaml`; it refuses this for the deployment's own source, which another repository must replace first. A manifest without `source` moves to schema 4 with `pnpm migrate-workspace`. A manifest below schema 3 may still hold a Screen file that only a schema 3 Core converts: `convert-sources` refuses it and asks to run `pnpm migrate-workspace` from a Core checkout at `fd0fd42` first.

## Optional: private R2 assets

Store large files in a private Cloudflare R2 bucket and reference them in notes as `r2:<object-key>`. Set `MYGITNOTES_R2_ACCOUNT_ID`, `MYGITNOTES_R2_ACCESS_KEY_ID`, `MYGITNOTES_R2_SECRET_ACCESS_KEY`, and `MYGITNOTES_R2_BUCKET` in the deployment environment. Browser uploads also require a bucket CORS rule allowing PUT, GET, and HEAD from `APP_URL`. A read-only R2 token supports previews; Files-page management needs Object Read & Write. The MCP asset tools follow the same setting: with R2 configured `add_asset` uploads to the bucket and answers with the `r2:<object-key>` reference instead of committing the binary, `list_assets` reports bucket objects beside repository files, and `delete_asset` accepts that reference. A bucket-bound upload is not held to the 3 MiB repository limit; over hosted `/mcp` its ceiling is the 64 MiB request body, and the Files page uploads straight to the bucket with no ceiling. See [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) and [R2 object access](https://developers.cloudflare.com/r2/api/s3/api/).
