import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { en, TranslationKey } from './en.js';
import { zhTW } from './zh-TW.js';

export type Language = 'en' | 'zh-TW';

const STORAGE_KEY = 'github-notes:language';

const dictionaries: Record<Language, Record<TranslationKey, string>> = {
  en,
  'zh-TW': zhTW,
};

export interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Language;
      if (saved === 'en' || saved === 'zh-TW') return saved;
      if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
        return 'zh-TW';
      }
    }
    return 'en';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      window.localStorage?.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore quota/storage errors
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const dict = dictionaries[language] || dictionaries.en;
      let text = dict[key] || en[key] || key;
      if (params) {
        for (const [pKey, pVal] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
        }
      }
      return text;
    },
    [language]
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      language: 'en',
      setLanguage: () => {},
      t: (k, params) => {
        let text = en[k] || k;
        if (params) {
          for (const [pKey, pVal] of Object.entries(params)) {
            text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
          }
        }
        return text;
      },
    };
  }
  return ctx;
}
