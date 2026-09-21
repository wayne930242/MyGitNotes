import type { PaletteMode, PaletteVariant } from './palettes.js';
import { getFamily, resolveMode } from './themes.js';

export const MERMAID_BLOCK_SELECTOR = '.note-mermaid';

export interface MermaidAppearance {
  familyId: string;
  mode: PaletteMode;
}

export type MermaidResult = { ok: true; svg: string; } | { ok: false; message: string; };

export interface MermaidOptions {
  /** Heading shown above a diagram's error message. */
  errorLabel?: string;
  /** Runs after each diagram settles, so a host can re-measure its layout. */
  onSettled?: () => void;
}

export interface MermaidFence {
  open: string;
  source: string;
  close: string;
}

/** Blends an `#rrggbbaa` palette colour over its backdrop; Mermaid derives shades with colour maths that expect opaque hex. */
function opaque(color: string, backdrop: string): string {
  if (color.length !== 9) return color;
  const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const alpha = parseInt(color.slice(7), 16) / 255;
  const over = channels(backdrop);
  return `#${channels(color).map((value, index) => Math.round(value * alpha + over[index] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

/** Mermaid's theming engine accepts hex only, so every value comes from a palette variant, flattened to opaque hex. */
export function mermaidThemeVariables(variant: PaletteVariant, fontFamily: string): Record<string, string> {
  const code = opaque(variant.codeBackground, variant.background);
  const [accent1, accent2, accent3, accent4, accent5, accent6] = variant.accents;
  return { fontFamily, background: variant.background, textColor: variant.text, lineColor: variant.muted, primaryColor: variant.background, primaryTextColor: variant.text, primaryBorderColor: variant.primary, secondaryColor: code, secondaryTextColor: variant.text, secondaryBorderColor: variant.border, tertiaryColor: variant.sidebar, tertiaryTextColor: variant.text, tertiaryBorderColor: variant.border, mainBkg: variant.background, nodeBorder: variant.primary, nodeTextColor: variant.text, clusterBkg: code, clusterBorder: variant.border, titleColor: variant.text, edgeLabelBackground: variant.surface, labelBackground: variant.surface, labelTextColor: variant.text, noteBkgColor: code, noteTextColor: variant.text, noteBorderColor: variant.border, actorBkg: variant.background, actorBorder: variant.primary, actorTextColor: variant.text, actorLineColor: variant.muted, signalColor: variant.muted, signalTextColor: variant.text, labelBoxBkgColor: variant.surface, labelBoxBorderColor: variant.border, activationBkgColor: code, activationBorderColor: variant.primary, sequenceNumberColor: variant.background, errorBkgColor: variant.danger, errorTextColor: variant.text, pie1: accent1, pie2: accent2, pie3: accent3, pie4: accent4, pie5: accent5, pie6: accent6, pieTitleTextColor: variant.text, pieSectionTextColor: variant.background, pieLegendTextColor: variant.text, pieStrokeColor: variant.surface, pieOuterStrokeColor: variant.border };
}

/** The palette family and mode the app is showing, as `applyTheme` published them on the root element. */
export function currentAppearance(): MermaidAppearance {
  const root = document.documentElement;
  const mode = root.getAttribute('data-theme-mode');
  return { familyId: getFamily(root.getAttribute('data-theme') ?? '').id, mode: mode === 'light' || mode === 'dark' ? mode : resolveMode('system') };
}

/** Splits a fenced code block into its opening line, body and closing line. */
export function parseMermaidFence(text: string): MermaidFence {
  const lines = text.split('\n');
  const open = lines[0];
  const marker = /^\s*(`{3,}|~{3,})/.exec(open)?.[1];
  const last = lines.length > 1 ? lines[lines.length - 1] : '';
  const closed = Boolean(marker) && new RegExp(`^\\s*\\${marker![0]}{${marker!.length},}\\s*$`).test(last);
  return { open, source: lines.slice(1, closed ? -1 : undefined).join('\n'), close: closed ? last : marker ?? '```' };
}

/** Writes a diagram's new source back between the fence's opening and closing lines. */
export function replaceMermaidSource(fenceText: string, source: string): string {
  const fence = parseMermaidFence(fenceText);
  return [fence.open, ...(source.replace(/\n+$/, '') ? [source.replace(/\n+$/, '')] : []), fence.close].join('\n');
}

export function isMermaidInfo(info: string): boolean {
  return info.trim().split(/\s+/, 1)[0].toLowerCase() === 'mermaid';
}

