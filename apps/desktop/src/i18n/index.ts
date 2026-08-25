// Desktop i18n initialization.
// Loads locale resources asynchronously from Rust via Tauri command.
// The Rust layer scans config/i18n/ at runtime, discovering
// all available languages including user-downloaded packs.
// 2026-04-09: Initial creation for i18n architecture landing.
// 2026-04-09: Refactored to reuse RustCommandResult from desktop_api.

import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { RustCommandResult } from '../services/desktop_api';
import { log } from '../utils/logger';
import { readDesktopPreferenceSync, writeDesktopPreferenceSync } from '../storage/desktopClientStorage';

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

export function getAvailableLanguages(): LanguageInfo[] {
  return availableLanguages;
}

function detectLanguage(availableCodes: string[]): string {
  const stored = readDesktopPreferenceSync<string>('peers-touch-lang');
  if (stored && availableCodes.includes(stored)) return stored;

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
  const availableCodes = languages.map((l) => l.code);
  const lng = detectLanguage(availableCodes);

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

export function changeLanguage(lang: string) {
  i18n.changeLanguage(lang);
  writeDesktopPreferenceSync('peers-touch-lang', lang);
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
