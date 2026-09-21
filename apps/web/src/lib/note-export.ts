import { renderNote } from './markdown.js';

const PRINT_STYLE = `
  body { margin: 0; padding: 0; font: 11pt/1.6 -apple-system, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif; color: CanvasText; }
  h1, h2, h3, h4 { line-height: 1.3; break-after: avoid; }
  img, svg, video { max-width: 100%; height: auto; }
  pre, blockquote, table, figure { break-inside: avoid; }
  pre { padding: 0.6em 0.8em; background: color-mix(in srgb, currentColor 8%, transparent); border-radius: 4px; white-space: pre-wrap; word-break: break-word; font: 9.5pt/1.5 ui-monospace, Menlo, monospace; }
  code { font-family: ui-monospace, Menlo, monospace; }
  blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid color-mix(in srgb, currentColor 30%, transparent); opacity: 0.85; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid color-mix(in srgb, currentColor 35%, transparent); padding: 0.3em 0.6em; text-align: left; }
  a { color: inherit; }
  .markdown-table-scroll { overflow: visible; }
  @page { margin: 18mm; }
`;

/** Saves text as a file through a temporary link. */
export function downloadTextFile(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the browser's print dialog on the rendered note, where "Save as PDF" produces the file. */
export function printNoteAsPdf(title: string, content: string, notePath: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const escapedTitle = title.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
  frame.srcdoc = `<!doctype html><html><head><meta charset='utf-8'><title>${escapedTitle}</title><style>${PRINT_STYLE}</style></head><body>${renderNote(content, notePath)}</body></html>`;
  const remove = () => frame.remove();
  frame.addEventListener('load', () => {
    const view = frame.contentWindow;
    if (!view) return remove();
    view.addEventListener('afterprint', remove);
    view.focus();
    view.print();
  });
  document.body.append(frame);
  // Browsers that skip afterprint still release the frame.
  setTimeout(remove, 5 * 60 * 1000);
}