/** The placeholder a `mermaid` fence renders to; the diagram itself is drawn after the HTML is mounted. */
export function createMermaidBlock(source: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'note-mermaid';
  block.dataset.mermaidSource = source;
  const pre = document.createElement('pre');
  pre.textContent = source;
  block.append(pre);
  return block;
}

const RESULT_LIMIT = 60;
const results = new Map<string, MermaidResult>();
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

function resultKey(source: string, appearance: MermaidAppearance): string {
  return `${appearance.familyId}\u0000${appearance.mode}\u0000${source}`;
}

function cached(source: string, appearance: MermaidAppearance): MermaidResult | undefined {
  const key = resultKey(source, appearance);
  const hit = results.get(key);
  if (hit) {
    results.delete(key);
    results.set(key, hit);
  }
  return hit;
}

/** Renders one diagram. Mermaid's configuration is global, so renders run one at a time under their own theme. */
export function renderMermaid(source: string, appearance: MermaidAppearance): Promise<MermaidResult> {
  const hit = cached(source, appearance);
  if (hit) return Promise.resolve(hit);
  const run = queue.then(async (): Promise<MermaidResult> => {
    const id = `mermaid-diagram-${++counter}`;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    try {
      // Labels are sized from measured text, so the font faces covering this diagram's characters load first.
      await document.fonts?.load(`16px ${fontFamily}`, source);
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', look: 'classic', fontFamily, flowchart: { wrappingWidth: 400 }, themeVariables: mermaidThemeVariables(getFamily(appearance.familyId).variants[appearance.mode], fontFamily) });
      const { svg } = await mermaid.render(id, source);
      return { ok: true, svg };
    } catch (error) {
      document.getElementById(`d${id}`)?.remove();
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  queue = run;
  return run.then(result => {
    results.set(resultKey(source, appearance), result);
    if (results.size > RESULT_LIMIT) results.delete(results.keys().next().value!);
    return result;
  });
}

function showResult(block: HTMLElement, result: MermaidResult, options: MermaidOptions): void {
  block.classList.toggle('note-mermaid-failed', !result.ok);
  block.classList.add('note-mermaid-rendered');
  if (result.ok) {
    const canvas = document.createElement('div');
    canvas.className = 'note-mermaid-canvas';
    canvas.innerHTML = result.svg;
    block.replaceChildren(canvas);
    return;
  }
  const error = document.createElement('div');
  error.className = 'note-mermaid-error';
  error.setAttribute('role', 'alert');
  const heading = document.createElement('strong');
  heading.textContent = options.errorLabel ?? 'Diagram could not be rendered';
  const message = document.createElement('pre');
  message.textContent = result.message;
  error.append(heading, message);
  block.replaceChildren(error);
}

const latest = new WeakMap<HTMLElement, number>();

/** Draws one placeholder from its source; a render superseded by a newer one is dropped. */
export async function renderMermaidBlock(block: HTMLElement, appearance: MermaidAppearance, options: MermaidOptions = {}): Promise<void> {
  const ticket = (latest.get(block) ?? 0) + 1;
  latest.set(block, ticket);
  // The first draw reads the source from the placeholder's <pre>; later draws, and the editor's live preview, use the dataset.
  block.dataset.mermaidSource ??= block.querySelector('pre')?.textContent ?? '';
  const source = block.dataset.mermaidSource;
  const result = await renderMermaid(source, appearance);
  if (latest.get(block) !== ticket) return;
  showResult(block, result, options);
  options.onSettled?.();
}

/** Draws every diagram under `root` and resolves once all of them are in place. */
export async function renderMermaidBlocks(root: ParentNode, appearance: MermaidAppearance, options: MermaidOptions = {}): Promise<void> {
  await Promise.all([...root.querySelectorAll<HTMLElement>(MERMAID_BLOCK_SELECTOR)].map(block => renderMermaidBlock(block, appearance, options)));
}

/** Draws the diagrams under `root` and redraws them when the palette family or light/dark mode changes. */
export function hydrateMermaid(root: ParentNode, options: MermaidOptions = {}): () => void {
  if (!root.querySelector(MERMAID_BLOCK_SELECTOR)) return () => undefined;
  const draw = () => void renderMermaidBlocks(root, currentAppearance(), options);
  draw();
  const observer = new MutationObserver(draw);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-mode'] });
  return () => observer.disconnect();
}
