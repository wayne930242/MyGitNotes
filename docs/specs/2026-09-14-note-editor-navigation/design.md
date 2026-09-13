# Note editor search and outline design

The note editor owns the feature because it already owns the live draft content and both Live and Source editing modes.

- A small pure module parses headings and computes text ranges. This keeps Markdown interpretation and search arithmetic independently testable.
- `MarkdownEditorHandle` gains narrow `revealRange` and `goToLine` methods. Each editor implementation translates those requests to its own selection and scrolling primitives.
- `EditorModal` owns search query/result state, outline visibility, keyboard priority, and toolbar controls. Its local, persistent leader surface maps `F` to search and `/` to outline without intercepting browser Find.
- The application shell passes an editor-open suspension flag to Header and KeyboardShortcuts so background navigation cannot interrupt editing.

No new editor dependency is needed. Search uses the current draft string, avoiding a second document model and keeping Live and Source behavior consistent.
