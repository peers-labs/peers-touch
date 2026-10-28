import type { MobileSettingDetailId } from '../../app/navigation/navigationStore';

// Explicit Mobile navigation capabilities; no URL, executable or desktop action.
export const MOBILE_SEARCH_FUNCTIONS: readonly {
  id: MobileSettingDetailId; titleKey: string; keywords: string;
}[] = [
  { id: 'account-info', titleKey: 'mobile.settings.accountInfo', keywords: '账号 身份 个人 account identity profile' },
  { id: 'privacy-security', titleKey: 'search.function.security', keywords: '隐私 安全 权限 privacy security permissions' },
  { id: 'notifications', titleKey: 'mobile.notifications.title', keywords: '通知 声音 notifications sound' },
  { id: 'chat-settings', titleKey: 'mobile.settings.chatSettings', keywords: '聊天 消息 存储 字体 chat messages storage font' },
  { id: 'station-connection', titleKey: 'mobile.settings.stationConnection', keywords: '站台 网络 连接 station network connection' },
  { id: 'language', titleKey: 'mobile.settings.section.language', keywords: '语言 中文 英文 language English Chinese' },
];

export function findMobileSearchFunctions(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return MOBILE_SEARCH_FUNCTIONS.filter(item => words.every(word => item.keywords.toLocaleLowerCase().includes(word)));
}
