import en from '../../../locales/en.json';
import zhCN from '../../../locales/zh-CN.json';

type LocaleMessages = Record<string, string>;

const catalogs: Record<string, LocaleMessages> = {
  en: en as LocaleMessages,
  'zh-CN': zhCN as LocaleMessages,
};

function resolveLocale(): string {
  const language = globalThis.navigator?.language;
  if (language?.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en';
}

export function t(key: string): string {
  const locale = resolveLocale();
  return catalogs[locale]?.[key] ?? catalogs.en[key] ?? key;
}
