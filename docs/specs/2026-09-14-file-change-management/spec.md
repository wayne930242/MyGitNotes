# File change management

Requested on 2026-09-14: expose per-file review, staging and restore from the workspace footer, and enable Agent restore only for the selected restorable file.

## Contract

- The pending-count control and Commit button open one responsive Changes manager. Each file has a status, per-file diff, stage/unstage and confirmed restore actions.
- Local mode uses the real Git index. A file edited after staging appears in both groups; committing uses the staged snapshot and leaves subsequent working edits intact.
- Remote mode selects browser working drafts for the existing revision-aware commit operation. Its grouping is labeled Included in commit, because it has no local Git index.
- Restore affects exactly the named file. A tracked file restores both its index and working copy from HEAD; a new file is explicitly discarded. Local restore retains a copy under the repository's Git directory and displays its location.
- Changes reviewed before an intervening file/index/HEAD change are rejected rather than discarded. Protected files, directories, symlinks and unresolved conflicts cannot be mutated through the manager.
- Agent restore is enabled only for an editable, locally changed file with a committed version and no save in progress. Direct-URL Note restore uses the routed file's status.
- Existing selected-file save/commit operations must not include unrelated pre-staged files.

## Design and evidence

Git operations live in `packages/git/src/change-management.ts`, behind per-repository serialization and exact literal file targets. The local HTTP adapter applies existing workspace resource guards. `CommitModal` owns review/confirmation; the application refreshes notes, Agent content and Screen state after successful changes. Remote notes use their existing browser-draft and revision-aware commit adapter.

Correctness is proved through real temporary Git repositories, guarded HTTP tests, and production-browser tests for direct links, unchanged Agent files beside dirty notes, per-file working/index diffs, confirmed discard, mobile layout, and isolated commits. No real workspace note is changed by QA.

Applied project contracts: `AGENTS.md`, `docs/agent/workflows/index.md`, and the existing document-panel specification. Protected/conflicted repository changes remain visible but require repository tooling.
