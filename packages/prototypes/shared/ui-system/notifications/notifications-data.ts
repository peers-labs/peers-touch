/**
 * Local fixtures for the north-star notification bell.
 *
 * Migrates the visible anatomy of desktop NotificationBell (category tags,
 * read/unread state, per-item mark-read/delete, mark-all-read) without any
 * station connection or polling; every action mutates local component state.
 */

export type NotificationCategory = 'social' | 'chat' | 'system' | 'task';
export type NotificationKind = 'friend-request' | 'friend-accepted' | 'mention' | 'system' | 'task';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  category: NotificationCategory;
  title: string;
  body?: string;
  /** Display string; seeds are frozen local time labels (no polling model). */
  at: string;
  unread: boolean;
}

export const NOTIFICATION_SEEDS: AppNotification[] = [
  {
    id: 'nt-1', kind: 'mention', category: 'chat',
    title: '周禾 在「小区生活群」@了你', body: '周末书架见，记得带想交换的书。',
    at: '5 分钟前', unread: true,
  },
  {
    id: 'nt-2', kind: 'friend-request', category: 'social',
    title: '阿砚 请求加你为联系人', body: '在植物医院帖里聊过，想加个邻居',
    at: '12 分钟前', unread: true,
  },
  {
    id: 'nt-3', kind: 'friend-accepted', category: 'social',
    title: '陈屿 已接受你的联系人请求',
    at: '1 小时前', unread: true,
  },
  {
    id: 'nt-4', kind: 'task', category: 'task',
    title: '种子交换日明天开始', body: '小花园 10:00，雨天顺延。',
    at: '昨天', unread: false,
  },
  {
    id: 'nt-5', kind: 'system', category: 'system',
    title: '本机资料已备份', body: '聊天与联系人快照写入本机。',
    at: '周一', unread: false,
  },
];
