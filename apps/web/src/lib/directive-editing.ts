/** Editor-side directive support: insertion templates, block discovery and the structured directive model. */

import type { TranslationKey } from './i18n/en.js';
import { type DirectiveTranslate, matchDirectiveClose, parseDirectiveOpen } from './directives.js';

export interface DirectiveTemplate {
  type: string;
  label: string;
  defaultSnippet: string;
}

export const DIRECTIVE_TEMPLATES: DirectiveTemplate[] = [{ type: 'info', label: '資訊 (Info)', defaultSnippet: ':::info\n在此輸入資訊內容\n:::\n' }, { type: 'sidebar', label: '重點區塊 (Sidebar)', defaultSnippet: ':::sidebar[重要提示]\n在此輸入重點內容\n:::\n' }, { type: 'optional', label: '摺疊細節 (Optional)', defaultSnippet: ':::optional[點擊展開詳細內容]\n收合的細節說明...\n:::\n' }, { type: 'comment', label: '旁註 (Comment)', defaultSnippet: ':::comment\n在此輸入補充註記\n:::\n' }, { type: 'handout', label: '文件卡片 (Document)', defaultSnippet: ':::handout{id="DOC-01" title="文件標題" variant="report" keeper="編輯備註"}\n在此輸入文件內容。\n:::\n' }, { type: 'coc-stat', label: '屬性資料卡 (Stats)', defaultSnippet: ':::coc-stat{name="人物名稱" str=50 con=60 siz=65 dex=70 int=75 app=50 pow=60 edu=80 san=60 hp=12 db="0" build=0 move=8}\n在此輸入人物備註。\n:::\n' }, { type: 'parallel-quote', label: '雙語對照 (Quote)', defaultSnippet: ':::parallel-quote{author="哲學家" source="著作名稱" cite="[@citationKey]"}\n:::original\nOriginal quotation text here.\n:::\n:::translation\n在此輸入繁體中文譯文。\n:::\n:::\n' }, { type: 'github-repo', label: 'GitHub 專案卡片', defaultSnippet: ':::github-repo{url="https://github.com/user/repo" title="專案名稱"}\n專案簡介與特色說明\n:::\n' }, { type: 'x-post', label: 'X (Twitter) 卡片', defaultSnippet: ':::x-post{url="https://x.com/user/status/123" title="貼文標題"}\n貼文摘錄或討論重點\n:::\n' }, { type: 'reddit-post', label: 'Reddit 卡片', defaultSnippet: ':::reddit-post{url="https://reddit.com/r/..." title="討論串"}\n討論摘要\n:::\n' }, { type: 'grid', label: '雙欄網格 (Grid)', defaultSnippet: '::::grid{cols="2" gap="1rem"}\n:::cell\n左側內容\n:::\n:::cell\n右側內容\n:::\n::::\n' }];

// The Chinese instructional placeholders each defaultSnippet carries, keyed to their i18n
// translations. English-locale editors get the inserted snippet in English; the source
// DIRECTIVE_TEMPLATES above (and any note content already written with it) is untouched.
const DEFAULT_SNIPPET_PLACEHOLDERS: Partial<Record<string, [string, TranslationKey][]>> = { info: [['在此輸入資訊內容', 'directive.info.body']], sidebar: [['重要提示', 'directive.sidebar.label'], ['在此輸入重點內容', 'directive.sidebar.body']], optional: [['點擊展開詳細內容', 'directive.optional.label'], ['收合的細節說明...', 'directive.optional.body']], comment: [['在此輸入補充註記', 'directive.comment.body']], handout: [['文件標題', 'directive.handout.title'], ['編輯備註', 'directive.handout.keeper'], ['在此輸入文件內容。', 'directive.handout.body']], 'coc-stat': [['人物名稱', 'directive.cocStat.name'], ['在此輸入人物備註。', 'directive.cocStat.body']], 'parallel-quote': [['哲學家', 'directive.parallelQuote.author'], ['著作名稱', 'directive.parallelQuote.source'], ['在此輸入繁體中文譯文。', 'directive.parallelQuote.translationBody']], 'github-repo': [['專案名稱', 'directive.githubRepo.title'], ['專案簡介與特色說明', 'directive.githubRepo.body']], 'x-post': [['貼文標題', 'directive.xPost.title'], ['貼文摘錄或討論重點', 'directive.xPost.body']], 'reddit-post': [['討論串', 'directive.redditPost.title'], ['討論摘要', 'directive.redditPost.body']], grid: [['左側內容', 'directive.grid.cellLeft'], ['右側內容', 'directive.grid.cellRight']] };

