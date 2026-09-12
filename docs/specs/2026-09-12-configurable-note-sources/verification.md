# Verification — 2026-09-12

## Scope and environment

Implemented on `core` after `f34414b`, with Node.js 22.18.0, pnpm, Vitest 2.1.9,
and headless Chrome 131. Product changes leave `notes/**` and user manifests
unchanged. Temporary repositories supply all write-test fixtures.

## Requirement evidence

| Requirement | Evidence | Result |
|---|---|---|
| Config selects local or GitHub repository independently of product origin | `sources.test.ts`: source parser, startup defaults, relative config-file paths, invalid owner/repo and missing cloud configuration | pass |
| Preserve existing local workflows | Existing core/git/MCP suites plus HTTP nested read/write test on a temporary `main` repository | pass |
| Read a workspace manifest from the selected repository | Local fixture HTTP requests and GitHub manifest response fixtures | pass |
| Folder names, sorting, descendants, empty local folders and malformed config | Core folder tests; browser selects Projects → Deep work and excludes the root note | pass |
| Create notes in the selected folder and preserve duplicate files | Browser creates `projects/deep/created-nested.md` and displays duplicate errors inside the creation modal; real HTTP duplicate-create request returns 409 | pass |
| Preserve unknown frontmatter | Local nested write and remote successful-save tests retain custom metadata | pass |
| Provider note/folder parity and pinned reads | Local/GitHub fixture parity; one commit lookup per reader; successful save reads its resulting commit | pass |
| Rate limits and large repository listings | 429 error test; recursive truncation recovery; incomplete subtree listing rejection | pass |
| Anonymous public UI is read-only | Browser renders public GitHub response fixtures without Edit/New/Save controls; anonymous write test returns 403 | pass |
| Private notes require repository authorization | Full simulated GitHub login HTTP test: anonymous private read 404, authorized read succeeds, logout denies subsequent read | pass |
| Credential and agent boundaries | PKCE/state, encrypted server records, tamper detection, HttpOnly opaque cookie, scoped read-only MCP tools, denied MCP save and logout revocation tests; MCP responses are private/no-store | pass |
| Remote writes preserve concurrent work | Successful Git Data commit test; stale revision/duplicate rejection; non-force ref update conflict test | pass |
| Nested asset insertion and rendering | Browser inserts `../../assets/pixel.png`; image finishes loading with nonzero natural width | pass |
| Source-scoped drafts and correct display branch | Draft isolation test; separate `draftScope` and branch props; remote component keyed by source identity | pass |
| Browser Markdown is sanitized | Browser renders a hostile image event handler fixture; handler does not run and rendered markup is sanitized | pass |
| Filesystem traversal, symlink and product-file protection | Existing path guards plus new ancestor-symlink, raw `.env`, product write, foreign Origin and `core` branch rejection HTTP tests | pass |
| README and environment handoff | Usage guide checked against bootstrap/config/save code; local links checked; `.env` and `.env.local` are Git-ignored | pass |
| Live public GitHub note browsing | Production browser reads four real example notes and filters the nested folder; all five browser API requests return 200 | pass |
| Live GitHub login, Redis and private writes | Redis and production OAuth redirect/state storage verified; browser login and authenticated writes await user UAT | partial |
| Live authenticated MCP client | SDK transport exercised over local HTTP with mocked upstream GitHub; live credentials pending | unknown |

## Automated and browser checks

- `pnpm test`: **61 tests passed**, 12 files.
- `pnpm build`: all five workspace packages passed.
- Browser automation: nested filtering, nested creation, relative image insertion,
  visible duplicate-create errors, public read-only controls and sanitized rendering; no browser runtime errors.
- Screenshots: [nested editor](../../../artifacts/qa/nested-editor.png) and
  [public read-only](../../../artifacts/qa/public-readonly.png). These local QA
  artifacts are ignored by Git and excluded from deployment.
- `git diff --check`: passed. User-content diff: empty.

## Deployment

Vercel project `weiweis/my-gh-core` has been created and linked. The target is
`https://my-gh-core.vercel.app`. An initial successful deployment exposed extra
platform TypeScript diagnostics; importing the built JS application removed
those diagnostics in a subsequent deployment. Final live HTTP/browser checks
and the final deployment identifier are recorded below after the final upload.

The deployment intentionally requires source configuration before serving
notes. Local notes, `.env*` secrets, session storage and local source config are
excluded through `.vercelignore`. The user can import the named environment
values with `pnpm env:vercel production`, then redeploy.

