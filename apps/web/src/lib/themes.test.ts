import { describe, expect, it } from 'vitest';
import { PALETTE_FAMILIES } from './palettes.js';
import { resolveThemeChoice, themeTokens } from './themes.js';

const luminance = (hex: string) => {
  const [r, g, b] = hex.slice(1, 7).match(/.{2}/g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
};
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
};

describe('theme choice', () => {
  it('loads a retired theme id as Flexoki with the mode it carried', () => {
    expect(resolveThemeChoice('github-dark', null)).toEqual({ familyId: 'flexoki', mode: 'dark' });
    expect(resolveThemeChoice('warm-sepia', null)).toEqual({ familyId: 'flexoki', mode: 'light' });
  });

  it('keeps a saved mode when the family id is unknown', () => {
    expect(resolveThemeChoice('nord-arctic', 'system')).toEqual({ familyId: 'flexoki', mode: 'system' });
    expect(resolveThemeChoice('no-such-family', 'light')).toEqual({ familyId: 'flexoki', mode: 'light' });
  });

  it('defaults to Flexoki following the system', () => {
    expect(resolveThemeChoice(null, null)).toEqual({ familyId: 'flexoki', mode: 'system' });
    expect(resolveThemeChoice('gruvbox', 'dark')).toEqual({ familyId: 'gruvbox', mode: 'dark' });
  });
});

describe('palette families', () => {
  it('ships nine families with a light and a dark variant', () => {
    expect(PALETTE_FAMILIES).toHaveLength(9);
    for (const family of PALETTE_FAMILIES) expect(Object.keys(family.variants).sort()).toEqual(['dark', 'light']);
  });

  it('keeps every text token at 4.5:1 on background, surface and sidebar', () => {
    for (const family of PALETTE_FAMILIES) {
      for (const [mode, variant] of Object.entries(family.variants)) {
        const text = [variant.text, variant.muted, variant.primary, variant.primaryHover, variant.danger, variant.warning, variant.success, variant.info, ...variant.accents];
        for (const ground of [variant.background, variant.surface, variant.sidebar]) {
          for (const color of text) expect(contrast(color, ground), `${family.id}/${mode} ${color} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps body text at 4.5:1 on the selection tint over the surface', () => {
    const over = (tint: string, ground: string) => {
      const alpha = tint.length > 7 ? parseInt(tint.slice(7, 9), 16) / 255 : 1;
      const [a, b] = [tint, ground].map(hex => hex.slice(1, 7).match(/.{2}/g)!.map(value => parseInt(value, 16)));
      return `#${a.map((value, index) => Math.round(alpha * value + (1 - alpha) * b[index]).toString(16).padStart(2, '0')).join('')}`;
    };
    for (const family of PALETTE_FAMILIES) {
      for (const [mode, variant] of Object.entries(family.variants)) {
        const tint = over(variant.selection, variant.surface);
        expect(tint, `${family.id}/${mode} selection is visible on the surface`).not.toBe(variant.surface);
        expect(contrast(variant.text, tint), `${family.id}/${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('defines six accent tokens for every variant', () => {
    for (const family of PALETTE_FAMILIES) {
      for (const variant of Object.values(family.variants)) expect(Object.keys(themeTokens(variant)).filter(name => name.startsWith('--color-accent-'))).toHaveLength(6);
    }
  });
});