/** The markdown to insert for a new directive of `type`, with its instructional placeholder text in the given locale. */
export function localizedDirectiveSnippet(type: string, t?: DirectiveTranslate): string {
  const tpl = DIRECTIVE_TEMPLATES.find(d => d.type === type) ?? DIRECTIVE_TEMPLATES[0];
  if (!t) return tpl.defaultSnippet;
  let snippet = tpl.defaultSnippet;
  for (const [chinese, key] of DEFAULT_SNIPPET_PLACEHOLDERS[tpl.type] ?? []) {
    snippet = snippet.replaceAll(chinese, t(key));
  }
  return snippet;
}

/**
 * The edit that puts `block` in place of the selection `from`–`to` as a block of its own: the blank lines and
 * whitespace already around that spot give way to exactly one blank line before and after it, however many the
 * writer left, so the block never fuses with a neighbouring paragraph. At the start of the document nothing goes
 * before it, and at the end it is closed by a single newline. `cursor` is the start of the line after the block.
 */
export function blockInsertion(doc: string, from: number, to: number, block: string): { from: number; to: number; insert: string; cursor: number; } {
  const before = doc.slice(0, from), after = doc.slice(to);
  const kept = /^\s*$/.test(before) ? '' : before.replace(/(?:\r?\n[ \t]*)+$/, '');
  const rest = /^\s*$/.test(after) ? '' : after.replace(/^(?:[ \t]*\r?\n)+/, '');
  const body = block.replace(/^\n+|\n+$/g, '');
  const head = kept ? '\n\n' : '';
  const insert = `${head}${body}${rest ? '\n\n' : '\n'}`;
  return { from: kept.length, to: doc.length - rest.length, insert, cursor: kept.length + head.length + body.length + 1 };
}

/** DIRECTIVE_TEMPLATES[type].label in the given locale, via the existing `directive.<type>` keys. */
export function localizedDirectiveLabel(type: string, t?: DirectiveTranslate): string {
  const tpl = DIRECTIVE_TEMPLATES.find(d => d.type === type) ?? DIRECTIVE_TEMPLATES[0];
  return t ? t(`directive.${tpl.type}` as TranslationKey) : tpl.label;
}

export interface ParsedDirectiveBlock {
  from: number;
  to: number;
  fenceLength: number;
  type: string;
  label?: string;
  attrs: Record<string, string>;
  headerLine: string;
  rawBody: string;
  rawText: string;
}

export function findDirectiveBlocks(text: string): ParsedDirectiveBlock[] {
  const blocks: ParsedDirectiveBlock[] = [];
  const lines = text.split('\n');
  let currentOffset = 0;

  interface OpenFence {
    from: number;
    fenceLength: number;
    type: string;
    label?: string;
    attrs: Record<string, string>;
    headerLine: string;
    bodyLines: string[];
  }
  const stack: OpenFence[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = currentOffset;
    const lineEnd = currentOffset + line.length;
    currentOffset = lineEnd + 1; // Account for \n

    const open = parseDirectiveOpen(line);
    if (open) {
      stack.push({ from: lineStart, fenceLength: open.fenceLength, type: open.name, label: open.label, attrs: open.attrs, headerLine: line, bodyLines: [] });
      continue;
    }

    if (stack.length > 0) {
      const close = matchDirectiveClose(line, stack[stack.length - 1].fenceLength);
      if (close) {
        if (close.trailing) stack[stack.length - 1].bodyLines.push(close.trailing);
        const item = stack.pop()!;
        if (stack.length === 0) {
          const rawText = text.slice(item.from, lineEnd);
          blocks.push({ from: item.from, to: lineEnd, fenceLength: item.fenceLength, type: item.type, label: item.label, attrs: item.attrs, headerLine: item.headerLine, rawBody: item.bodyLines.join('\n'), rawText });
        } else {
          stack[stack.length - 1].bodyLines.push(line);
        }
        continue;
      }
    }

    if (stack.length > 0) {
      stack[stack.length - 1].bodyLines.push(line);
    }
  }

  return blocks;
}

