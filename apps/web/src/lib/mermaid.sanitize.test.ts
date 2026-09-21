// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from './markdown.js';
import { MERMAID_BLOCK_SELECTOR } from './mermaid.js';

describe('mermaid placeholder through the real sanitizer', () => {
  it('keeps a source that contains arrows and angle brackets', () => {
    const source = 'flowchart TB\n  U <--> G\n  H --> V';
    const mount = document.createElement('div');
    mount.innerHTML = renderNote(`before\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nafter`, 'notes/n.md');
    const blocks = mount.querySelectorAll(MERMAID_BLOCK_SELECTOR);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].querySelector('pre')?.textContent).toBe(source);
    expect(mount.textContent).toContain('before');
    expect(mount.textContent).toContain('after');
  });
});
