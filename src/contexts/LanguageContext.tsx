import { create } from 'zustand';

import { DEFAULT_LANG, getTranslation, SUPPORTED_LANGS } from '../utils/i18n';

interface LanguageState {
  lang: string;
  setLang: (lang: string) => void;
  t: (keyPath: string) => string;
}

const SUPPORTED_CODES = SUPPORTED_LANGS.map((entry) => entry.code);

const getInitialLang = () => {
  const hasStorage =
    typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  const savedLang = hasStorage ? localStorage.getItem('language') : null;
  if (savedLang && SUPPORTED_CODES.includes(savedLang as (typeof SUPPORTED_CODES)[number])) {
    return savedLang;
  }

  // Indonesian is the product default. The system locale is deliberately not
  // consulted: an English-locale machine must still open in Indonesian.
  if (hasStorage && typeof localStorage.setItem === 'function') {
    localStorage.setItem('language', DEFAULT_LANG);
  }
  return DEFAULT_LANG;
};

export const useLanguage = create<LanguageState>((set, get) => ({
  lang: getInitialLang(),
  setLang: (newLang: string) => {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem('language', newLang);
    }
    set({ lang: newLang });
  },
  t: (keyPath: string) => getTranslation(get().lang, keyPath),
}));

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
