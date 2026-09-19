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
