# YouTube Embed in Note Markdown — Design

## Chosen Approach

1. **Detection & Markdown Parsing**:
   - In `apps/web/src/lib/markdown.ts`, scan top-level `<p>` elements in the parsed DOM.
   - When a paragraph contains solely a valid YouTube URL (bare or in `<...>`), convert it into a `.note-youtube-embed` container with a `.note-youtube-poster` button, fallback poster image (`https://img.youtube.com/vi/<videoId>/hqdefault.jpg`), and SVG play button.
   - Configure `DOMPurify` to allow `.note-youtube-embed` attributes (`data-video-id`, `data-start`) and safe iframes.

2. **Reading View Interaction (Facade -> Iframe)**:
   - Introduce `useNoteYouTubeEmbed` in `apps/web/src/lib/use-note-youtube-embed.ts` and attach to `WorkspaceLinks`'s root surface (identical pattern to `useAltWheelHorizontalScroll`).
   - Clicking or pressing Enter/Space on `.note-youtube-poster` replaces the container's contents with the official `youtube-nocookie.com/embed/<videoId>` iframe, setting `autoplay=1` and start time.

3. **Live Editor Widget**:
   - In `apps/web/src/components/LiveMarkdownEditor.tsx`, detect `Paragraph` syntax tree nodes whose trimmed text matches `parseYouTubeUrl`.
   - When the user's cursor is on that paragraph (`editing === true`), leave it unreplaced so the user can freely edit the URL text.
   - When the cursor is elsewhere (`editing === false`), replace the node with `YouTubeWidget` displaying the interactive facade container.
   - Clicking the play button inside the widget plays the video in-place; clicking outside the play button moves the editor selection to that line.

4. **Styling**:
   - In `apps/web/src/workspace.css`, add responsive 16:9 container rules, hover transitions on the poster/play button, and full-bleed iframe styling.

## Interfaces and Seams

- Reuses `parseYouTubeUrl` from `@github-notes/core/screen-page`.
- Seamlessly integrates with `DOMPurify` and `marked` in `apps/web/src/lib/markdown.ts`.
- Pure hook `useNoteYouTubeEmbed` with delegated event capture in `apps/web/src/components/WorkspaceLinks.tsx`.

## Reality Anchor Checkpoint

- Automated vitest tests in `apps/web/src/lib/markdown.test.ts` checking standalone URLs, paragraph-embedded links, query parameters (`?t=`), and sanitization.
- Automated tests in `apps/web/src/lib/use-note-youtube-embed.test.ts` checking activation of poster to iframe.
- Full monorepo verification: `pnpm test` and `pnpm build`.
