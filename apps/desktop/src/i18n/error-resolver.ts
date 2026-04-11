// Resolve error codes or error keys to localized user-facing messages.
// Used by both Tauri RustCommandResult errors (error key strings)
// and Station ErrorResponse errors (numeric ErrorCode).
// 2026-04-09: Initial creation for i18n architecture landing.

import i18n from './index';

export function resolveError(code: number | string, fallbackMessage?: string): string {
  const key = `error.${code}`;
  const resolved = i18n.t(key, { ns: 'errors', defaultValue: '' });

  if (resolved && resolved !== key) return resolved;

  if (fallbackMessage) {
    return i18n.t('error.generic', { ns: 'errors', message: fallbackMessage });
  }

  return i18n.t('error.unknown', { ns: 'errors' });
}
