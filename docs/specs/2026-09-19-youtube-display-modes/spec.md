Status: approved
Approved at: 2026-09-19
Approved from: "Begin contract task."

# YouTube display modes specification

## Observable behavior

- Every in-note YouTube embed exposes a compact keyboard- and touch-reachable control for Thumbnail, medium, and theater modes.
- Thumbnail is the compact music-player-style default, aligns with paragraph text, and plays inline. Playback continues while the viewer scrolls, reads, or edits elsewhere, including while CodeMirror drops the widget outside its viewport.
- Medium is approximately the previous 640px maximum width, aligns with paragraph text, and plays inline.
- Theater fills the text column at 16:9, aligns both edges with that column, and plays inline.
- One `localStorage` preference applies to every embed. Changing one control updates mounted embeds and survives reload without changing Markdown.
- Every embed has a keyboard- and touch-reachable Copy control beside its mode controls. It copies the URL exactly as written in the note when available, otherwise a canonical YouTube watch URL with its start time, and shows copied or failed icon feedback for two seconds.
- Visible strings and existing player labels use English and natural Traditional Chinese translations.
- At 390px all modes fit the text column without horizontal scrolling. Selected state uses text, weight, or background rather than an edge accent.

## Compatibility and edge cases

- Existing accepted YouTube URLs, start times, MDX YouTube components, and `youtube-nocookie.com` playback remain supported.
- A blocked or unavailable `localStorage` starts at thumbnail and retains later mode choices for the current page session.
- The standalone Screen YouTube card is unchanged.

## Applied standards

- Theme colors use existing CSS custom-property tokens.
- Controls expose labels and pressed state.
- The implementation follows the existing `github-notes:table-width` viewer-preference precedent and native-dialog lightbox precedent.

## Reality anchor

After committing, run local mode against a fresh disposable copy of `examples/demo-workspace` on ports 3165 and 3195. At 390px and 1440px in light and dark palettes, exercise every surface and mode, measure text-column alignment within 1px, play video inline at the selected size, and verify synchronization and persistence after reload. Save absolute screenshot and measurement paths in the scratchpad.
