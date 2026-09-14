# Demo and starter workspace

This directory is the canonical source for the public main workspace and newly bootstrapped workspaces. Maintain examples and tutorials here on Core, then synchronize the public demo from this directory.

Copy `.github-notes.yaml` to the workspace root and `notes/` to its notes directory. Ordinary `pnpm bootstrap-workspace` copies missing files and preserves existing notes and configuration. Public-demo synchronization is a separate explicit maintenance operation.

The workspace configures two notebooks: `example` (general tutorials and project notes) and `learning` (flashcard and paginated reading demo notes). `notes/learning/` includes `vocabulary.md` for 3-page flashcards and extraction practice. `.github-notes-screen.yaml` defines dedicated study and reading lanes with progressive repetition intervals.

Browser editing saves locally; the Commit footer publishes selected changes. MCP mutations and hosted asset operations create their own commits.

`notes/example/index.md` demonstrates the notebook-root Index card and teaches folder indexes, relative links and visibility. `welcome.md` links to it so the tutorial is also reachable from an ordinary note.
