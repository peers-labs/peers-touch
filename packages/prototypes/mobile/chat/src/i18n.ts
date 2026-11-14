/**
 * Mobile prototype i18n runtime.
 *
 * The prototype previously imported the English JSON bundle statically, so
 * the language switch was decorative. This module resolves the active locale
 * from `?lang=` then navigator language (same rule as the chat journey),
 * merges every consumed locale namespace, and lets the in-shell switcher
 * change language live without a reload.
 *
 * Seeded narrative content (names, authored messages) stays untranslated;
 * only interface chrome goes through t().
 */
import { resolveChatJourneyLocale, type ChatJourneyLocale } from '../../../shared/chat-journey';
import enCommon from '../../../../locales/en/common.json';
import enChat from '../../../../locales/en/chat.json';
import enSearch from '../../../../locales/en/search.json';
import enMoments from '../../../../locales/en/moments.json';
import zhCommon from '../../../../locales/zh-CN/common.json';
import zhChat from '../../../../locales/zh-CN/chat.json';
import zhSearch from '../../../../locales/zh-CN/search.json';
import zhMoments from '../../../../locales/zh-CN/moments.json';
import { useEffect, useState } from 'react';

export type Locale = ChatJourneyLocale;
export type TemplateVars = Record<string, string | number>;

type Dictionary = Record<string, string>;

const BUNDLES: Record<Locale, Dictionary> = {
  en: { ...enCommon, ...enChat, ...enSearch, ...enMoments } as Dictionary,
  zh: { ...zhCommon, ...zhChat, ...zhSearch, ...zhMoments } as Dictionary,
};

const EVENT = 'mp-locale-change';

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  return resolveChatJourneyLocale(window.location.search, window.navigator.language);
}

let currentLocale: Locale = initialLocale();

function htmlLang(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

function syncDocumentLocale(locale: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = htmlLang(locale);
}

syncDocumentLocale(currentLocale);

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(next: Locale) {
  if (next === currentLocale) return;
  currentLocale = next;
  syncDocumentLocale(next);
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

export function toggleLocale(): Locale {
  setLocale(currentLocale === 'zh' ? 'en' : 'zh');
  return currentLocale;
}

/** Supports both `{name}` and `{{name}}` placeholders used in the bundles. */
export function translate(locale: Locale, key: string, vars?: TemplateVars): string {
  const template = BUNDLES[locale][key] ?? BUNDLES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{\{?\s*(\w+)\s*\}\}?/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match);
}

export function t(key: string, vars?: TemplateVars): string {
  return translate(currentLocale, key, vars);
}

export function useLocale(): Locale {
  const [locale, setLocal] = useState<Locale>(currentLocale);
  useEffect(() => {
    const sync = () => setLocal(currentLocale);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return locale;
}

export function useT(): (key: string, vars?: TemplateVars) => string {
  const locale = useLocale();
  return (key, vars) => translate(locale, key, vars);
}
