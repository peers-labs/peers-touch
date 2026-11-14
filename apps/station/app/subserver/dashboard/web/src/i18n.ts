import i18next from 'i18next';
import en from '../../../../../../../packages/locales/en/dashboard.json';
import zh from '../../../../../../../packages/locales/zh-CN/dashboard.json';

const dashboardI18n = i18next.createInstance();
void dashboardI18n.init({
  lng: navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en',
  fallbackLng: 'en', resources: { en: { translation: en }, 'zh-CN': { translation: zh } },
  initAsync: false, showSupportNotice: false, interpolation: { escapeValue: false },
});
export const t = (key: string, values?: Record<string, string | number>) => dashboardI18n.t(key, values);
