// TypeSafe: export master language (en) types for i18next CustomTypeOptions.
// When JSON files change, types auto-update via `typeof` inference.
// 2026-04-09: Initial creation for i18n architecture landing.

import common from './en/common.json';
import auth from './en/auth.json';
import errors from './en/errors.json';

export interface Resources {
  common: typeof common;
  auth: typeof auth;
  errors: typeof errors;
}
