import en from './en.json';
import zh from './zh.json';

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

type Dict = typeof en;

const DICTS: Record<Locale, Dict> = { en, zh };

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'zh';
}

export function getDict(locale: Locale): Dict {
  return DICTS[locale];
}

/** Build a locale-prefixed path, e.g. localePath('zh', 'design') -> '/zh/design'. */
export function localePath(locale: Locale, segment = ''): string {
  const clean = segment.replace(/^\/+/, '');
  return clean ? `/${locale}/${clean}` : `/${locale}/`;
}

/** Swap the locale on an existing pathname, preserving the sub-page. */
export function switchLocalePath(current: string, next: Locale): string {
  const parts = current.split('/').filter(Boolean);
  if (isLocale(parts[0])) {
    parts[0] = next;
  } else {
    parts.unshift(next);
  }
  return `/${parts.join('/')}` + (current.endsWith('/') && parts.length ? '/' : '');
}

/** Static paths helper for [lang] routes. */
export function localeParams() {
  return LOCALES.map((lang) => ({ params: { lang } }));
}
