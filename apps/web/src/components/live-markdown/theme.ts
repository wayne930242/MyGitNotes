import { EditorView, layer, RectangleMarker } from '@codemirror/view';

// .cm-content is a non-positioned box, so it always paints above drawSelection()'s
// negative-z-index selection layer, hiding the tint. This layer paints the "card" background
// behind the selection layer instead, so .cm-content itself can stay transparent.
// It must be listed after drawSelection() in the extensions array: CodeMirror z-indexes
// same-"above" layers by their order (later = more negative), so this needs the later slot
// to stay behind the selection layer instead of covering it again.
export const cardBackgroundLayer = layer({
  above: false,
  class: 'cm-card-background-layer',
  update: () => true,
  markers(view) {
    const contentRect = view.contentDOM.getBoundingClientRect();
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const left = contentRect.left - scrollerRect.left + view.scrollDOM.scrollLeft;
    const top = contentRect.top - scrollerRect.top + view.scrollDOM.scrollTop;
    return [new RectangleMarker('cm-card-background', left, top, contentRect.width, contentRect.height)];
  },
});
export const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--color-text)', backgroundColor: 'var(--color-bg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.8', backgroundColor: 'var(--color-bg)', padding: '24px 16px' },
  // The horizontal inset lives on .cm-line (not .cm-content) because CodeMirror's own
  // selection-rectangle geometry (rectanglesForRange) reads a line's computed padding to
  // find the text edge for whole-line selection spans; padding on .cm-content itself is
  // invisible to that calculation and left the selection tint jutting into the card margin.
  '.cm-content': { padding: '32px 0 0', maxWidth: '880px', margin: '0 auto', minHeight: 'calc(100% - 48px)', width: '100%', caretColor: 'var(--color-primary)' },
  '.cm-card-background': { backgroundColor: 'var(--color-surface)', borderRadius: '4px', boxShadow: '0 1px 4px 0 color-mix(in srgb, var(--color-scrim) 8%, transparent), 0 0 0 1px var(--workspace-divider)' },
  '.cm-line': { padding: '0 40px' },
  '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--color-border)', touchAction: 'none', WebkitTouchCallout: 'none' },
  '.cm-lineNumbers': { color: 'var(--color-muted)', fontFamily: 'monospace', fontSize: '11px', opacity: '0.55' },
  '.cm-lineNumbers .cm-gutterElement': { paddingLeft: '8px', paddingRight: '10px', transformOrigin: 'right center', transition: 'color 150ms, transform 150ms, font-weight 150ms' },
  '.cm-lineNumbers .cm-gutterElement:hover': { backgroundColor: 'color-mix(in srgb, var(--color-text) 6%, transparent)', color: 'var(--color-text)' },
  '.cm-lineNumbers .cm-gutterElement.cm-line-copy-selected': { backgroundColor: 'color-mix(in srgb, var(--color-text) 12%, transparent)', color: 'var(--color-text)' },
  '.cm-lineNumbers .cm-activeLineGutter': { color: 'var(--color-primary)', fontWeight: '700', transform: 'scale(1.08)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--color-selection) !important' },
  // CodeMirror's own hideNativeSelection theme makes the native ::selection background
  // transparent (so our .cm-selectionBackground layer shows through) but leaves its text
  // colour alone, which browsers default to a light system colour (e.g. HighlightText) —
  // illegible against our tint. `::selection` inherits from an ancestor's ::selection rule,
  // not from the originating element's own `color`, so `color: inherit` would still resolve
  // to that system default; set the normal text colour explicitly instead, per element type.
  '.cm-line ::selection, .cm-line::selection': { color: 'var(--color-text)' },
  '.live-md-link::selection, .live-md-link *::selection, .live-md-url::selection': { color: 'var(--color-link)' },
  '.live-md-quote::selection, .live-md-quote *::selection': { color: 'var(--color-muted)' },
  '.live-md-heading': { fontWeight: '700', lineHeight: '1.4', paddingTop: '12px', paddingBottom: '8px' },
  '.live-md-heading span': { textDecoration: 'none' },
  '.live-md-h1': { fontSize: '1.85em' },
  '.live-md-h2': { fontSize: '1.5em' },
  '.live-md-h3': { fontSize: '1.25em' },
  '.live-md-strong': { fontWeight: '700' },
  '.live-md-emphasis': { fontStyle: 'italic' },
  '.live-md-strike': { textDecoration: 'line-through' },
  '.live-md-link, .live-md-link span, .live-md-url': { color: 'var(--color-link)', textDecoration: 'underline' },
  '.live-md-hr': { color: 'var(--color-text)' },
  '.live-md-code': { fontFamily: 'monospace', backgroundColor: 'var(--color-code-bg)', borderRadius: '4px' },
  // Both sides are explicit (not just the extra indent) because .live-md-codeblock is a .cm-line
  // and would otherwise fall back to .cm-line's own padding for whichever side it doesn't set —
  // now that .cm-line carries the full 40px card inset (previously .cm-content did), leaving
  // paddingRight unset would collapse only the left side, jamming the block against the card edge.
  '.live-md-codeblock': { fontFamily: 'monospace', backgroundColor: 'var(--color-code-bg)', paddingLeft: '54px', paddingRight: '42px' },
  // paddingLeft (38px) + borderLeft (2px) = .cm-line's own 40px inset, so the border hangs at
  // the card's left edge while the quote text lands flush with a plain paragraph line's text.
  // Nesting adds a readable step per level via --quote-depth (set per line in liveDecorations).
  '.live-md-quote': { position: 'relative', borderLeft: '2px solid color-mix(in srgb, var(--color-text) 22%, var(--color-border))', paddingLeft: 'calc(38px + (var(--quote-depth, 1) - 1) * 16px)', color: 'var(--color-muted)' },
  // The revealed '> ' marker on an active quote line is taken out of the text flow so it
  // doesn't push the line's text further right than the lines around it (see liveDecorations).
  '.live-md-quote-mark-reveal': { position: 'absolute', left: '0' },
  '.live-md-mdx-import-chip': { display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '1px 8px', borderRadius: '4px', fontSize: '0.78em', fontFamily: 'monospace', cursor: 'pointer', backgroundColor: 'color-mix(in srgb, var(--color-text) 4%, var(--color-surface))', color: 'var(--color-muted)', border: '1px solid color-mix(in srgb, var(--color-text) 12%, var(--color-border))', opacity: '0.65', transition: 'opacity 120ms ease' },
  '.live-md-mdx-import-chip:hover': { opacity: '1' },
  '.live-md-mdx-import-chip .mdx-chip-badge': { fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-muted)' },
  '.live-md-mdx-import-chip .mdx-chip-name': { color: 'var(--color-text)', fontWeight: '600' },
  '.live-md-mdx-import-chip .mdx-chip-from': { opacity: '0.75' },
  '.live-md-image-line': { lineHeight: '0', paddingTop: '4px', paddingBottom: '4px' },
  '.live-md-rendered': { display: 'inline-block', maxWidth: '100%', cursor: 'text' },
  '.live-md-rendered p': { margin: '0' },
  '.live-md-rendered img': { maxWidth: '100%', maxHeight: '480px', borderRadius: '8px', margin: '0', cursor: 'zoom-in', display: 'block' },
  '.live-md-image-rendered': { display: 'inline-block', verticalAlign: 'top', lineHeight: '0', whiteSpace: 'normal' },
  '.live-md-image-rendered p': { margin: '0', padding: '0', lineHeight: '0' },
  '.cm-content input[type=checkbox]': { accentColor: 'var(--color-primary)', verticalAlign: 'middle', marginRight: '4px' },
  '.live-md-token-chip': { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0 6px', borderRadius: '999px', fontSize: '0.85em', cursor: 'pointer', backgroundColor: 'var(--color-sidebar)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
  '.live-md-token-editor': { display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '4px', color: 'var(--color-muted)' },
  '.live-md-token-editor input': { fontSize: '0.85em', padding: '1px 4px' },
  '.live-md-token-clear': { cursor: 'pointer', color: 'var(--color-muted)', fontWeight: '700', lineHeight: '1', border: 'none', background: 'none', padding: '0 2px' },
  '.live-md-completion-icon': { display: 'inline-flex', verticalAlign: '-2px', marginRight: '6px', color: 'var(--color-muted)' },
  '.cm-tooltip-autocomplete ul li[aria-selected] .live-md-completion-icon': { color: 'inherit' },
  '.live-md-due-adder': { display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '6px', padding: '0 6px', borderRadius: '999px', fontSize: '0.8em', cursor: 'pointer', color: 'var(--color-muted)', border: '1px dashed var(--color-border)', background: 'none' },
});
