import { renderNote } from './markdown.js';
import { currentAppearance, renderMermaidBlocks } from './mermaid.js';

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
  .note-mermaid { margin: 0 0 1em; text-align: center; break-inside: avoid; }
  .note-mermaid-error { text-align: left; border: 1px solid currentColor; border-radius: 4px; padding: 0.5em 0.8em; }
  .note-mermaid-error pre { margin: 0.4em 0 0; background: none; padding: 0; }
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

/** The note's printable body: `renderNote` HTML with its diagrams drawn, on the light variant since paper is white. */
export async function renderPrintableNote(content: string, notePath: string, errorLabel?: string): Promise<string> {
  const printable = new DOMParser().parseFromString(renderNote(content, notePath), 'text/html');
  // The print frame has no viewport, so lazy images never approach an intersection threshold.
  for (const image of printable.images) image.removeAttribute('loading');
  await renderMermaidBlocks(printable.body, { ...currentAppearance(), mode: 'light' }, { errorLabel });
  return printable.body.innerHTML;
}

/** Opens the browser's print dialog on the rendered note, where "Save as PDF" produces the file. */
export async function printNoteAsPdf(title: string, content: string, notePath: string, errorLabel?: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const escapedTitle = title.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
  const body = await renderPrintableNote(content, notePath, errorLabel);
  frame.srcdoc = `<!doctype html><html><head><meta charset='utf-8'><title>${escapedTitle}</title><style>${PRINT_STYLE}</style></head><body>${body}</body></html>`;
  const remove = () => frame.remove();
  frame.addEventListener('load', async () => {
    const view = frame.contentWindow;
    if (!view) return remove();
    await Promise.all([...view.document.images].map(image => image.complete
      ? image.decode?.().catch(() => undefined)
      : new Promise<void>(resolve => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        })));
    view.addEventListener('afterprint', remove);
    view.focus();
    view.print();
  });
  document.body.append(frame);
  // Browsers that skip afterprint still release the frame.
  setTimeout(remove, 5 * 60 * 1000);
}
