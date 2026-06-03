export type RuntimeStatus = 'ready' | 'planned' | 'blocked';

export interface RuntimeDescriptor {
  readonly id: string;
  readonly title: string;
  readonly status: RuntimeStatus;
  readonly owner: string;
  readonly responsibility: string;
}

export const mobileRuntimeDescriptors: RuntimeDescriptor[] = [
  {
    id: 'session',
    title: 'Session Runtime',
    status: 'planned',
    owner: 'shared client runtime',
    responsibility: 'Owns auth restore, token refresh, logout, and actor switching.',
  },
  {
    id: 'social',
    title: 'Social Runtime',
    status: 'ready',
    owner: 'mobile-web runtime projection',
    responsibility: 'Owns friend chat, contacts, notifications, realtime streams, presence, typing, and reconcile projection.',
  },
  {
    id: 'group',
    title: 'Group Runtime',
    status: 'ready',
    owner: 'mobile-web runtime projection',
    responsibility: 'Owns group list, group members, group messages, unread counts, and reconcile projection.',
  },
  {
    id: 'native-event-bridge',
    title: 'Native Event Bridge',
    status: 'ready',
    owner: 'mobile-web runtime projection',
    responsibility: 'Routes native push, deep-link, resume, and network wakeups into runtime-owned reconciliation.',
  },
  {
    id: 'sync',
    title: 'Sync Runtime',
    status: 'planned',
    owner: 'shared client runtime',
    responsibility: 'Owns cold sync, foreground stream, resume reconcile, and cursor state.',
  },
  {
    id: 'device',
    title: 'iOS Device Runtime',
    status: 'planned',
    owner: 'native plugin layer',
    responsibility: 'Owns secure storage, deep link, push, media, biometric, and Lynx host plugins.',
  },
];
