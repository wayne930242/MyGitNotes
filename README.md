# MyGitNotes

A local-first workspace for Markdown notes, flashcards, compilations, and knowledge graphs. Your content stays in Git; run the interface locally or deploy with Docker, Docker Compose, or Vercel.

[English](README.md) · [繁體中文](README.zh-TW.md)

[Live Demo](https://my-gh-core.vercel.app) · [Flashcard Demo](https://my-gh-core.vercel.app/notes/study?notebook=learning&path=notes%2Flearning%2F%E5%AD%B8%E7%BF%92-%E4%B8%80%E6%AC%A1%E4%B8%80%E5%BC%B5%E5%8D%A1%E7%89%87.compilation.yml) · [Example Workspace](https://github.com/wayne930242/MyGitNotes/tree/main)

![MyGitNotes architecture](docs/assets/mygitnotes-architecture-en.png)

## Why combine both sides

Local-first tools keep files on your device; cloud-document tools give you a browser and multi-device experience. MyGitNotes points both ways of working at the same Markdown and Git workspace. There is no second cloud copy to export, import, or reconcile.

## How it works

Markdown is the content source, Git records and publishes changes, and the repository owner controls credentials and access. A local checkout, Docker container, or Vercel deployment provides the interface and MCP endpoint; remote mode reads and writes the selected GitHub or GitLab repository.

One repository uses two branches in separate worktrees:

- **core** contains product source, packages, tests, scripts, and documentation.
- **main** contains workspace configuration, notebooks, assets, and workspace Agent settings.

## Quick start

Requires Node.js 22+, pnpm 9+, and Git 2.42+. Local mode needs no OAuth account.

~~~bash
git clone --branch core --single-branch https://github.com/wayne930242/MyGitNotes.git mygitnotes
cd mygitnotes
pnpm install
pnpm build                 # builds the packages the bootstrap script needs
pnpm bootstrap-workspace   # creates the main worktree in ./workspace (ignored by Git), writes MYGITNOTES_LOCAL_PATH to .env, and sets up the upstream remote
pnpm dev
~~~

Bootstrap renames the MyGitNotes remote from `origin` to `upstream` (or adds `upstream` when `origin` is already your repository), so `origin` can be your own repository while `pnpm update-core` keeps fetching Core from `upstream`. To keep your notes in your repository, create an empty one and push both branches:

~~~bash
git remote add origin <your-repository-url>
git push -u origin core main
~~~

Open http://localhost:5173; the new workspace appears in the Notes view.

Already have a workspace? Instead of bootstrap, run from the Core checkout:

~~~bash
pnpm link-workspace "/absolute/path/to/workspace"
pnpm dev
~~~

`link-workspace` validates the existing manifest and schema, then saves `MYGITNOTES_SOURCE=local` and the absolute `MYGITNOTES_LOCAL_PATH` in Core's `.env`, preserving unrelated settings.
It does not change notes or Git remotes, create worktrees, or migrate the workspace.
For an older schema, run `pnpm migrate-workspace --workspace "/absolute/path/to/workspace"` explicitly before linking; for a newer schema, update Core first.
An existing nonempty `REPO_ROOT` in `.env` follows the linked workspace too; an absent or empty value stays unchanged.
Shell environment settings still override `.env`.
`pnpm dev:remote` shares the same local workspace through Tailscale; it does not select a GitHub/GitLab source.
Both dev commands show `link-workspace` guidance if the workspace is missing.

## Deploy

The [deployment guide](docs/deploy.md) covers each path step by step:

- [Vercel through GitHub Actions sparse checkout](docs/deploy.md#vercel-through-github-actions-sparse-checkout-default) (default), or through the Vercel Git integration
- [Docker Compose](docs/deploy.md#docker-compose-with-a-remote-repository) or [plain Docker](docs/deploy.md#plain-docker-with-a-remote-repository) with a remote repository, optionally [behind a reverse proxy](docs/deploy.md#public-access-behind-a-reverse-proxy)
- [A local checkout inside a container](docs/deploy.md#local-checkout-inside-a-container)
- [GitLab as the note source](docs/deploy.md#gitlab-source-overlay)
- [Private R2 assets](docs/deploy.md#optional-private-r2-assets)

## Update

Run `pnpm update-core` from a clean `core` checkout; it fast-forwards `core` from `upstream/core`. Then `pnpm install && pnpm dev`. Hosted GitHub workspaces update from Settings. See [Core updates](docs/deploy.md#core-updates) and [Update and migrate](docs/deploy.md#update-and-migrate).

## Features

- Notes use ordinary Markdown with optional YAML frontmatter; Git preserves history and records explicit commits.
- Browse notes in List, Card, or Kanban views; search full text, manage folders and files, and explore a knowledge graph.
- Compilations (`*.compilation.yml`) organize notebook content as lanes, stacks or graphs; Markdown pages can also become flashcards.
- Choose from **nine palette families**, each with light and dark variants. **Flexoki** is the default; choices are saved in the browser.
- Connect local agents through stdio or remote agents through Streamable HTTP MCP with named read-only or write grants.
- The Files page manages notebook folders, notes, text files, and attachments: 3 MiB uploads, 5 MiB reads and changes, up to 200 changed files per operation.

## Notebook bookmarks

The **Bookmarks** section above each notebook's folders contains shared shortcuts. Use **Add bookmark**, note/outline or folder actions, a compilation's bookmark action, or **Save current view** in Notes. Supported targets are notes, folders, compilations, exact headings/paragraphs, HTTP(S) websites, and the current notebook's query/filters/view/sort. A saved query runs against current content; it does not freeze results. Position creation can use the source selection or a saved-source picker.

Edit a bookmark to change its label, target or group. Drag entries/groups to reorder, or use Move up/down and the group selector with keyboard or touch. Removing a group ungroups its entries; removing a bookmark never deletes content. Equivalent additions offer **Edit existing**. Missing targets remain visible for repair; unresolved positions offer **Open whole note** and re-targeting. Matching is exact text/context, never guessed by line number, and adds no markers to Markdown. Websites open in a separate tab without opener access; they are not fetched or checked in advance.

Collections live in each owning repository's optional `.mygitnotes-bookmarks.yaml`. Local **Saved** means written to the worktree: use normal Git Changes to commit/sync. Remote **Pending** is only a browser draft until committed through Changes. Position creation requires saving local note contents first, or explicitly committing a remote staged note first. Read-only users can open bookmarks but cannot edit shared data. Failed/conflicting saves preserve drafts for review; unavailable repositories are not treated as deleted targets. GitNotes moves update references atomically; external moves require re-targeting.

## Documentation

- [Deployment guide](docs/deploy.md)
- [Agent and developer documentation](docs/agent/index.md)
- [Architecture](docs/agent/architecture/index.md)
- [MCP interface and security model](docs/agent/mcp/index.md)
- [Demo workspace](examples/demo-workspace/README.md)
- [Study and flashcard guide](docs/agent/study.md)

## License

MIT

## Startup troubleshooting

### Workspace and pnpm

If startup reports a missing workspace, use `pnpm link-workspace "/absolute/path/to/workspace"` for existing notes.
Use `pnpm bootstrap-workspace` only when creating a workspace; it is not a repair command for an existing one.
A pnpm warning about its native executable, followed by successful fallback to the JavaScript CLI, is nonfatal.
If startup exits, check the subsequent error rather than treating that warning as the cause.

### Remote access with Tailscale

- **Same tailnet:** the server and browsing device must join the same tailnet.
  WSL and Windows may run separate Tailscale clients signed into different accounts or tailnets; check both.
- **DNS / `DNS_PROBE_FINISHED_NXDOMAIN`:** enable **Use Tailscale DNS settings** on the browsing device.
  Browser Secure DNS may bypass the system resolver; check the browser's resolver settings (`chrome://settings/security` in Chrome) so the tailnet hostname uses Tailscale DNS.
  Do not disable browser security globally.
- **Browser permission:** if a trusted site's browser prompt requests local-network access, choose **Allow local access**.
  If previously denied, review that site's local-network permission.
  This permission is separate from DNS resolution: granting it does not fix NXDOMAIN, and it is not Tailscale's exit-node LAN-access setting.
- **Serve activation / `node not found`:** ensure the browser's Tailscale admin console is signed into the server's tailnet.
  Check browser local-network permission only if prompted or blocked; it is not a proven universal cause of this message.
  In the correct tailnet, open [DNS settings](https://login.tailscale.com/admin/dns) → **HTTPS Certificates**, following the [official HTTPS instructions][tailscale-https].
- **`Access denied: serve config denied` on Linux/WSL:** an administrator can run the following once on the server to grant the current user local Tailscale management:

  ~~~bash
  sudo tailscale set --operator="$USER"
  ~~~

  This grants Tailscale management privileges to that user; do not run the entire `pnpm dev` or `pnpm dev:remote` command with sudo.
- **Lifecycle:** `dev:remote` runs Serve in the foreground; keep the command running while using the remote page.
  After changing tailnets, stop and rerun `pnpm dev:remote`, then open the newly printed URL rather than an old bookmark.

[tailscale-https]: https://tailscale.com/kb/1153/enabling-https
