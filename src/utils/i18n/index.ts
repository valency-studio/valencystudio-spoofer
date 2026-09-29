export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { id } from './id';
import { ru } from './ru';

/** Indonesian is the product default and the fallback for unknown locales. */
export const DEFAULT_LANG = 'id';

/** Single source of truth for the languages offered in Appearance & Localization. */
export const SUPPORTED_LANGS = [
  { code: 'id', label: '🇮🇩 Bahasa Indonesia' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'es', label: '🇪🇸 Español' },
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'ru', label: '🇷🇺 Русский' },
] as const;

const locales: Record<string, TranslationTree> = { id, en, es, ru, fr };

export function getTranslation(lang: string, keyPath: string): string {
  const dictionary = locales[lang] || locales[DEFAULT_LANG];
  const keys = keyPath.split('.');

  let current: string | TranslationTree | undefined = dictionary;
  for (const k of keys) {
    if (typeof current !== 'object' || current === null || !(k in current)) {
      let fallback: string | TranslationTree | undefined = locales[DEFAULT_LANG];
      for (const fk of keys) {
        if (typeof fallback !== 'object' || fallback === null || !(fk in fallback)) {
          return keyPath;
        }
        fallback = fallback[fk];
      }
      return typeof fallback === 'string' ? fallback : keyPath;
    }
    current = current[k];
  }
  return typeof current === 'string' ? current : keyPath;
}
