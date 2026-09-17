import { describe, expect, it } from 'vitest';
import {
  DIRECTIVE_TEMPLATES,
  findDirectiveBlocks,
  parseDirectiveAttributes,
  parseDirectiveTitle,
  stripMdxImports,
  transformDirectives,
  transformMdxComponents,
  updateDirectiveType,
  updateDirectiveVariant,
} from './directives.js';

describe('directives and MDX Layer 2 preprocessor', () => {
  describe('stripMdxImports', () => {
    it('strips ESM import statements', () => {
      const input = `import YouTubeEmbed from "@/components/YouTubeEmbed.astro";\nimport { Card } from "@/components/ui/card";\nimport 'some-style.css';\n\n# Heading\n\nParagraph text.`;
      const output = stripMdxImports(input);
      expect(output).not.toContain('import YouTubeEmbed');
      expect(output).not.toContain('import { Card }');
      expect(output).not.toContain('import \'some-style.css\'');
      expect(output).toContain('# Heading');
      expect(output).toContain('Paragraph text.');
    });
  });

  describe('transformMdxComponents', () => {
    it('transforms YouTubeEmbed to interactive preview element', () => {
      const input = `<YouTubeEmbed id="dQw4w9WgXcQ" start="10" />`;
      const output = transformMdxComponents(input);
      expect(output).toContain('class="note-youtube-embed"');
      expect(output).toContain('data-video-id="dQw4w9WgXcQ"');
      expect(output).toContain('data-start="10"');
      expect(output).toContain('class="note-youtube-poster"');
      expect(output).toContain('img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    });

    it('transforms ProtectedContent component', () => {
      const input = `<ProtectedContent title="機密文件">機密內文</ProtectedContent>`;
      const output = transformMdxComponents(input);
      expect(output).toContain('class="mdx-protected-content"');
      expect(output).toContain('機密文件');
      expect(output).toContain('機密內文');
    });

    it('transforms Card, Tag, Badge components', () => {
      const card = `<Card title="卡片標題" href="https://example.com">卡片正文</Card>`;
      expect(transformMdxComponents(card)).toContain('class="mdx-card"');
      expect(transformMdxComponents(card)).toContain('卡片標題');

      const badge = `<Badge>標籤內容</Badge>`;
      expect(transformMdxComponents(badge)).toContain('class="mdx-badge"');
      expect(transformMdxComponents(badge)).toContain('標籤內容');
    });

    it('transforms generic custom self-closing components', () => {
      const custom = `<UnknownWidget prop="val" />`;
      const output = transformMdxComponents(custom);
      expect(output).toContain('class="mdx-component-tag"');
      expect(output).toContain('data-component-name="UnknownWidget"');
      expect(output).toContain('prop=&quot;val&quot;');
    });
  });

  describe('parseDirectiveAttributes', () => {
    it('parses unquoted, double-quoted, and single-quoted attributes', () => {
      const raw = 'id="H-01" variant=\'newspaper\' cols=3 title="標題"';
      const attrs = parseDirectiveAttributes(raw);
      expect(attrs.id).toBe('H-01');
      expect(attrs.variant).toBe('newspaper');
      expect(attrs.cols).toBe('3');
      expect(attrs.title).toBe('標題');
    });
  });

  describe('parseDirectiveTitle', () => {
    it('extracts custom title with markdown headings', () => {
      const res = parseDirectiveTitle({ title: '## 自訂標題' }, undefined, 'DEFAULT');
      expect(res.isDefault).toBe(false);
      expect(res.label).toBe('自訂標題');
      expect(res.depth).toBe(2);
    });

    it('falls back to default title when no title is provided', () => {
      const res = parseDirectiveTitle({}, undefined, 'INFO');
      expect(res.isDefault).toBe(true);
      expect(res.label).toBe('INFO');
    });
  });

  describe('transformDirectives container rendering', () => {
    const dummyRender = (md: string) => `<p>${md.trim()}</p>`;

    it('renders :::info directive with default title', () => {
      const input = `:::info\n重要資訊說明\n:::`;
      const output = transformDirectives(input, dummyRender);
      expect(output).toContain('class="custom-directive info-directive"');
      expect(output).toContain('data-type="info"');
      expect(output).toContain('INFO');
      expect(output).toContain('<p>重要資訊說明</p>');
    });

    it('renders :::sidebar with custom label', () => {
      const input = `:::sidebar[重點整理]\n側欄要點\n:::`;
      const output = transformDirectives(input, dummyRender);
      expect(output).toContain('class="custom-directive sidebar-directive"');
      expect(output).toContain('重點整理');
    });

    it('renders :::optional as details summary', () => {
      const input = `:::optional[展開看詳情]\n詳細內容\n:::`;
      const output = transformDirectives(input, dummyRender);
      expect(output).toContain('<details class="custom-directive optional-directive"');
      expect(output).toContain('<summary class="optional-summary');
      expect(output).toContain('展開看詳情');
    });

    it('renders :::comment as aside', () => {
      const input = `:::comment\n筆者眉批\n:::`;
      const output = transformDirectives(input, dummyRender);
      expect(output).toContain('<aside class="comment-directive"');
      expect(output).toContain('COMMENT');
      expect(output).toContain('筆者眉批');
    });

    it('renders :::coc-stat character block', () => {
      const input = `:::coc-stat{name="亞伯特" str=60 dex=70 int=80 san=50 hp=12}\n背景介紹\n:::`;
      const output = transformDirectives(input, dummyRender);
      expect(output).toContain('class="coc-stat-block"');
      expect(output).toContain('亞伯特');
      expect(output).toContain('STR');
      expect(output).toContain('60');
      expect(output).toContain('DEX');
      expect(output).toContain('70');
    });

    it('renders :::handout document with variant', () => {
      const input = `:::handout{id="H-02" title="古老日記" variant="journal" keeper="在閣樓發現"}\n第一頁寫著秘密...\n:::`;
      const output = transformDirectives(input, dummyRender);
      expect(output).toContain('class="handout-block handout-variant-journal"');
      expect(output).toContain('H-02');
      expect(output).toContain('古老日記');
      expect(output).toContain('日誌');
      expect(output).toContain('守密人發放提示');
    });

    it('handles nested container directives like ::::grid wrapping :::cell', () => {
      const input = `::::grid{cols="2"}\n:::cell\n左邊\n:::\n:::cell\n右邊\n:::\n::::`;
      const output = transformDirectives(input, dummyRender);
      expect(output).toContain('class="slide-grid grid-cols-2"');
      expect(output).toContain('class="slide-cell"');
      expect(output).toContain('左邊');
      expect(output).toContain('右邊');
    });
  });

  describe('findDirectiveBlocks, updateDirectiveType, updateDirectiveVariant', () => {
    it('finds top-level directive blocks in markdown text', () => {
      const text = `# Title\n\n:::info\n一些內容\n:::\n\n文字段落\n\n:::sidebar[側欄]\n側欄文字\n:::`;
      const blocks = findDirectiveBlocks(text);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('info');
      expect(blocks[0].rawBody).toBe('一些內容');
      expect(blocks[1].type).toBe('sidebar');
      expect(blocks[1].label).toBe('側欄');
    });

    it('updates directive type in raw text', () => {
      const raw = `:::info[提示]\n內文\n:::`;
      const updated = updateDirectiveType(raw, 'sidebar');
      expect(updated).toBe(`:::sidebar[提示]\n內文\n:::`);
    });

    it('updates directive variant in raw text for handout', () => {
      const raw = `:::handout{id="H-01" variant="report"}\n內文\n:::`;
      const updated = updateDirectiveVariant(raw, 'newspaper');
      expect(updated).toContain('variant="newspaper"');
    });

    it('has default template presets with info as default', () => {
      expect(DIRECTIVE_TEMPLATES[0].type).toBe('info');
      expect(DIRECTIVE_TEMPLATES[0].defaultSnippet).toContain(':::info');
    });
  });
});
