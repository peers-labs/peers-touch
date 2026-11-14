// Pure error-key resolution for native runtime errors. Kept free of i18n
// runtime/React imports so runtimes (which sit below the language runtime in
// the module graph) can classify errors without creating an import cycle.

export type MobileTranslationFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

// Native runtimes report errors as "stable.locale.key:diagnostic-detail".
// Only the part before the first ':' is a translation key; the suffix carries
// HTTP statuses and transport text for logs, never for the UI.
const MOBILE_ERROR_KEY_PATTERN = /(mobile\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)/;

export function mobileErrorKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.match(MOBILE_ERROR_KEY_PATTERN)?.[1] ?? null;
}

// Resolve any native/UI error string to human-readable copy. Never surfaces a
// raw locale key or transport detail: unknown keys fall back to the supplied
// generic key instead.
export function translateMobileError(
  t: MobileTranslationFn,
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
