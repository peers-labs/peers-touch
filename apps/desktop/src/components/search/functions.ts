import type { Navigation } from '../../types/navigation';

// Trusted, static navigation directory. No endpoints, arbitrary URLs or scripts.
export const SEARCH_FUNCTIONS = [
  { id: 'security', keywords: '隐私 权限 安全 privacy security permissions', titleKey: 'search.function.security', detailKey: 'search.function.securityDetail', tab: 'security' },
  { id: 'general', keywords: '通用 偏好 preferences general', titleKey: 'search.function.general', detailKey: 'search.function.generalDetail', tab: 'general' },
  { id: 'account', keywords: '身份 账号 identity account', titleKey: 'search.function.account', detailKey: 'search.function.accountDetail', tab: 'account' },
  { id: 'federation', keywords: '网络 站台 联邦 network station federation', titleKey: 'search.function.federation', detailKey: 'search.function.federationDetail', tab: 'federation' },
  { id: 'storage', keywords: '存储 空间 消息保留 storage retention', titleKey: 'search.function.storage', detailKey: 'search.function.storageDetail', tab: 'storage' },
  { id: 'agent.create', keywords: '新建 创建 助手 agent create assistant', titleKey: 'search.function.agent', detailKey: 'search.function.agentDetail', tab: null },
] as const;

export type SearchFunction = typeof SEARCH_FUNCTIONS[number];
export function openSearchFunction(item: SearchFunction, navigation: Navigation): void {
  if (item.tab) navigation.navigateToSettings(item.tab);
  else navigation.navigateTo('agent');
}
