import { mobilePersonalizationScope } from './personalizationScope';

export type MobileLanguage = 'en' | 'zh-CN';
const LANGUAGE_KEY = 'peers-touch.mobile.language';
type LanguageSnapshot = {
  language: MobileLanguage;
  status: 'idle' | 'saving' | 'failed';
  error: string | null;
};

export function systemMobileLanguage(): MobileLanguage {
  return globalThis.navigator?.language.startsWith('zh') ? 'zh-CN' : 'en';
}

let snapshot: LanguageSnapshot | null = null;
let failedLanguage: MobileLanguage | null = null;
let revision = 0;
const listeners = new Set<() => void>();
const publish = (next: LanguageSnapshot) => {
  snapshot = Object.freeze(next);
  if (globalThis.document) document.documentElement.lang = next.language;
  listeners.forEach((listener) => listener());
};

export function readMobileLanguageSnapshot(): LanguageSnapshot {
  return snapshot ??= Object.freeze({ language: systemMobileLanguage(), status: 'idle', error: null });
}

async function loadLanguage(): Promise<boolean> {
  const scope = mobilePersonalizationScope.capture();
  const observed = ++revision;
  const current = () => scope.current() && observed === revision;
  try {
    const raw = await scope.read(LANGUAGE_KEY);
    if (raw !== null && (typeof raw !== 'object' || !('language' in raw)
      || (raw.language !== 'en' && raw.language !== 'zh-CN'))) {
      throw new Error('mobile.settings.language.loadFailed');
    }
    if (!current()) return false;
    publish({ language: raw === null ? systemMobileLanguage() : raw.language as MobileLanguage, status: 'idle', error: null });
    return true;
  } catch {
    if (current()) publish({ ...readMobileLanguageSnapshot(), status: 'failed', error: 'mobile.settings.language.loadFailed' });
    return false;
  }
}

export function setMobileLanguage(language: MobileLanguage): Promise<boolean> {
  const scope = mobilePersonalizationScope.capture();
  const observed = ++revision;
  const current = () => scope.current() && observed === revision;
  if (!scope.authenticated) {
    publish({ language, status: 'idle', error: null });
    return Promise.resolve(true);
  }
  publish({ ...readMobileLanguageSnapshot(), status: 'saving', error: null });
  return mobilePersonalizationScope.enqueue(async () => {
    if (!current()) return false;
    try {
      await scope.write(LANGUAGE_KEY, { language });
      const readback = await scope.read(LANGUAGE_KEY);
      if (!current()) return false;
      if (!readback || readback.language !== language) throw new Error('language readback failed');
      failedLanguage = null;
      publish({ language, status: 'idle', error: null });
      return true;
    } catch {
      if (current()) {
        failedLanguage = language;
        publish({ ...readMobileLanguageSnapshot(), status: 'failed', error: 'mobile.settings.language.saveFailed' });
      }
      return false;
    }
  });
}

export function retryMobileLanguage(): Promise<boolean> {
  return failedLanguage ? setMobileLanguage(failedLanguage) : loadLanguage();
}

export function subscribeMobileLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function installMobileLanguageRuntime(): () => void {
  const reset = () => {
    failedLanguage = null;
    publish({ language: systemMobileLanguage(), status: 'idle', error: null });
    void loadLanguage();
  };
  const unsubscribe = mobilePersonalizationScope.subscribe(reset);
  const release = mobilePersonalizationScope.retain();
  reset();
  return () => {
    revision += 1;
    failedLanguage = null;
    publish({ language: systemMobileLanguage(), status: 'idle', error: null });
    unsubscribe();
    release();
  };
}
