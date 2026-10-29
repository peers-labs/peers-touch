// Desktop i18n initialization.
// Loads locale resources asynchronously from Rust via Tauri command.
// The Rust layer scans config/i18n/ at runtime, discovering
// all available languages including user-downloaded packs.
// Language choice is identity-scoped personalization (L2): pre-login the
// product follows the OS language; after the authenticated-actor edge the
// actor's own choice is applied and never leaks to another sign-in on the
// same machine. See
// docs/architecture/platform/client/settings-ownership.md.

import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { RustCommandResult } from '../services/desktop_api';
import { log } from '../utils/logger';
import {
  PERSONALIZATION_LANGUAGE_KEY,
  readPersonalization,
  writePersonalization,
  capturePersonalizationScope,
  isPersonalizationScopeCurrent,
} from '../runtimes/personalization';

const i18n = createInstance();

export interface LanguageInfo {
  code: string;
  name: string | null;
  native_name: string | null;
  namespaces: string[];
}

export interface I18nResources {
  languages: LanguageInfo[];
  resources: Record<string, Record<string, Record<string, string>>>;
}

let availableLanguages: LanguageInfo[] = [];
let generation = 0;
let languageEffects = Promise.resolve();

function applyLanguage(lang: string, current: () => boolean): Promise<void> {
  const operation = languageEffects.then(async () => {
    if (current() && i18n.language !== lang) await i18n.changeLanguage(lang);
  });
  languageEffects = operation.catch(() => undefined);
  return operation;
}

export function getAvailableLanguages(): LanguageInfo[] {
  return availableLanguages;
}

function systemLanguage(availableCodes: string[]): string {
  const nav = navigator.language;
  if (availableCodes.includes(nav)) return nav;
  if (nav.startsWith('zh') && availableCodes.includes('zh-CN')) return 'zh-CN';
  return 'en';
}

export async function initI18n() {
  let result: RustCommandResult<I18nResources> | null = null;
  let loadError: unknown = null;
  try {
    result = await Promise.race([
      invoke<RustCommandResult<I18nResources>>('i18n_load_resources'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('i18n_load_resources timed out after 10s')), 10_000)
      ),
    ]);
  } catch (error) {
    loadError = error;
  }

  if (!result?.ok || !result.data) {
    log.error(
      'i18n',
      'Failed to load resources from Tauri — using fallback',
      loadError ?? result?.error,
    );
    await i18n.use(initReactI18next).init({
      resources: {},
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      keySeparator: false,
      interpolation: { escapeValue: false },
    });
    return i18n;
  }

  const { languages, resources } = result.data;

  log.debug('i18n', 'Loaded languages', languages.map(l => l.code));
  log.debug('i18n', 'Namespaces per language', Object.fromEntries(
    Object.entries(resources).map(([lang, ns]) => [lang, Object.keys(ns)])
  ));

  availableLanguages = languages;
  // Before identity exists there is no actor personalization; the OS language
  // is the only pre-login source. The authenticated-actor edge applies the
  // actor's stored choice through applyPersonalizedLanguage().
  const lng = systemLanguage(languages.map((l) => l.code));

  await i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'en',
    defaultNS: 'common',
    keySeparator: false,
    interpolation: {
      escapeValue: false,
    },
  });

  return i18n;
}

/** Apply the authenticated actor's stored language, falling back to OS. */
export async function applyPersonalizedLanguage(): Promise<void> {
  if (availableLanguages.length === 0) return;
  const scope = capturePersonalizationScope();
  const observed = generation;
  const current = () => observed === generation && isPersonalizationScopeCurrent(scope);
  const availableCodes = availableLanguages.map((l) => l.code);
  const stored = await readPersonalization(
    PERSONALIZATION_LANGUAGE_KEY,
    scope,
  );
  if (!current()) return;
  if (stored !== null && (typeof stored !== 'string' || !availableCodes.includes(stored))) {
    throw new Error('Invalid language preference');
  }
  const next = typeof stored === 'string'
    ? stored
    : systemLanguage(availableCodes);
  await applyLanguage(next, current);
}

/** Return to the OS language after logout / before any identity exists. */
export async function resetPersonalizedLanguage(): Promise<void> {
  generation += 1;
  const observed = generation;
  if (availableLanguages.length === 0) return;
  const next = systemLanguage(availableLanguages.map((l) => l.code));
  await applyLanguage(next, () => observed === generation);
}

export function changeLanguage(lang: string) {
  // Persist before applying for an authenticated actor. A language
  // picked on the pre-login gate is an in-memory choice for this run and must
  // not become the next actor's personalization.
  const scope = capturePersonalizationScope();
  const observed = ++generation;
  const current = () => observed === generation && isPersonalizationScopeCurrent(scope);
  return writePersonalization(PERSONALIZATION_LANGUAGE_KEY, lang, scope)
    .then(() => applyLanguage(lang, current));
}

const I18N_PREFIX = 'i18n:';

export function resolveI18nValue(value: string | undefined | null): string {
  if (!value) return '';
  if (!value.startsWith(I18N_PREFIX)) return value;
  const key = value.slice(I18N_PREFIX.length);
  const resolved = i18n.t(key, { ns: 'common', defaultValue: '' });
  return (resolved && resolved !== key) ? resolved : key;
}

export default i18n;
