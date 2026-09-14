# YouTube Embed in Note Markdown — Verification

## Verification Table

| Requirement | Evidence | Result |
|---|---|---|
| Standalone YouTube URLs convert to responsive embed with poster facade | `apps/web/src/lib/markdown.test.ts` ("transforms standalone YouTube watch URL into a responsive embed container with poster facade") | pass |
| Preserves timestamp start parameters (`?t=1m30s`) | `apps/web/src/lib/markdown.test.ts` ("preserves start timestamp from URL query parameters") | pass |
| Standalone bracketed markdown links to YouTube convert to embed | `apps/web/src/lib/markdown.test.ts` ("handles bracketed markdown link containing solely a YouTube URL") | pass |
| Inline YouTube links within paragraph text remain standard hyperlinks | `apps/web/src/lib/markdown.test.ts` ("keeps inline YouTube links within paragraph text as standard hyperlinks") | pass |
| Non-YouTube URLs remain standard hyperlinks | `apps/web/src/lib/markdown.test.ts` ("does not transform non-YouTube URLs into embeds") | pass |
| Click / keyboard activation replaces poster facade with iframe | `apps/web/src/lib/use-note-youtube-embed.test.ts` ("activates and replaces poster with iframe on click", "activates on Enter or Space keydown") | pass |
| LiveMarkdownEditor exposes raw URL on line focus and renders YouTubeWidget when cursor leaves line | `apps/web/src/components/LiveMarkdownEditor.tsx` `YouTubeWidget` and Paragraph iteration logic | pass |
| Full test suite across monorepo passes cleanly | `pnpm test` (62 test files, 332 tests passed) | pass |
| Production build across all packages completes cleanly | `pnpm build` exited 0 | pass |

## Human Appropriateness & Deviations

- **Deviations**: None from the approved specification.
- **Appropriateness**: The facade pattern keeps initial page rendering lightweight and responsive, matching the existing `ScreenCard` behavior while delivering responsive 16:9 embedded video playback.

## Reflexive

- **Friction Gate**: Clean run. The only minor friction encountered was recognizing that `@github-notes/core` should be imported via its submodule `@github-notes/core/screen-page` in `apps/web` to avoid pulling node-only dependencies (`node:crypto`) into Vite's browser bundle.
