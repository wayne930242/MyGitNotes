import { describe, it, expect } from 'vitest';
import { en } from './en.js';
import { zhTW } from './zh-TW.js';

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
    const simplifiedOnlyChars = ['这', '么', '样', '为', '什', '单', '点', '击', '关', '闭', '设', '置', '编', '辑', '记', '录', '页', '库', '创', '归', '档', '欢', '迎', '显'];
    for (const [key, val] of Object.entries(zhTW)) {
      for (const char of simplifiedOnlyChars) {
        expect(val.includes(char), `Found simplified character '${char}' in key '${key}': "${val}"`).toBe(false);
      }
    }
  });
});