## Remaining setup and limitations

- `.env` contains the generated `SESSION_SECRET` and user-supplied GitHub and
  Gemini credentials. Only field presence has been checked; values are not
  printed or committed.
- Configured the GitHub source as `wayne930242/github-notes`, branch `main`, and
  production `APP_URL=https://my-gh-core.vercel.app`. The user selected this
  project as the example. The previously empty public repository received only
  the fresh `examples/demo-workspace` contents, commit
  `a0ca993e1b6286c389272c236b0bd6b178fd2969`; existing local notes and history
  remain local. Nine populated environment fields were imported to Vercel.
- Verify the supplied GitHub application's `GITHUB_APP_TYPE` and register
  `/api/auth/github/callback` on the production URL.
- Redis resource `my-gh-core-sessions` is provisioned and linked to production
  after the user accepted marketplace terms. The requested plan is `free`,
  region `iad1`, with automatic upgrades and the production pack disabled.
  Integration variables `KV_REST_API_URL` and `KV_REST_API_TOKEN` were mapped
  to the app's `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in local
  `.env` and Vercel. The temporary environment export was removed.
  `GEMINI_API_KEY` is optional for local semantic commit messages.
- Remote note create/save is implemented. Asset mutation, remote deletion,
  workspace configuration changes and Core updates remain local operations.
- Remote MCP uses manually configured service bearer grants; automatic MCP
  OAuth discovery/registration is not implemented.
- User review is pending. Automated browser results are not a human acceptance
  verdict. Existing product history was not pushed to a public GitHub remote.

## Reflexive

Friction: the Vercel entry was checked twice under different TypeScript contexts;
screenshot inspection also found two presentation mismatches.
Action: use the built JS entry and existing Markdown styling; separate draft
identity from display labels. `solid-loop` found transient implementation
friction, so shared skills and agent rules remain unchanged.

## Final release checkpoint

- Deployment: `dpl_GGQxRAmX9iFyP6KdxAdTJM5ggtC9`, READY, production alias
  `https://my-gh-core.vercel.app`; final platform build has no TypeScript errors.
- Live homepage returned 200 and its JavaScript bundle matches the verified local
  build. A real browser rendered the setup page without runtime errors:
  [deployed setup](../../../artifacts/qa/deployed-setup.png).
- Source setup and GitHub login endpoints return 503 until their required values
  are supplied. Session inspection returns 200 with authentication unconfigured.
  The unconfigured MCP and raw asset routes return 503. All tested API, MCP and
  asset responses use `Cache-Control: private, no-store`.
- This checkpoint predates source configuration. A later production deployment
  applies the public example source and supplied environment fields. Live
  authenticated login and writing still require Redis provisioning.

## Public example release checkpoint

- Deployment `dpl_CUD2kMGsJLzWjxfsyVg7my1HCxLZ` is READY and serves the
  production alias with `wayne930242/github-notes@main` as its configured source.
- A real browser loaded the workspace, four notes and three folders, selected
  the nested folder and rendered its note. No write controls or browser runtime
  errors appeared. Workspace, notes, folders, assets and session endpoints all
  returned 200 with private/no-store headers.
- Screenshot: [live example](../../../artifacts/qa/deployed-example.png).
- The login endpoint returns 503 identifying the two missing Redis variables.
  The CLI still requires marketplace terms acceptance before provisioning.
  Actual GitHub OAuth login, private reads and authenticated saves remain
  unverified in production.

## Redis and hosted authentication checkpoint

- Deployment `dpl_AJ6uhYRe5Zs8SXD3v73NBL4YNnjZ` is READY at the production
  alias with durable session configuration applied.
- Encrypted Redis session set/get/delete roundtrip passed. Production sign-in
  returns 302 to GitHub with the correct callback and S256 PKCE challenge;
  its HttpOnly/Secure/SameSite=Lax state cookie corresponds to an encrypted
  OAuth record in Redis. The test record was removed after verification.
- Production session inspection reports authentication configured. Anonymous
  MCP and random invalid grants return 401 with private/no-store responses.
  An invalid OAuth callback returns 400.
- Evidence: `artifacts/qa/hosted-auth-readiness.json` (ignored local artifact).
- User requested a subsequent MCP UAT. Browser login is the first pending human
  checkpoint. The prepared SDK client exercises tool discovery, notebook/folder
  reads, path boundaries, read-only write denial, write-grant create/update,
  duplicate and stale revision rejection. Logout revocation will be checked
  after those operations. No authenticated acceptance is claimed yet.
