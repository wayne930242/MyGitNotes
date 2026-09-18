# Demo and starter workspace

This directory is the canonical source for the public main workspace and newly bootstrapped workspaces. Maintain examples and tutorials here on Core, then synchronize the public demo from this directory.

Copy `.mygitnotes.yaml` to the workspace root and `notes/` to its notes directory. Ordinary `pnpm bootstrap-workspace` copies missing files and preserves existing notes and configuration. Public-demo synchronization is a separate explicit maintenance operation.

The workspace configures two notebooks: `example` (general tutorials and project notes) and `learning` (flashcard and paginated reading demo notes). `notes/learning/` includes `vocabulary.md` for 3-page flashcards and extraction practice. `.github-notes-screen.yaml` defines dedicated study and reading lanes with progressive repetition intervals. Each lane belongs to one notebook: Screen shows the graph and media lanes under `example` and the study lanes under `learning`.

Browser editing saves locally; the Changes panel publishes selected changes. MCP mutations and hosted asset operations create their own commits.

## Graph and media examples

Start with `notes/example/graph-playground.md`. Four additional swimlanes demonstrate editable graph nodes, mixed media, dated tasks, and a dynamic project folder. `todo-demo.md` includes overdue, today, future, undated, and completed tasks using September 15, 2026 as the reference day, and its start dates fill the to-do tool's Gantt view; adjust those dates for later testing.

The two sample illustrations in `notes/example/assets/` were generated with the built-in image generation tool. Prompts describe a watercolor riverside reading desk and a gouache evening desk beside a rainy window, both without text or logos. `music-resources.md` links to Rick Astley's official “Never Gonna Give You Up” video.

`notes/example/index.md` demonstrates the notebook-root Index card and teaches folder indexes, relative links and visibility. `welcome.md` links to it so the tutorial is also reachable from an ordinary note.
