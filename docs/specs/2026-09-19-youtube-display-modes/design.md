# YouTube display modes design

## Chosen approach

A shared YouTube embed module owns mode parsing, `localStorage`, translated facade/control DOM, mounted-embed synchronization, and inline playback. `renderNote` emits translated markup through that module; the live CodeMirror widget builds the same DOM directly. A document-level playback host owns the live iframe so CodeMirror virtualization cannot destroy it, while the rendered-note hook delegates actions at `WorkspaceLinks`.

## Interfaces and data flow

1. Rendering creates `.note-youtube-embed` with video metadata and mode controls.
2. Initialization reads the viewer preference and applies `data-youtube-mode`.
3. A mode button writes the preference and dispatches a window event; every mounted embed reapplies the mode.
4. Poster activation installs an inline iframe without changing the selected size.
5. Copy delegates to the shared clipboard helper, preferring `data-youtube-source-url` and generating a canonical timestamped URL only when source text is unavailable.

## Precedent and trade-offs

- `LiveMarkdownTable.ts` supplies the compact control and viewer-preference precedent.
- `use-note-youtube-embed.ts` remains the rendered-content delegation boundary.
- A DOM-oriented shared module fits both imperative CodeMirror widgets and sanitized rendered HTML without introducing a second React tree per embed.

## Verification method

Unit tests cover storage/synchronization, mode markup, and inline activation. Project tests, build, check scripts, `qa-live-editor`, `qa-mobile`, and the contract browser matrix provide separate evidence.

## Friction Notes

- Tried: Read `apps/web/src/components/LiveMarkdownTable.tsx` from the contract's approximate filename.
  Found: The component is implemented in `LiveMarkdownTable.ts`.
  Led by: Dispatch contract
- Tried: Run focused Vitest files directly before building workspace packages.
  Found: Direct Vitest cannot resolve the unbuilt `@mygitnotes/core` package, and the existing hook test stubs do not provide new storage/window collaborators.
  Led by: AAAAV Verify evidence-first loop
- Tried: Run `qa-live-editor` after the web production build.
  Found: The QA script imports `apps/local-server/dist/app.js`, which requires a separate local-server build.
  Led by: Dispatch contract verification command
- Tried: Wait for layout with `requestAnimationFrame` in the Node side of the Puppeteer script.
  Found: Animation-frame waits must execute through `page.evaluate` in the browser context.
  Led by: agent-browser browser-context model
- Tried: Apply the generic embed width directly inside the live CodeMirror block widget.
  Found: Live text lines carry the text-column inset as 40px desktop and 16px mobile line padding, while block widgets start at the content edge; live embeds must apply the same inset on both sides.
  Led by: Dispatch alignment requirement
- Tried: Rerun QA after changing source CSS without rebuilding the web bundle.
  Found: The QA local server serves `apps/web/dist`, so browser evidence reflects the last web build rather than current source until `@mygitnotes/web` is rebuilt.
  Led by: Dispatch browser verification loop
- Tried: Type-check a clipboard spy declared without arguments while later inspecting its first call argument.
  Found: Vitest infers an empty argument tuple unless the spy callback declares the copied string parameter.
  Led by: AAAAV Verify build check
- Tried: Restore a virtualized editor to the top by assigning its scroll position while the selection remained at the document end.
  Found: CodeMirror restores the selected range into view; moving the caret to document start is the stable way to remount top widgets before subsequent QA steps.
  Led by: Dispatch virtualization proof
- Tried: Assert the rendered heading while the restored caret selected that heading's source line.
  Found: Live preview intentionally exposes Markdown source for the active block; the caret must move to the following paragraph before asserting the heading widget.
  Led by: Existing live-preview active-block contract
