import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import enCommon from '../../../../packages/locales/en/common.json';
import enMoments from '../../../../packages/locales/en/moments.json';
import enChat from '../../../../packages/locales/en/chat.json';
import enSearch from '../../../../packages/locales/en/search.json';
import zhCommon from '../../../../packages/locales/zh-CN/common.json';
import zhMoments from '../../../../packages/locales/zh-CN/moments.json';
import zhChat from '../../../../packages/locales/zh-CN/chat.json';
import zhSearch from '../../../../packages/locales/zh-CN/search.json';
import {
  installMobileLanguageRuntime,
  readMobileLanguageSnapshot,
  retryMobileLanguage,
  setMobileLanguage,
  subscribeMobileLanguage,
  systemMobileLanguage,
  type MobileLanguage,
} from '../runtimes/languageRuntime';

export interface MobileLanguageOption {
  code: MobileLanguage;
  nativeName: string;
  shortName: string;
}

type TranslationParams = Record<string, string | number>;

interface MobileI18nContextValue {
  language: MobileLanguage;
  languages: MobileLanguageOption[];
  languageStatus: 'idle' | 'saving' | 'failed';
  languageError: string | null;
  setLanguage: (language: MobileLanguage) => Promise<boolean>;
  retryLanguage: () => Promise<boolean>;
  t: (key: string, params?: TranslationParams) => string;
}

const languages: MobileLanguageOption[] = [
  { code: 'zh-CN', nativeName: '简体中文', shortName: '中文' },
  { code: 'en', nativeName: 'English', shortName: 'EN' },
];

const resources: Record<MobileLanguage, Record<string, string>> = {
  en: { ...enCommon, ...enMoments, ...enChat, ...enSearch },
  'zh-CN': { ...zhCommon, ...zhMoments, ...zhChat, ...zhSearch },
};

const MobileI18nContext = createContext<MobileI18nContextValue | null>(null);

export function MobileI18nProvider({ children }: { children: ReactNode }) {
  const { language, status: languageStatus, error: languageError } = useSyncExternalStore(
    subscribeMobileLanguage,
    readMobileLanguageSnapshot,
    readSystemLanguageSnapshot,
  );
  useEffect(installMobileLanguageRuntime, []);

  const value = useMemo<MobileI18nContextValue>(
    () => ({
      language,
      languages,
      languageStatus,
      languageError,
      setLanguage: setMobileLanguage,
      retryLanguage: retryMobileLanguage,
      t: (key, params) => interpolate(resources[language][key] ?? resources.en[key] ?? key, params),
    }),
    [
      language,
      languageError,
      languageStatus,
    ],
  );

  return <MobileI18nContext.Provider value={value}>{children}</MobileI18nContext.Provider>;
}

export function useMobileI18n() {
  const value = useContext(MobileI18nContext);
  if (!value) throw new Error('useMobileI18n must be used inside MobileI18nProvider');
  return value;
}

function readSystemLanguageSnapshot() {
  return { language: systemMobileLanguage(), status: 'idle' as const, error: null };
}

function interpolate(value: string, params?: TranslationParams): string {
  if (!params) return value;
  return Object.entries(params).reduce(
    (next, [key, replacement]) => next.replaceAll(`{{${key}}}`, String(replacement)),
    value,
  );
}

// Native runtimes report errors as "stable.locale.key:diagnostic-detail".
// Only the part before the first ':' is a translation key; the suffix carries
// HTTP statuses and transport text for logs, never for the UI.
const MOBILE_ERROR_KEY_PATTERN = /(mobile\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)/;

export function mobileErrorKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.match(MOBILE_ERROR_KEY_PATTERN)?.[1] ?? null;
}

type Translate = (key: string, params?: TranslationParams) => string;

// Resolve any native/UI error string to human-readable copy. Never surfaces a
// raw locale key or transport detail: unknown keys fall back to the supplied
// generic key instead.
export function translateMobileError(
  t: Translate,
  raw: string | null | undefined,
  fallbackKey: string,
): string {
  const key = mobileErrorKey(raw);
  if (key) {
    const translated = t(key);
    if (translated !== key) return translated;
  }
  const fallback = t(fallbackKey);
  return fallback !== fallbackKey ? fallback : t('mobile.auth.errorGeneric');
}
