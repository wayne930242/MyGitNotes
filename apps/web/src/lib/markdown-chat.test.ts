// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from './markdown.js';

const base = { folder: 'notes/a', repositoryRoot: '/home/me/workspace' };
const html = (text: string) => {
  const container = document.createElement('div');
  container.innerHTML = renderChatMarkdown(text, base);
  return container;
};

describe('renderChatMarkdown', () => {
  it('renders the reply as Markdown, with code, lists and tables', () => {
    const view = html('**Done**\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(view.querySelector('strong')?.textContent).toBe('Done');
    expect(view.querySelectorAll('li')).toHaveLength(2);
    expect(view.querySelector('pre code')?.textContent).toContain('const a = 1;');
    expect(view.querySelector('.markdown-table-scroll table')).not.toBeNull();
  });

  it('makes note links workspace links resolved from the folder Pi runs in, including absolute paths inside the repository', () => {
    const view = html('[plan](plan.md) [up](../b/x.md) [abs](/home/me/workspace/notes/a/plan.md)');
    const links = [...view.querySelectorAll('a')];
    expect(links.map(link => link.dataset.workspaceLink)).toEqual(['plan.md', '../b/x.md', '/notes/a/plan.md']);
    expect(links.every(link => link.dataset.sourcePath === 'notes/a/.pi-agent' && !link.target)).toBe(true);
  });

  it('opens web links in a new tab, and leaves paths outside the repository as text', () => {
    const view = html('[site](https://example.com) [elsewhere](/etc/passwd) [script](javascript:alert(1))');
    const [site, elsewhere, script] = [...view.querySelectorAll('a')];
    expect(site.target).toBe('_blank');
    expect(site.rel).toBe('noopener noreferrer');
    expect(elsewhere.hasAttribute('href') || elsewhere.dataset.workspaceLink).toBeFalsy();
    expect(script?.getAttribute('href') ?? null).toBeNull();
  });

  it('keeps only web links when it does not know where Pi runs', () => {
    const container = document.createElement('div');
    container.innerHTML = renderChatMarkdown('[plan](plan.md) [site](https://example.com)');
    const [plan, site] = [...container.querySelectorAll('a')];
    expect(plan.hasAttribute('href')).toBe(false);
    expect(site.target).toBe('_blank');
  });
});
