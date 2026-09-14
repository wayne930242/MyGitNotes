# Note editor search and outline design

The note editor owns the feature because it already owns the live draft content and both Live and Source editing modes.

- A small pure module parses headings and computes text ranges. This keeps Markdown interpretation and search arithmetic independently testable.
- `MarkdownEditorHandle` exposes narrow `revealRange`, `goToLine`, and `getCurrentLine` methods. Live and Source adapters translate these requests to their own selection, viewport, and scrolling primitives, leaving viewport interpretation behind the existing editor seam.
- `EditorModal` owns one mutually exclusive `find | outline | frontmatter | assets | git | null` panel state, search query/result state, outline selection, keyboard priority, and toolbar controls. This avoids competing drawers and modals and keeps all document utilities at one right-side boundary.
- Opening Outline asks the editor adapter for its current visible line, maps that line to the nearest preceding heading, renders that row as active, and focuses only the outline row. Scrolling is an explicit consequence of `J/K`, arrows, Enter, or pointer activation, never of panel mount.
- `AssetLibrary` remains the existing deep asset implementation and is composed into the Assets tab. Only its outer placement changes; the full-size preview remains its own modal layer.
- The Git tab reuses the editor's authoritative dirty/save state and existing `onRestoreFile` callback. It does not add history, whole-workspace reset, or a second Git model.
- Desktop and tablet dock the panel; the narrow mobile adapter overlays the same panel from the right and retains its tab strip, matching Craft's platform distinction without introducing separate feature logic.
- The application shell passes an editor-open suspension flag to Header and KeyboardShortcuts so background navigation cannot interrupt editing.

No new editor dependency is needed. Search uses the current draft string, avoiding a second document model and keeping Live and Source behavior consistent.

The rejected alternative was to keep three independent horizontal/side surfaces. It preserved fewer code changes but continued to move the document vertically, duplicated close and responsive rules, and could display conflicting states. The single panel increases locality and gives one testable responsive seam.
