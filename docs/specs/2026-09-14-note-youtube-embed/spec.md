# YouTube Embed in Note Markdown — Specification

Status: approved
Approved at: 2026-09-14
Approved from: 好

## Observable Contract

1. **Detection**:
   - In Markdown content, any paragraph or line consisting solely of a valid YouTube URL (e.g. `https://www.youtube.com/watch?v=...`, `https://youtu.be/...`, `https://www.youtube.com/shorts/...`, or wrapped in `<...>`) is recognized as an embeddable YouTube video.
   - Any YouTube link embedded inside surrounding text (e.g. `Here is the link: https://youtu.be/...` or `[watch](https://...)`) remains an ordinary hyperlink opening in a new tab.

2. **Reading / Preview View (`renderNote`)**:
   - A standalone YouTube link renders as a responsive 16:9 container (`.note-youtube-embed`).
   - Initially displays a video poster facade with YouTube thumbnail (`https://img.youtube.com/vi/<videoId>/hqdefault.jpg`), title fallback, and a centered play button.
   - Activating the play button (click or Enter/Space on keyboard) mounts the embedded iframe:
     `https://www.youtube-nocookie.com/embed/<videoId>?start=<start>&autoplay=1&playsinline=1&rel=0`
   - Preserves timestamps (`?t=1m30s` or `?start=90`).
   - Does not break DOMPurify sanitization.

3. **Live Editor View (`LiveMarkdownEditor`)**:
   - When the cursor is on the line containing the standalone YouTube URL, the editor displays the raw text URL for editing.
   - When the cursor moves off the line, the line is replaced with an interactive YouTube widget showing the video preview / player.
   - Clicking within the widget without activating the play button focuses the editor at that line to allow editing.

4. **Style and Responsiveness**:
   - The embed container has a maximum width matching the prose column (or max 640px/100% width) and maintains a 16:9 aspect ratio.
   - Matches both light and dark themes with rounded corners and consistent hover states.

## Edge Cases and Compatibility

- Multiple standalone YouTube links in the same note each render their own independent facade and player.
- Invalid YouTube URLs or malformed video IDs fall back to standard external links.
- Notes exported or viewed in raw source mode retain pristine Markdown URLs without proprietary wrappers or tags.
- Non-YouTube media links are unaffected.

## Applied Standards and Precedents

- ScreenCard precedent: [`apps/web/src/components/ScreenCard.tsx`](file:///Users/weihung/projects/github-notes/apps/web/src/components/ScreenCard.tsx#L53-L57) uses `youtube-nocookie.com/embed/` and on-demand facade poster.
- Parser precedent: [`parseYouTubeUrl`](file:///Users/weihung/projects/github-notes/packages/core/src/screen-page.ts#L66-L81) in `@github-notes/core`.
- LiveMarkdownEditor widget precedent: Table, Image, and PageBreak widgets in [`apps/web/src/components/LiveMarkdownEditor.tsx`](file:///Users/weihung/projects/github-notes/apps/web/src/components/LiveMarkdownEditor.tsx).

## Selected Reality Anchor and Checkpoint

- Automated unit tests in `apps/web` exercising `renderNote` output for standalone YouTube URLs, inline YouTube links, timestamped URLs, and invalid URLs.
- Manual / headless browser verification of live editing expansion/collapse and poster-to-iframe transition.
