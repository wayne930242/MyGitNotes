import { describe, expect, it } from 'vitest';
import { PALETTE_FAMILIES } from './palettes.js';
import { isMermaidInfo, mermaidThemeVariables } from './mermaid.js';

const HEX = /^#[0-9a-f]{6}$/i;

describe('mermaidThemeVariables', () => {
  it('maps every palette variant to hex-only colours', () => {
    for (const family of PALETTE_FAMILIES) {
      for (const mode of ['light', 'dark'] as const) {
        const { fontFamily, ...colours } = mermaidThemeVariables(family.variants[mode], 'Inter, sans-serif');
        expect(fontFamily).toBe('Inter, sans-serif');
        for (const [name, value] of Object.entries(colours)) expect(value, `${family.id} ${mode} ${name}`).toMatch(HEX);
      }
    }
  });

  it('draws text, lines and node borders from the active variant', () => {
    const variant = PALETTE_FAMILIES[0].variants.dark;
    const variables = mermaidThemeVariables(variant, 'sans-serif');
    expect(variables).toMatchObject({ textColor: variant.text, lineColor: variant.muted, primaryBorderColor: variant.primary, background: variant.background });
  });

  it('differs between light and dark', () => {
    const family = PALETTE_FAMILIES[0];
    expect(mermaidThemeVariables(family.variants.light, 'x').textColor).not.toBe(mermaidThemeVariables(family.variants.dark, 'x').textColor);
  });
});

describe('mermaid fences', () => {
  it('detects the info string', () => {
    expect(isMermaidInfo('mermaid')).toBe(true);
    expect(isMermaidInfo(' Mermaid title')).toBe(true);
    expect(isMermaidInfo('js')).toBe(false);
    expect(isMermaidInfo('')).toBe(false);
  });
});
