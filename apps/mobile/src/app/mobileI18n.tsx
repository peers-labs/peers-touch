import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import enCommon from '../../../../packages/locales/en/common.json';
import zhCommon from '../../../../packages/locales/zh-CN/common.json';
import { createMobileAppStorageRuntime } from '../storage/mobileClientStorage';

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
  languageStatus: 'idle' | 'saving' | 'failed';
  languageError: string | null;
  setLanguage: (language: MobileLanguage) => Promise<boolean>;
  retryLanguage: () => Promise<boolean>;
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
  const [languageStatus, setLanguageStatus] =
    useState<MobileI18nContextValue['languageStatus']>('idle');
  const [languageError, setLanguageError] = useState<string | null>(null);
  const failedLanguageRef = useRef<MobileLanguage | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const requestIdRef = useRef(0);

  const setLanguage = useCallback((nextLanguage: MobileLanguage): Promise<boolean> => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setLanguageStatus('saving');
    setLanguageError(null);

    const operation = writeQueueRef.current.then(async () => {
      try {
        await persistMobileLanguage(nextLanguage);
        if (requestId === requestIdRef.current) {
          failedLanguageRef.current = null;
          setLanguageState(nextLanguage);
          setLanguageStatus('idle');
        }
        return true;
      } catch {
        if (requestId === requestIdRef.current) {
          failedLanguageRef.current = nextLanguage;
          setLanguageStatus('failed');
          setLanguageError('mobile.settings.language.saveFailed');
        }
        return false;
      }
    });
    writeQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, []);

  const retryLanguage = useCallback((): Promise<boolean> => {
    const failedLanguage = failedLanguageRef.current;
    if (failedLanguage) return setLanguage(failedLanguage);

    setLanguageStatus('saving');
    setLanguageError(null);
    return readStoredLanguage()
      .then((stored) => {
        if (stored) setLanguageState(stored);
        setLanguageStatus('idle');
        return true;
      })
      .catch(() => {
        setLanguageStatus('failed');
        setLanguageError('mobile.settings.language.loadFailed');
        return false;
      });
  }, [setLanguage]);

  const value = useMemo<MobileI18nContextValue>(
    () => ({
      language,
      languages,
      languageStatus,
      languageError,
      setLanguage,
      retryLanguage,
      t: (key, params) => interpolate(resources[language][key] ?? resources.en[key] ?? key, params),
    }),
    [
      language,
      languageError,
      languageStatus,
      retryLanguage,
      setLanguage,
    ],
  );

  useEffect(() => {
    let active = true;
    void readStoredLanguage()
      .then((stored) => {
        if (active && stored) setLanguageState(stored);
      })
      .catch(() => {
        if (active) {
          setLanguageStatus('failed');
          setLanguageError('mobile.settings.language.loadFailed');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <MobileI18nContext.Provider value={value}>{children}</MobileI18nContext.Provider>;
}

export function useMobileI18n() {
  const value = useContext(MobileI18nContext);
  if (!value) throw new Error('useMobileI18n must be used inside MobileI18nProvider');
  return value;
}

function detectInitialLanguage(): MobileLanguage {
  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en';
}

async function readStoredLanguage(): Promise<MobileLanguage | null> {
  const value = await createMobileAppStorageRuntime().repositories.chatPreferences.readValue(MOBILE_LANGUAGE_KEY);
  const language = typeof value === 'object' && value && 'language' in value ? (value as { language?: unknown }).language : value;
  return language === 'en' || language === 'zh-CN' ? language : null;
}

export async function persistMobileLanguage(
  language: MobileLanguage,
): Promise<void> {
  await createMobileAppStorageRuntime().repositories.chatPreferences.write(
    MOBILE_LANGUAGE_KEY,
    { language },
  );
}

function interpolate(value: string, params?: TranslationParams): string {
  if (!params) return value;
  return Object.entries(params).reduce(
    (next, [key, replacement]) => next.replaceAll(`{{${key}}}`, String(replacement)),
    value,
  );
}
