/**
 * Directives and MDX Layer 2 preprocessor for MyGitNotes.
 * Implements the standard container, leaf, and inline generic directives
 * matching the user's blog specifications and editorial design.
 */

export interface DirectiveTitle {
  label: string;
  isDefault: boolean;
  depth?: number;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function parseDirectiveAttributes(rawAttrs?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawAttrs) return result;

  const regex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s}]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawAttrs)) !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    result[key] = val;
  }
  return result;
}

export function parseDirectiveTitle(attrs: Record<string, string>, label: string | undefined, defaultTitle: string): DirectiveTitle {
  const rawTitle = (attrs.title || label || '').trim();
  if (!rawTitle) {
    return { label: defaultTitle, isDefault: true };
  }

  const headingMatch = /^(#{1,6})\s+(.+)$/.exec(rawTitle);
  if (headingMatch) {
    return { depth: headingMatch[1].length, isDefault: false, label: headingMatch[2].trim() };
  }

  return { label: rawTitle, isDefault: false };
}

export const HANDOUT_VARIANTS: Record<string, string> = { report: '文件', newspaper: '剪報', letter: '信件', journal: '日誌', note: '紙條', scripture: '經文' };

const COC_CHARACTERISTICS = [{ key: 'str', code: 'STR', label: '力量' }, { key: 'con', code: 'CON', label: '體質' }, { key: 'siz', code: 'SIZ', label: '體型' }, { key: 'dex', code: 'DEX', label: '敏捷' }, { key: 'int', code: 'INT', label: '智力' }, { key: 'app', code: 'APP', label: '外貌' }, { key: 'pow', code: 'POW', label: '意志' }, { key: 'edu', code: 'EDU', label: '教育' }, { key: 'san', code: 'SAN', label: '理智' }, { key: 'hp', code: 'HP', label: '耐久' }];

const COC_DERIVED = [{ key: 'db', code: 'DB', label: '傷害加值' }, { key: 'build', code: 'BUILD', label: '體格' }, { key: 'move', code: 'MOV', label: '移動率' }];

/**
 * Strips ESM import lines from MDX content (e.g. `import X from "@/components/..."`).
 */
export function stripMdxImports(content: string): string {
  return content.replace(/^[ \t]*import\s+.*?(?:from\s+['"][^'"]+['"]|['"][^'"]+['"]);?[ \t]*$/gm, '');
}

/**
 * Transforms JSX / MDX custom components into rendered HTML representations.
 */
export function transformMdxComponents(content: string): string {
  // 1. YouTubeEmbed components
  let result = content.replace(/<(?:YouTubeEmbed|YouTube)\s+([^>]*?)(?:\/>|>\s*<\/(?:YouTubeEmbed|YouTube)>)/g, (_, attrString: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const videoId = attrs.id || attrs.videoId || '';
    const url = attrs.url || '';
    let targetId = videoId;
    if (!targetId && url) {
      const idMatch = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/i.exec(url);
      if (idMatch) targetId = idMatch[1];
    }
    if (!targetId) return '';
    const start = attrs.start || '0';
    const sourceUrl = url || `https://www.youtube.com/watch?v=${encodeURIComponent(targetId)}${Number(start) ? `&t=${encodeURIComponent(start)}s` : ''}`;
    return `<div class="note-youtube-embed" data-video-id="${escapeHtml(targetId)}" data-start="${escapeHtml(start)}" data-youtube-source-url="${escapeHtml(sourceUrl)}"></div>`;
  });

  // 2. ProtectedContent
  result = result.replace(/<ProtectedContent\b([^>]*)>([\s\S]*?)<\/ProtectedContent>/g, (_, attrString: string, body: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const title = attrs.title || '受保護內容';
    return `<div class="mdx-protected-content" data-type="protected-content"><div class="mdx-protected-header">🔒 ${escapeHtml(title)}</div><div class="mdx-protected-body">${body.trim()}</div></div>`;
  });

  // 3. Card components
  result = result.replace(/<Card\b([^>]*)>([\s\S]*?)<\/Card>/g, (_, attrString: string, body: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const title = attrs.title || attrs.heading || '';
    const href = attrs.href || attrs.link || '';
    return `<div class="mdx-card"><div class="mdx-card-header">${title ? `<strong class="mdx-card-title">${escapeHtml(title)}</strong>` : ''}${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="mdx-card-link">↗</a>` : ''}</div><div class="mdx-card-body">${body.trim()}</div></div>`;
  });

  // 4. Tag / Badge components
  result = result.replace(/<(?:Tag|Badge)\b([^>]*)>([\s\S]*?)<\/(?:Tag|Badge)>/g, (_, _attrString: string, body: string) => {
    return `<span class="mdx-badge">${body.trim()}</span>`;
  });

  // 5. Generic self-closing custom components <MyComponent prop="val" />
  result = result.replace(/<([A-Z][a-zA-Z0-9_-]*)\s*([^>]*?)\/>/g, (_, name: string, attrString: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const attrSummary = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).slice(0, 3).join(' ');
    return `<span class="mdx-component-tag" data-component-name="${escapeHtml(name)}"><span class="mdx-component-icon" aria-hidden="true">⚛</span><span class="mdx-component-name">${escapeHtml(name)}</span>${attrSummary ? `<span class="mdx-component-attrs">${escapeHtml(attrSummary)}</span>` : ''}</span>`;
  });

  return result;
}

/**
 * Transforms inline directives like `:icon{name="Heart" size="16"}` and `:qrcode{url="..."}`.
 */
export function transformInlineDirectives(line: string): string {
  // :icon{name="Heart" size="16"} or :icon[Heart]{size="16"}
  let result = line.replace(/:icon(?:\[([^\]]*)\])?(?:\{([^}]*)\})?/g, (_, label: string, attrStr: string) => {
    const attrs = parseDirectiveAttributes(attrStr);
    const name = attrs.name || label || 'circle';
    const sizeInput = attrs.size || '1em';
    const size = /^\d+$/.test(sizeInput) ? `${sizeInput}px` : sizeInput;
    return `<span class="lucide-icon inline-icon" data-lucide="${escapeHtml(name)}" data-size="${escapeHtml(sizeInput)}" style="display:inline-flex;width:${escapeHtml(size)};height:${escapeHtml(size)};vertical-align:middle;" title="${escapeHtml(name)}"><svg width="${escapeHtml(size)}" height="${escapeHtml(size)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg></span>`;
  });

  // :qrcode{url="https://..." size="128"}
  result = result.replace(/:qrcode(?:\[([^\]]*)\])?(?:\{([^}]*)\})?/g, (_, label: string, attrStr: string) => {
    const attrs = parseDirectiveAttributes(attrStr);
    const url = attrs.url || label || '';
    const size = attrs.size || '128';
    return `<span class="qrcode-container" data-qrcode="${escapeHtml(url)}" data-size="${escapeHtml(size)}"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="qrcode-link">🔗 ${escapeHtml(url || 'QR Code')}</a></span>`;
  });

  return result;
}

