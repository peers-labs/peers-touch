import { create } from 'zustand';

import { useNotificationStore } from './notification';
import { useSocialChatStore } from './socialChat';
import { log } from '../utils/logger';

export type NavigationBadgeModule = 'chat' | 'agent' | 'notifications' | 'tasks' | 'files';
export type NavigationBadgeLevel = 'normal' | 'warning' | 'error';

export interface NavigationBadge {
  module: NavigationBadgeModule;
  count?: number;
  dot?: boolean;
  level?: NavigationBadgeLevel;
  updatedAt: number;
}

interface NavigationBadgeStore {
  badges: Record<NavigationBadgeModule, NavigationBadge>;
  chatUnreadDeltas: Record<string, number>;
  chatSurfaceVisible: boolean;
  setBadge: (badge: Omit<NavigationBadge, 'updatedAt'> & { updatedAt?: number }) => void;
  getBadge: (module: NavigationBadgeModule) => NavigationBadge;
  bumpChatUnread: (conversationUlid: string) => void;
  clearChatUnread: (conversationUlid: string) => void;
  reconcileChatBadge: () => void;
  setChatSurfaceVisible: (visible: boolean) => void;
}

const DEFAULT_MODULES: NavigationBadgeModule[] = ['chat', 'agent', 'notifications', 'tasks', 'files'];

function defaultBadge(module: NavigationBadgeModule): NavigationBadge {
  return {
    module,
    count: 0,
    dot: false,
    level: 'normal',
    updatedAt: 0,
  };
}

function initialBadges(): Record<NavigationBadgeModule, NavigationBadge> {
  return DEFAULT_MODULES.reduce((acc, module) => {
    acc[module] = defaultBadge(module);
    return acc;
  }, {} as Record<NavigationBadgeModule, NavigationBadge>);
}

function activeConversationUlidWhenVisible(visible: boolean): string | null {
  if (!visible) return null;
  const state = useSocialChatStore.getState();
  if (state.activeTab === 'friend') return state.activeSessionUlid;
  return state.activeGroupUlid;
}

function authoritativeUnreadByConversation(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    for (const conversation of useSocialChatStore.getState().getUnifiedConversations()) {
      out.set(conversation.ulid, Math.max(0, Number(conversation.unread ?? 0)));
    }
  } catch (error) {
    log.warn('navigationBadges', 'chat badge projection failed', error);
  }
  return out;
}

function nextChatProjection(
  pending: Record<string, number>,
  chatSurfaceVisible: boolean,
): { count: number; pending: Record<string, number> } {
  const authoritative = authoritativeUnreadByConversation();
  const activeUlid = activeConversationUlidWhenVisible(chatSurfaceVisible);
  const nextPending: Record<string, number> = {};

  for (const [ulid, count] of Object.entries(pending)) {
    const pendingCount = Math.max(0, Number(count || 0));
    if (pendingCount === 0) continue;
    if (ulid === activeUlid) continue;

    const authoritativeCount = authoritative.get(ulid) ?? 0;
    if (authoritativeCount >= pendingCount) continue;
    nextPending[ulid] = pendingCount;
  }

  const allUlids = new Set<string>([
    ...Array.from(authoritative.keys()),
    ...Object.keys(nextPending),
  ]);
  let total = 0;
  for (const ulid of allUlids) {
    total += Math.max(authoritative.get(ulid) ?? 0, nextPending[ulid] ?? 0);
  }

  return { count: total, pending: nextPending };
}

export const useNavigationBadgeStore = create<NavigationBadgeStore>((set, get) => ({
  badges: initialBadges(),
  chatUnreadDeltas: {},
  chatSurfaceVisible: false,

  setBadge: (badge) => {
    set((state) => ({
      badges: {
        ...state.badges,
        [badge.module]: {
          ...state.badges[badge.module],
          ...badge,
          updatedAt: badge.updatedAt ?? Date.now(),
        },
      },
    }));
  },

  getBadge: (module) => get().badges[module] ?? defaultBadge(module),

  bumpChatUnread: (conversationUlid) => {
    const ulid = conversationUlid.trim();
    if (!ulid) return;
    if (ulid === activeConversationUlidWhenVisible(get().chatSurfaceVisible)) {
      get().clearChatUnread(ulid);
      return;
    }

    set((state) => ({
      chatUnreadDeltas: {
        ...state.chatUnreadDeltas,
        [ulid]: Math.max(0, Number(state.chatUnreadDeltas[ulid] ?? 0)) + 1,
      },
    }));
    get().reconcileChatBadge();
  },

  clearChatUnread: (conversationUlid) => {
    const ulid = conversationUlid.trim();
    if (!ulid) return;
    set((state) => {
      if (!state.chatUnreadDeltas[ulid]) return state;
      const next = { ...state.chatUnreadDeltas };
      delete next[ulid];
      return { chatUnreadDeltas: next };
    });
    get().reconcileChatBadge();
  },

  reconcileChatBadge: () => {
    set((state) => {
      const projection = nextChatProjection(state.chatUnreadDeltas, state.chatSurfaceVisible);
      return {
        chatUnreadDeltas: projection.pending,
        badges: {
          ...state.badges,
          chat: {
            ...state.badges.chat,
            module: 'chat',
            count: projection.count,
            dot: projection.count > 0,
            level: 'normal',
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  setChatSurfaceVisible: (visible) => {
    set((state) => {
      if (state.chatSurfaceVisible === visible) return state;
      return { chatSurfaceVisible: visible };
    });
    get().reconcileChatBadge();
  },
}));

let teardownProjection: (() => void) | null = null;

function projectNotificationBadge(): void {
  const count = Math.max(0, Number(useNotificationStore.getState().unreadTotal ?? 0));
  useNavigationBadgeStore.getState().setBadge({
    module: 'notifications',
    count,
    dot: count > 0,
    level: 'normal',
  });
}

function projectDefaultBadges(): void {
  for (const module of ['agent', 'tasks', 'files'] as const) {
    useNavigationBadgeStore.getState().setBadge(defaultBadge(module));
  }
}

export function installNavigationBadgeProjection(): void {
  if (teardownProjection) return;

  projectDefaultBadges();
  useNavigationBadgeStore.getState().reconcileChatBadge();
  projectNotificationBadge();

  const unsubscribeChat = useSocialChatStore.subscribe(() => {
    useNavigationBadgeStore.getState().reconcileChatBadge();
  });
  const unsubscribeNotifications = useNotificationStore.subscribe(projectNotificationBadge);

  teardownProjection = () => {
    unsubscribeChat();
    unsubscribeNotifications();
    teardownProjection = null;
  };
}

export function teardownNavigationBadgeProjection(): void {
  if (!teardownProjection) return;
  teardownProjection();
}
