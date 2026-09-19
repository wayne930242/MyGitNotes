# YouTube display modes decision

## Outcome and actors

Viewers can choose one display mode for every YouTube embed in note content. The choice belongs to the viewer and is not note content.

## Scope

- Live Markdown preview widgets.
- Rendered note views reached through `renderNote`, including read views, Focus panes, graph cards, and rendered Screen note cards.
- The standalone Screen YouTube card remains unchanged.

## Decision tree

| Question | Answer | Basis | Status |
|---|---|---|---|
| Which modes exist? | Compact Thumbnail, medium at about the previous 640px maximum, and theater at full text-column width; Thumbnail is the default. | User revision through main agent | confirmed |
| Where is the choice stored? | One viewer preference in `localStorage`, shared by all embeds and omitted from Markdown. | Dispatch contract and table-width precedent | confirmed |
| How do mounted embeds stay synchronized? | A shared browser event updates every mounted embed after the preference changes. | Required immediate cross-embed update | grounded |
| How does playback work? | Every mode plays inline at its selected size. There is no video lightbox. | User revision through main agent | confirmed |
| What happens when CodeMirror virtualizes the compact widget? | The playing iframe stays owned by a persistent document-level host and reconnects visually when the widget remounts, so reading or editing elsewhere does not stop playback. | User revision through main agent | confirmed |
| Which Screen behavior is excluded? | The standalone `item.kind === 'youtube'` card stays unchanged. Rendered note cards remain included. | Dispatch contract and `ScreenCard.tsx` | grounded |
| Are any observable decisions open? | No. | The dispatch contract specifies modes, behavior, persistence, surfaces, accessibility, responsive behavior, and verification. | confirmed |

## Core rules readiness

The existing theme-token, i18n, table-width preference, rendered-note delegation, and image-lightbox patterns cover the required implementation. No new public API or note-format contract is needed.