/**
 * Renders a single container directive into semantic HTML.
 */
export function renderContainerDirective(name: string, label: string | undefined, attrs: Record<string, string>, bodyMarkdown: string, renderMarkdown: (md: string) => string): string {
  const normName = name.toLowerCase();

  if (normName === 'info') {
    const title = parseDirectiveTitle(attrs, label, 'INFO');
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<div class="custom-directive info-directive" data-type="info" aria-label="${escapeHtml(title.label)}"><p class="directive-title ${titleClass}">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></div>`;
  }

  if (normName === 'sidebar') {
    const title = parseDirectiveTitle(attrs, label, 'IMPORTANT');
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<div class="custom-directive sidebar-directive" data-type="sidebar" aria-label="${escapeHtml(title.label)}"><p class="directive-title ${titleClass}">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></div>`;
  }

  if (normName === 'optional') {
    const title = parseDirectiveTitle(attrs, label, 'DETAILS');
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<details class="custom-directive optional-directive" data-type="optional" aria-label="${escapeHtml(title.label)}"><summary class="optional-summary ${titleClass}">${escapeHtml(title.label)}</summary><div class="directive-body directive-content">${bodyHtml}</div></details>`;
  }

  if (normName === 'comment') {
    const title = parseDirectiveTitle(attrs, label, 'COMMENT');
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<aside class="comment-directive" data-type="comment" aria-label="${escapeHtml(title.label)}"><p class="comment-title ${titleClass}">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></aside>`;
  }

  if (normName === 'summary') {
    const slide = attrs.slide ?? '0';
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-summary" data-type="summary" data-slide-index="${escapeHtml(slide)}">${bodyHtml}</div>`;
  }

  if (normName === 'grid') {
    const cols = attrs.cols || '2';
    const rows = attrs.rows;
    const gap = attrs.gap || '1rem';
    let style = `display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap};`;
    if (rows) style += `grid-template-rows:repeat(${rows},minmax(0,1fr));`;
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-grid grid-cols-${escapeHtml(cols)}" data-cols="${escapeHtml(cols)}" style="${escapeHtml(style)}">${bodyHtml}</div>`;
  }

  if (normName === 'cell') {
    const colSpan = attrs.span || attrs.col || '1';
    const rowSpan = attrs.row || '1';
    let style = '';
    if (colSpan !== '1') style += `grid-column:span ${colSpan};`;
    if (rowSpan !== '1') style += `grid-row:span ${rowSpan};`;
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-cell" data-col-span="${escapeHtml(colSpan)}" style="${escapeHtml(style)}">${bodyHtml}</div>`;
  }

  if (normName === 'flow') {
    const direction = attrs.direction || 'horizontal';
    const arrow = attrs.arrow || '→';
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-flow flow-${escapeHtml(direction)}" data-direction="${escapeHtml(direction)}" data-arrow="${escapeHtml(arrow)}">${bodyHtml}</div>`;
  }

  if (normName === 'step') {
    const icon = attrs.icon || '';
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-step" data-icon="${escapeHtml(icon)}">${bodyHtml}</div>`;
  }

  if (normName === 'coc-stat') {
    const nameVal = attrs.name || label || '人物資料';
    const roleVal = attrs.role || '';
    const bodyHtml = renderMarkdown(bodyMarkdown);

    const charCells = COC_CHARACTERISTICS.flatMap(({ key, code, label: charLabel }) => {
      const val = attrs[key]?.trim();
      if (!val) return [];
      return `<div class="coc-stat-cell" data-stat="${key}"><span class="coc-stat-label"><span class="coc-stat-label-name">${charLabel}</span><abbr class="coc-stat-code" title="${charLabel}">${code}</abbr></span><strong class="coc-stat-value">${escapeHtml(val)}</strong></div>`;
    }).join('');

    const derivedCells = COC_DERIVED.flatMap(({ key, code, label: derLabel }) => {
      const val = attrs[key]?.trim();
      if (!val) return [];
      return `<div class="coc-stat-cell" data-stat="${key}"><span class="coc-stat-label"><span class="coc-stat-label-name">${derLabel}</span><abbr class="coc-stat-code" title="${derLabel}">${code}</abbr></span><strong class="coc-stat-value">${escapeHtml(val)}</strong></div>`;
    }).join('');

    return `<section class="coc-stat-block" data-type="coc-stat" aria-label="${escapeHtml(nameVal)}的 CoC 數值"><header class="coc-stat-header"><p class="coc-stat-kicker">COC 7E｜人物數值</p><h3 class="coc-stat-name">${escapeHtml(nameVal)}</h3>${roleVal ? `<p class="coc-stat-role">${escapeHtml(roleVal)}</p>` : ''}</header>${charCells ? `<div class="coc-stat-characteristics" role="group" aria-label="屬性與狀態">${charCells}</div>` : ''}${derivedCells ? `<div class="coc-stat-derived" role="group" aria-label="衍生數值">${derivedCells}</div>` : ''}${bodyHtml ? `<div class="coc-stat-body directive-content">${bodyHtml}</div>` : ''}</section>`;
  }

  if (normName === 'handout') {
    const id = attrs.id || 'DOC-01';
    const title = attrs.title || label || '文件標題';
    const variant = attrs.variant || 'report';
    const keeper = attrs.keeper || '';
    const variantLabel = HANDOUT_VARIANTS[variant] || '文件';
    const bodyHtml = renderMarkdown(bodyMarkdown);

    const keeperNote = keeper ? `<aside class="handout-keeper-note"><p class="handout-keeper-kicker">編輯備註</p><p class="handout-keeper-text">${escapeHtml(keeper)}</p></aside>` : '';

    return `<section class="handout-block handout-variant-${escapeHtml(variant)}" id="${escapeHtml(id)}" data-type="handout" data-variant="${escapeHtml(variant)}" aria-label="文件 ${escapeHtml(id)}：${escapeHtml(title)}">${keeperNote}<div class="handout-reference"><span class="handout-code">${escapeHtml(id)}</span><span class="handout-variant-label">${escapeHtml(variantLabel)}</span></div><article class="handout-document"><header class="handout-document-header"><h4 class="handout-title">${escapeHtml(title)}</h4></header><div class="handout-body directive-content">${bodyHtml}</div></article></section>`;
  }

  if (normName === 'parallel-quote') {
    const cite = attrs.cite || '';
    const author = attrs.author || '';
    const source = attrs.source || '';
    const bodyHtml = renderMarkdown(bodyMarkdown);

    const attribution = cite || author || source ? `<footer class="parallel-quote-attribution">${author ? `<span data-label="AUTHOR">${escapeHtml(author)}</span>` : ''}${source ? `<cite class="parallel-quote-source" data-label="SOURCE">${escapeHtml(source)}</cite>` : ''}${cite ? `<span class="parallel-quote-bibliography" data-label="CITATION">${escapeHtml(cite)}</span>` : ''}</footer>` : '';

    return `<blockquote class="parallel-quote">${bodyHtml}${attribution}</blockquote>`;
  }

  if (normName === 'original') {
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<details class="parallel-quote-disclosure" open><summary class="parallel-quote-toggle" aria-label="切換原文"></summary><div class="parallel-quote-text parallel-quote-original">${bodyHtml}</div></details>`;
  }

  if (normName === 'translation') {
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="parallel-quote-text parallel-quote-translation">${bodyHtml}</div>`;
  }

  if (['github-repo', 'x-post', 'reddit-post', 'embed-card'].includes(normName)) {
    const url = attrs.url || '';
    const cardTitle = attrs.title || label || url;
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const badges: Record<string, string> = { 'github-repo': 'GitHub', 'x-post': 'X (Twitter)', 'reddit-post': 'Reddit', 'embed-card': 'Embed' };
    const badge = badges[normName] || normName;
    return `<article class="embedded-card embedded-card-${normName}" data-card-type="${normName}"><header class="embedded-card-header"><span class="embedded-card-badge">${escapeHtml(badge)}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="embedded-card-link"><span class="embedded-card-title">${escapeHtml(cardTitle)}</span> ↗</a>` : `<span class="embedded-card-title">${escapeHtml(cardTitle)}</span>`}</header>${bodyHtml ? `<div class="embedded-card-body directive-content">${bodyHtml}</div>` : ''}</article>`;
  }

  // Fallback generic container directive
  const title = parseDirectiveTitle(attrs, label, normName.toUpperCase());
  const bodyHtml = renderMarkdown(bodyMarkdown);
  return `<div class="custom-directive generic-directive" data-type="${escapeHtml(normName)}"><p class="directive-title directive-title-custom">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></div>`;
}

interface DirectiveStackItem {
  fenceLength: number;
  name: string;
  label?: string;
  attrs: Record<string, string>;
  lines: string[];
}

/**
 * Main parser that scans for container directives, leaf directives, inline directives,
 * and recursively converts them to HTML before main markdown processing.
 */
export function transformDirectives(content: string, renderMarkdown: (md: string) => string): string {
  const lines = content.split('\n');
  const output: string[] = [];
  const stack: DirectiveStackItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check opening container fence: :::name[label]{attr="val"} (allows > blockquote prefixes)
    const openMatch = /^(\s*(?:>\s*)*)(:{3,})([a-zA-Z0-9_-]+)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/.exec(line);
    if (openMatch) {
      const fenceLength = openMatch[2].length;
      const name = openMatch[3];
      const label = openMatch[4];
      const rawAttrs = openMatch[5];
      const attrs = parseDirectiveAttributes(rawAttrs);

      stack.push({ fenceLength, name, label, attrs, lines: [] });
      continue;
    }

    // Check closing container fence: ::: or > ::: or inline trailing :::
    if (stack.length > 0) {
      const targetFenceLength = stack[stack.length - 1].fenceLength;
      let matchedClosing = false;
      const pureClose = /^(\s*(?:>\s*)*)(:{3,})\s*$/.exec(line);
      if (pureClose && pureClose[2].length === targetFenceLength) {
        matchedClosing = true;
      } else {
        const inlineClose = /^(.*?)(?<!:)(:{3,})\s*$/.exec(line);
        if (inlineClose && inlineClose[2].length === targetFenceLength) {
          matchedClosing = true;
          if (inlineClose[1].trim()) {
            stack[stack.length - 1].lines.push(inlineClose[1].trimEnd());
          }
        }
      }

      if (matchedClosing) {
        const item = stack.pop()!;
        const innerBody = item.lines.join('\n');
        // Recursively transform directives within this container
        const transformedInner = transformDirectives(innerBody, renderMarkdown);
        const renderedHtml = renderContainerDirective(item.name, item.label, item.attrs, transformedInner, renderMarkdown);

        if (stack.length > 0) {
          stack[stack.length - 1].lines.push(renderedHtml);
        } else {
          output.push(renderedHtml);
        }
        continue;
      }
    }

    // Leaf directive: ::vertical
    if (stack.length === 0 && /^::vertical\s*$/.test(line)) {
      output.push('<hr class="vertical-slide-break" data-vertical="true" />');
      continue;
    }

    // Accumulate inside current container or output
    if (stack.length > 0) {
      stack[stack.length - 1].lines.push(line);
    } else {
      // Process inline directives in line
      output.push(transformInlineDirectives(line));
    }
  }

  // Handle any unclosed containers gracefully
  while (stack.length > 0) {
    const unclosed = stack.shift()!;
    output.push(`${':'.repeat(unclosed.fenceLength)}${unclosed.name}`);
    output.push(...unclosed.lines);
  }

  return output.join('\n');
}

export interface DirectiveTemplate {
  type: string;
  label: string;
  defaultSnippet: string;
}

export const DIRECTIVE_TEMPLATES: DirectiveTemplate[] = [{ type: 'info', label: '資訊 (Info)', defaultSnippet: ':::info\n在此輸入資訊內容\n:::\n' }, { type: 'sidebar', label: '重點區塊 (Sidebar)', defaultSnippet: ':::sidebar[重要提示]\n在此輸入重點內容\n:::\n' }, { type: 'optional', label: '摺疊細節 (Optional)', defaultSnippet: ':::optional[點擊展開詳細內容]\n收合的細節說明...\n:::\n' }, { type: 'comment', label: '旁註 (Comment)', defaultSnippet: ':::comment\n在此輸入補充註記\n:::\n' }, { type: 'handout', label: '文件卡片 (Document)', defaultSnippet: ':::handout{id="DOC-01" title="文件標題" variant="report" keeper="編輯備註"}\n在此輸入文件內容。\n:::\n' }, { type: 'coc-stat', label: '屬性資料卡 (Stats)', defaultSnippet: ':::coc-stat{name="人物名稱" str=50 con=60 siz=65 dex=70 int=75 app=50 pow=60 edu=80 san=60 hp=12 db="0" build=0 move=8}\n在此輸入人物備註。\n:::\n' }, { type: 'parallel-quote', label: '雙語對照 (Quote)', defaultSnippet: ':::parallel-quote{author="哲學家" source="著作名稱" cite="[@citationKey]"}\n:::original\nOriginal quotation text here.\n:::\n:::translation\n在此輸入繁體中文譯文。\n:::\n:::\n' }, { type: 'github-repo', label: 'GitHub 專案卡片', defaultSnippet: ':::github-repo{url="https://github.com/user/repo" title="專案名稱"}\n專案簡介與特色說明\n:::\n' }, { type: 'x-post', label: 'X (Twitter) 卡片', defaultSnippet: ':::x-post{url="https://x.com/user/status/123" title="貼文標題"}\n貼文摘錄或討論重點\n:::\n' }, { type: 'reddit-post', label: 'Reddit 卡片', defaultSnippet: ':::reddit-post{url="https://reddit.com/r/..." title="討論串"}\n討論摘要\n:::\n' }, { type: 'grid', label: '雙欄網格 (Grid)', defaultSnippet: '::::grid{cols="2" gap="1rem"}\n:::cell\n左側內容\n:::\n:::cell\n右側內容\n:::\n::::\n' }];

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

    // Opening fence: :::name[label]{attrs} (allows > blockquote prefixes)
    const openMatch = /^(\s*(?:>\s*)*)(:{3,})([a-zA-Z0-9_-]+)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/.exec(line);
    if (openMatch) {
      const fenceLength = openMatch[2].length;
      const type = openMatch[3];
      const label = openMatch[4];
      const rawAttrs = openMatch[5];
      const attrs = parseDirectiveAttributes(rawAttrs);

      stack.push({ from: lineStart, fenceLength, type, label, attrs, headerLine: line, bodyLines: [] });
      continue;
    }

    // Closing fence: ::: or > ::: or inline trailing :::
    if (stack.length > 0) {
      const targetFenceLength = stack[stack.length - 1].fenceLength;
      let matchedClosing = false;
      const pureClose = /^(\s*(?:>\s*)*)(:{3,})\s*$/.exec(line);
      if (pureClose && pureClose[2].length === targetFenceLength) {
        matchedClosing = true;
      } else {
        const inlineClose = /^(.*?)(?<!:)(:{3,})\s*$/.exec(line);
        if (inlineClose && inlineClose[2].length === targetFenceLength) {
          matchedClosing = true;
          if (inlineClose[1].trim()) {
            stack[stack.length - 1].bodyLines.push(inlineClose[1].trimEnd());
          }
        }
      }

      if (matchedClosing) {
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
  const match = /^(\s*(?:>\s*)*)(:{3,})([a-zA-Z0-9_-]+)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/.exec(header);

  const fenceLength = match ? match[2].length : 3;
  const type = match ? match[3] : 'info';
  const label = match ? match[4] || '' : '';
  const rawAttrs = match ? match[5] : '';
  const attrs = parseDirectiveAttributes(rawAttrs);

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