export function updateDirectiveType(rawText: string, newType: string): string {
  const lines = rawText.split('\n');
  if (lines.length === 0) return rawText;

  const headerMatch = /^(\s*)(:{3,})([a-zA-Z0-9_-]+)(.*)$/.exec(lines[0]);
  if (!headerMatch) return rawText;

  const prefix = headerMatch[1];
  const colons = headerMatch[2];
  let rest = headerMatch[4];

  if (newType === 'handout' && !/variant=/i.test(rest)) {
    rest = rest ? `${rest}{id="DOC-01" variant="report"}` : '{id="DOC-01" variant="report"}';
  }

  lines[0] = `${prefix}${colons}${newType}${rest}`;
  return lines.join('\n');
}

export function updateDirectiveVariant(rawText: string, newVariant: string): string {
  const lines = rawText.split('\n');
  if (lines.length === 0) return rawText;

  const header = lines[0];
  if (/variant="[^"]*"/i.test(header)) {
    lines[0] = header.replace(/variant="[^"]*"/i, `variant="${newVariant}"`);
  } else if (/variant='[^']*'/i.test(header)) {
    lines[0] = header.replace(/variant='[^']*'/i, `variant="${newVariant}"`);
  } else if (/variant=[^\s}]+/i.test(header)) {
    lines[0] = header.replace(/variant=[^\s}]+/i, `variant="${newVariant}"`);
  } else if (/\{([^}]*)\}/.test(header)) {
    lines[0] = header.replace(/\{([^}]*)\}/, `{variant="${newVariant}" $1}`);
  } else {
    lines[0] = `${header}{variant="${newVariant}"}`;
  }

  return lines.join('\n');
}

export interface DirectiveModel {
  fenceLength: number;
  type: string;
  title: string;
  attrs: Record<string, string>;
  body: string;
}

export function parseDirectiveModel(rawText: string): DirectiveModel {
  const lines = rawText.split('\n');
  const header = lines[0] || '';
  const open = parseDirectiveOpen(header);
  const fenceLength = open ? open.fenceLength : 3;
  const type = open ? open.name : 'info';
  const label = open?.label || '';
  const attrs = open ? open.attrs : {};

  let bodyLines = lines.slice(1);
  if (bodyLines.length > 0) {
    const lastLine = bodyLines[bodyLines.length - 1];
    if (/^(\s*(?:>\s*)*)(:{3,})\s*$/.test(lastLine)) {
      bodyLines = bodyLines.slice(0, -1);
    } else {
      const inlineClose = /^(.*?)(?<!:)(:{3,})\s*$/.exec(lastLine);
      if (inlineClose && inlineClose[2].length >= fenceLength) {
        if (inlineClose[1].trim()) {
          bodyLines[bodyLines.length - 1] = inlineClose[1].trimEnd();
        } else {
          bodyLines = bodyLines.slice(0, -1);
        }
      }
    }
  }
  const body = bodyLines.join('\n');

  const title = attrs.title || label || attrs.name || '';

  return { fenceLength, type, title, attrs, body };
}

export function serializeDirectiveModel(model: DirectiveModel): string {
  const colons = ':'.repeat(Math.max(3, model.fenceLength || 3));
  const type = (model.type || 'info').toLowerCase();
  const trimmedTitle = (model.title || '').trim();
  const attrs = { ...model.attrs };

  let header = `${colons}${type}`;

  if (type === 'handout') {
    if (!attrs.id) attrs.id = 'DOC-01';
    if (!attrs.variant) attrs.variant = 'report';
    if (trimmedTitle) attrs.title = trimmedTitle;
    const attrParts: string[] = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (v) attrParts.push(`${k}="${v.replace(/"/g, '\\"')}"`);
    }
    header += `{${attrParts.join(' ')}}`;
  } else if (type === 'coc-stat') {
    if (trimmedTitle) attrs.name = trimmedTitle;
    else if (!attrs.name) attrs.name = '人物資料';
    const attrParts: string[] = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== '') {
        attrParts.push(/^[0-9]+$/.test(v) ? `${k}=${v}` : `${k}="${v.replace(/"/g, '\\"')}"`);
      }
    }
    header += `{${attrParts.join(' ')}}`;
  } else {
    if (trimmedTitle) {
      header += `[${trimmedTitle}]`;
    }
    const extraAttrs: string[] = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (k !== 'title' && v) {
        extraAttrs.push(`${k}="${v.replace(/"/g, '\\"')}"`);
      }
    }
    if (extraAttrs.length > 0) {
      header += `{${extraAttrs.join(' ')}}`;
    }
  }

  return `${header}\n${model.body}\n${colons}\n`;
}
