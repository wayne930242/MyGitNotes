# YouTube Embed in Note Markdown — Decision

Outcome: Enable standalone YouTube links inside note Markdown to render as responsive, interactive embedded players in both the reading preview and the live editor.

Actors: Note readers and writers using desktop and mobile devices.

## Scope

- **In scope**:
  - Recognizing standalone YouTube URLs in Markdown content (paragraphs consisting solely of a valid YouTube URL or autolink).
  - Rendering a responsive 16:9 embedded player container with poster thumbnail and play button (Facade mode) in `renderNote`.
  - On play interaction, mounting the official `youtube-nocookie.com/embed/<videoId>` iframe with autoplay and start-time support.
  - In `LiveMarkdownEditor`, replacing the standalone YouTube link line with a live YouTube widget when not currently editing that line, and revealing the raw URL when the cursor focuses that line.
  - Safe sanitization via DOMPurify preserving the YouTube player container / iframe without opening security vectors to arbitrary untrusted iframes.
- **Out of scope**:
  - Inline links embedded within prose text (e.g. `See [video](url) here`) remain standard hyperlink anchors.
  - Video hosting platforms other than YouTube (e.g. Vimeo, Bilibili) are not handled in this pass.

## Decision Matrix

| Question | Answer | Basis | Status |
|---|---|---|---|
| What triggers a YouTube embed in Markdown? | A standalone line or paragraph containing solely a valid YouTube URL (bare URL or autolink). | User confirmed recommended approach in dialogue; standard practice (Notion, GitHub, Discord). | confirmed |
| Should embedded players load iframes immediately or use a poster facade? | Use a poster thumbnail facade with play button, loading the iframe on demand. | ScreenCard precedent, performance preservation for long notes, user agreement in previous turn. | confirmed |
| What is the editing behavior in LiveMarkdownEditor? | Cursor on line exposes raw Markdown URL; cursor off line renders the interactive embed widget. | Precedent of Image, Table, and PageBreak widgets in LiveMarkdownEditor. | confirmed |
| How are timestamps handled? | Supported via `parseYouTubeUrl` extracting `?t=` or `?start=` and passing `start=<seconds>` to embed iframe. | Core `screen-page.ts` parser reuse. | confirmed |
| What privacy domain is used for iframes? | `https://www.youtube-nocookie.com/embed/<videoId>` | Existing ScreenCard precedent. | confirmed |
| How is security ensured in DOMPurify? | Allow `div[data-youtube-embed]`, `iframe` restricted to `youtube-nocookie.com`, or render container with delegated click. | Security invariants in `docs/agent/security/index.md`. | confirmed |
