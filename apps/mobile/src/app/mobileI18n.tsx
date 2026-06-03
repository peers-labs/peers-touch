import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import enCommon from '../../../../packages/locales/en/common.json';
import zhCommon from '../../../../packages/locales/zh-CN/common.json';

export type MobileLanguage = 'en' | 'zh-CN';

export interface MobileLanguageOption {
  code: MobileLanguage;
  nativeName: string;
  shortName: string;
}

type TranslationParams = Record<string, string | number>;

interface MobileI18nContextValue {
  language: MobileLanguage;
  languages: MobileLanguageOption[];
  setLanguage: (language: MobileLanguage) => void;
  t: (key: string, params?: TranslationParams) => string;
}

const MOBILE_LANGUAGE_KEY = 'peers-touch.mobile.language';

const languages: MobileLanguageOption[] = [
  { code: 'zh-CN', nativeName: '简体中文', shortName: '中文' },
  { code: 'en', nativeName: 'English', shortName: 'EN' },
];

const resources: Record<MobileLanguage, Record<string, string>> = {
  en: enCommon,
  'zh-CN': zhCommon,
};

const MobileI18nContext = createContext<MobileI18nContextValue | null>(null);

export function MobileI18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<MobileLanguage>(() => detectInitialLanguage());

  const value = useMemo<MobileI18nContextValue>(
    () => ({
      language,
      languages,
      setLanguage: (nextLanguage) => {
        setLanguageState(nextLanguage);
        window.localStorage.setItem(MOBILE_LANGUAGE_KEY, nextLanguage);
      },
      t: (key, params) => interpolate(resources[language][key] ?? resources.en[key] ?? key, params),
    }),
    [language],
  );

  return <MobileI18nContext.Provider value={value}>{children}</MobileI18nContext.Provider>;
}

export function useMobileI18n() {
  const value = useContext(MobileI18nContext);
  if (!value) throw new Error('useMobileI18n must be used inside MobileI18nProvider');
  return value;
}

function detectInitialLanguage(): MobileLanguage {
  const stored = window.localStorage.getItem(MOBILE_LANGUAGE_KEY);
  if (stored === 'en' || stored === 'zh-CN') return stored;

  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en';
}

function interpolate(value: string, params?: TranslationParams): string {
  if (!params) return value;
  return Object.entries(params).reduce(
    (next, [key, replacement]) => next.replaceAll(`{{${key}}}`, String(replacement)),
    value,
  );
}
