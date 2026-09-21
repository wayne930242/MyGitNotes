// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const drawn: { mode: string; }[] = [];

vi.mock('./markdown.js', () => ({ renderNote: () => '<p>Plan</p><div class="note-mermaid" data-mermaid-source="graph LR"><pre>graph LR</pre></div>' }));
vi.mock('./mermaid.js', () => ({
  currentAppearance: () => ({ familyId: 'flexoki', mode: 'dark' }),
  renderMermaidBlocks: async (root: ParentNode, appearance: { mode: string; }) => {
    drawn.push(appearance);
    await new Promise(resolve => setTimeout(resolve, 20));
    root.querySelector('.note-mermaid')!.innerHTML = '<svg id="diagram"></svg>';
  },
}));

import { renderPrintableNote } from './note-export.js';

describe('renderPrintableNote', () => {
  it('resolves only after the diagrams are drawn, on the light variant of the active family', async () => {
    const body = await renderPrintableNote('```mermaid\ngraph LR\n```', 'notes/n.md');
    expect(body).toContain('<svg id="diagram"></svg>');
    expect(body).not.toContain('<pre>graph LR</pre>');
    expect(drawn.at(-1)).toMatchObject({ familyId: 'flexoki', mode: 'light' });
  });
});
