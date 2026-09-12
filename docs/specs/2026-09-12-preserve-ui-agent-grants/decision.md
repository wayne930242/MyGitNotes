# Decision

Restore the established application UI for GitHub sources and make MCP grants
persistent, individually revocable credentials. This resumes the authorized
source integration in response to user acceptance feedback.

| Question | Answer | Basis | Status |
|---|---|---|---|
| Which UI is the baseline? | Existing Header, List/Card/Kanban, EditorModal, SettingsModal and theme palettes | User objects to unnecessary redesign and missing Settings | confirmed |
| Grant lifetime? | Until manually revoked | User selected persistent validity | confirmed |
| Relationship to browser session? | New grants survive session expiry and logout; Settings owns revocation | Persistent automation requirement | grounded |
| Which credentials are deployed? | Server credentials only; agent grants are runtime client credentials | Existing runtime Redis and environment importer | grounded |
| Remote filesystem operations? | Existing local-only operations remain clearly identified | Approved source integration boundaries | grounded |

Core rules are ready: product changes on core, user notes unchanged, secrets
excluded, tests/build and browser evidence required. No open decisions remain.

## Shared document editor

| Question | Answer | Basis | Status |
| --- | --- | --- | --- |
| Which interfaces share editing? | Notes and Agent System use the same Live Preview/Source editor and mode switch | Explicit user request after local acceptance | confirmed |
| Which workflows stay with callers? | Note frontmatter/assets/remote merge and Agent System local autosave/restore | Existing APIs and distinct document responsibilities | grounded |
| How should file switching behave? | Finish the current pending save before selecting another file; bind reads and writes to the loaded path | Existing effect can combine a new path with old content | grounded |

Core source ownership, main-only workspace writes, and preservation of real
notes remain the applicable project boundaries. No open consequential decision.

| Follow-up question | Answer | Basis | Status |
| --- | --- | --- | --- |
| Where is agent access managed? | Settings; remove the redundant header shortcut for both sources | Explicit user feedback on 2026-09-12 | confirmed |
| Why does local Core update report NO_REMOTE? | Both product and main worktree have no Git remotes; discovery stops before fetch and merge | Git remote inspection and discoverCoreRemote | grounded |

## Mobile editing feedback

| Question | Answer | Basis | Status |
| --- | --- | --- | --- |
| Primary usage priority? | Mobile note editing deserves the same functional quality as desktop | User explicitly identifies mobile as their main editing scenario | confirmed |
| What blocks it today? | At 390 px navigation is hidden, note Close extends to x=485, and Agent editor is 20 px wide | Disposable browser fixture, mobile baseline screenshots | grounded |
| Correction shape? | Responsive navigation, collapsible notebook filters, full viewport note editor, wrapped controls and compact Agent document selection | Existing components own these layouts; desktop design is retained | grounded |

No open product decision blocks implementation. Native mobile keyboard and IME
acceptance remain distinct from emulated browser verification.

Mobile navigation decision: four destinations in a bottom bar, with icons above
single-line labels. Confirmed by the latest user feedback; preserve the full
icon size instead of compressing horizontal navigation.

## Mobile editor toolbar correction

| Question | Answer | Basis | Status |
| --- | --- | --- | --- |
| What remains unacceptable? | Note and Agent tools still use wrapped desktop controls, reducing mobile editing space | User feedback on both editors and existing flex-wrap rules | confirmed |
| How do mobile actions fit? | Shared Radix Live/Source selector, full-size icon actions, note Save/Close in the title row, compact Agent save state | Preserve existing actions while allocating one row to tools | grounded |
| How does restore stay explicit? | Keep a visible Confirm? label and the existing second-click behavior | Existing restore contract | grounded |

Select and notice refinement: the user explicitly requests a headless select
implementation because native menus exceed the viewport, and mobile recovery
notices with readable action labels. Use Radix Select through one palette-aware
component with collision positioning, bounded width/height and scrollable items.

## Notebook status vocabulary

| Question | Answer | Basis | Status |
| --- | --- | --- | --- |
| Default vocabulary? | inbox, working, done, archived | User proposed note-oriented statuses and accepted the direction | confirmed |
| Override scope? | Optional ordered statuses on each notebook; absent or empty uses defaults | User requests notebook-specific definitions and fallback | confirmed |
| Unknown note values? | Append observed values to effective options without modifying the manifest or existing notes | User asks about unknown values; existing metadata is open-ended | grounded |
| Archive semantics? | Hidden by default, with an explicit hiden boolean and a Sidebar visibility toggle | User follow-up explicitly changes archive visibility | confirmed |
| Configuration surface? | Existing Settings manifest editor locally, repository manifest for GitHub | Existing source capabilities | grounded |

Core ownership and verification rules remain ready; no open consequential decision.

## Website working changes and explicit commits

The user corrects the website save contract: editing saves locally and the
existing floating Commit footer explicitly publishes changes. MCP mutations
continue producing their own remote commits. Core rules remain ready.

| Question | Answer | Basis | Status |
| --- | --- | --- | --- |
| Website remote editing? | Persistent browser working changes, published only through Commit | Explicit user correction | confirmed |
| Local repository editing? | Existing disk autosave and explicit Git commit remain | Existing accepted behavior | grounded |
| Commit granularity? | Selected note changes form one atomic remote commit | Existing file-selection Commit modal and remote atomic tree API | grounded |
| Concurrent remote updates? | Merge against each draft's saved baseline; conflicts retain the draft and require Refresh before editing/commit | Existing user requirement | confirmed |
| welcome.md error? | Full path lists successfully but deployed read returns 403; rewrite capture path collides with the API query | Actual production requests and Vercel named-parameter pass-through contract | grounded |

Reference: https://vercel.com/docs/project-configuration/vercel-json documents
named rewrite parameters passing through in query strings.

### Publish the product and workspace branches

The user identified that the public repository contained only the example workspace, while Vercel deployments uploaded local source directly. Publish a clean product snapshot on `core`, merge it into the existing remote `main`, and connect Vercel to the repository with `core` as its production branch. Preserve the remote workspace manifest and every existing note blob. Retain the old local histories privately because they contain local notes. The local data worktree remains separate from the public example workspace.
