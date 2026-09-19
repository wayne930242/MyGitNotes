# YouTube display modes verification

## Automated evidence

- `pnpm test`: 153 test files and 1086 tests passed, including theme-color enforcement.
- `pnpm --filter @mygitnotes/web build`: TypeScript and Vite production build passed.
- `node scripts/qa-live-editor.mjs`: mode alignment, reload persistence, source-URL Copy, inline playback, and CodeMirror virtualization continuity passed.
- `node scripts/qa-mobile.mjs`: responsive geometry and interaction regressions passed at 320, 390, 430, 820, and 1440 px.

## Browser anchor

The disposable workspace is `/tmp/github-notes-youtube-modes.buXsi8`. Browser measurements and light/dark screenshots are stored under `/tmp/github-notes-youtube-modes.buXsi8/evidence`.

- At 1440 px, Thumbnail measured 360 px, Medium 640 px, and Theater 800 px; every mode began at the paragraph left edge and Theater ended at the text-column right edge.
- At 390 px, all modes contracted to the 342 px text column with zero horizontal overflow.
- Playing Thumbnail retained the same iframe while the user scrolled until CodeMirror removed the widget, then edited elsewhere.
- Copy preserved `https://youtu.be/dQw4w9WgXcQ?t=45` from note source; canonical fallback coverage verifies `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s`.

## Fresh-context review

The reviewer found three issues: cross-surface duplicate-session targeting, overflow clipping, and storage-failure remount fallback. The implementation now scopes reconnection with a stable unique editor-instance key, clips the persistent host to overflow ancestors, and mirrors the preference in memory. The final re-review reported no actionable findings.
