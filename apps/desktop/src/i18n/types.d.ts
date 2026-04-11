// i18next CustomTypeOptions declaration for compile-time key validation.
//
// NOTE: TypeSafe resources are temporarily disabled because flat-key JSON
// structure causes "Type instantiation is excessively deep" in i18next's
// recursive type resolution. Will be enabled once we migrate to nested
// JSON structure or adopt i18next-resources-to-backend type generation.
// 2026-04-09: Initial creation for i18n architecture landing.

import 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    returnNull: false;
  }
}
