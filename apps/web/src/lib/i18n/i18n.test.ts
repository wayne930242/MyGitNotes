import { describe, it, expect } from 'vitest';
import { en } from './en.js';
import { zhTW } from './zh-TW.js';
import { THEMES, getThemeName, getThemeDescription } from '../themes.js';

describe('i18n', () => {
  it('has identical keys between English and Traditional Chinese dictionaries', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhTW).sort();

    expect(enKeys).toEqual(zhKeys);
  });

  it('contains no empty translations in Traditional Chinese', () => {
    for (const [key, val] of Object.entries(zhTW)) {
      expect(val.trim().length, `Empty translation for key: ${key}`).toBeGreaterThan(0);
    }
  });

  it('contains no simplified Chinese characters in Traditional Chinese dictionary', () => {
    // Check characters that exist strictly in Simplified Chinese (not standard Traditional)
    const simplifiedOnlyChars = ['这', '么', '样', '为', '单', '点', '击', '关', '闭', '设', '编', '辑', '记', '录', '页', '库', '创', '归', '档', '欢', '显'];
    for (const [key, val] of Object.entries(zhTW)) {
      for (const char of simplifiedOnlyChars) {
        expect(val.includes(char), `Found simplified character '${char}' in key '${key}': "${val}"`).toBe(false);
      }
    }
  });

  it('provides localized names and descriptions for every theme preset', () => {
    const zhT = (key: string) => zhTW[key as keyof typeof zhTW] || key;
    const enT = (key: string) => en[key as keyof typeof en] || key;

    for (const theme of THEMES) {
      const zhName = getThemeName(theme, zhT as any);
      const enName = getThemeName(theme, enT as any);
      const zhDesc = getThemeDescription(theme, zhT as any);
      const enDesc = getThemeDescription(theme, enT as any);

      expect(zhName).not.toEqual(enName);
      expect(zhDesc).not.toEqual(enDesc);
      expect(zhName.length).toBeGreaterThan(0);
      expect(zhDesc.length).toBeGreaterThan(0);
    }
  });

  it('includes required MCP access control notices in both languages', () => {
    expect(en['auth.grantsActiveNotice']).toContain('Grants stay active until you revoke them here');
    expect(zhTW['auth.grantsActiveNotice']).toContain('授權將持續有效');

    expect(en['auth.chatgptConnectorNotice']).toContain('For a ChatGPT connector');
    expect(zhTW['auth.chatgptConnectorNotice']).toContain('使用 ChatGPT 連接器時');
  });
});
