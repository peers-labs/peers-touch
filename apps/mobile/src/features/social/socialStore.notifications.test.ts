import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthSession } from '../auth/authSession';
import type { NotificationGateway } from '../../services/gateways';
vi.mock('../../runtimes/mutationAdmission', () => ({ requireMobileMutationAdmission: vi.fn() }));
import { useSocialStore } from './socialStore';
const session: MobileAuthSession = {
  stationPeerId: 'station-a', stationUrl: 'https://station.example',
  sessionId: 'session-a', deviceId: 'device-a', lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' }, authenticatedAt: 1,
};
const notification = (id: string, status = 1) => ({
  id, status, metadata: {}, type: 202, category: 1, targetType: 'friend_chat_session', targetId: 'conversation-a',
});
const outcome = <T>(data: T) => ({ ok: true, data });
function gateway() {
  return {
    listNotifications: vi.fn().mockResolvedValue(outcome({ notifications: [], nextCursor: '' })),
    getUnreadCounts: vi.fn().mockResolvedValue(outcome({ total: 0, byCategory: {} })),
    markNotificationsRead: vi.fn().mockResolvedValue(outcome(true)),
    markAllNotificationsRead: vi.fn().mockResolvedValue(outcome(true)),
    deleteNotifications: vi.fn().mockResolvedValue(outcome(true)),
  };
}
let port: ReturnType<typeof gateway>;
beforeEach(() => {
  port = gateway();
  useSocialStore.setState({
    authSession: session, notificationGateway: port as unknown as NotificationGateway,
    notifications: [], notificationNextCursor: '', notificationHasMore: false,
    unreadCounts: { total: 0, byCategory: {} }, notificationLoading: false, notificationError: null,
  });
});
afterEach(() => { useSocialStore.getState().bindSession(null); });

describe('notification authoritative readback and scope', () => {
  it('refreshes the entire retained page window and preserves its tail cursor', async () => {
    useSocialStore.setState({ notifications: Array.from({ length: 60 }, (_, i) => notification(String(i))) as never });
    port.listNotifications
      .mockResolvedValueOnce(outcome({ notifications: Array.from({ length: 30 }, (_, i) => notification(String(i), 2)), nextCursor: 'page-2' }))
      .mockResolvedValueOnce(outcome({ notifications: Array.from({ length: 30 }, (_, i) => notification(String(i + 30), 2)), nextCursor: 'page-3' }));
    await useSocialStore.getState().markNotificationRead('50');
    expect(port.listNotifications.mock.calls).toEqual([[30, undefined], [30, 'page-2']]);
    expect(useSocialStore.getState().notifications).toHaveLength(60);
    expect(useSocialStore.getState().notificationNextCursor).toBe('page-3');
    expect(useSocialStore.getState().notifications.find(n => n.id === '50')?.status).toBe(2);
  });

  it('rejects successful writes whose readback still shows unread or undeleted data', async () => {
    port.listNotifications.mockResolvedValue(outcome({ notifications: [notification('n')], nextCursor: '' }));
    await expect(useSocialStore.getState().markNotificationRead('n')).rejects.toThrow('mobile.notifications.readbackFailed');
    await expect(useSocialStore.getState().deleteNotification('n')).rejects.toThrow('mobile.notifications.readbackFailed');
    port.getUnreadCounts.mockResolvedValue(outcome({ total: 1, byCategory: {} }));
    await expect(useSocialStore.getState().markAllNotificationsRead()).rejects.toThrow('mobile.notifications.readbackFailed');
    expect(useSocialStore.getState().notifications[0]?.status).toBe(1);
  });

  it('ignores a refresh from the outgoing session while the replacement session finishes independently', async () => {
    let finish!: (data: unknown) => void;
    port.listNotifications.mockReturnValue(new Promise(done => { finish = done; }));
    const old = useSocialStore.getState().refreshNotifications();
    const next = gateway();
    next.listNotifications.mockResolvedValue(outcome({ notifications: [notification('bob')], nextCursor: '' }));
    useSocialStore.setState({ authSession: { ...session, sessionId: 'bob' }, notificationGateway: next as unknown as NotificationGateway });
    await useSocialStore.getState().refreshNotifications();
    finish(outcome({ notifications: [notification('alice-private')], nextCursor: '' }));
    await old;
    expect(useSocialStore.getState().notifications.map(n => n.id)).toEqual(['bob']);
    expect(port.getUnreadCounts).not.toHaveBeenCalled();
  });

  it('prevents late outgoing-actor writes from refreshing the next actor', async () => {
    let finish!: (data: unknown) => void;
    port.markNotificationsRead.mockReturnValue(new Promise(done => { finish = done; }));
    const write = useSocialStore.getState().markNotificationRead('alice');
    const rejected = expect(write).rejects.toThrow('mobile.social.notAuthenticated');
    useSocialStore.setState({ authSession: { ...session, sessionId: 'bob' } });
    finish(outcome(true));
    await rejected;
    expect(port.listNotifications).not.toHaveBeenCalled();
  });

  it('reports a repeated pagination cursor and retains existing rows for retry', async () => {
    useSocialStore.setState({ notifications: [notification('retained')] as never, notificationNextCursor: 'page-2', notificationHasMore: true });
    port.listNotifications.mockResolvedValue(outcome({ notifications: [], nextCursor: 'page-2' }));
    await expect(useSocialStore.getState().loadMoreNotifications()).rejects.toThrow('mobile.notifications.readbackFailed');
    expect(useSocialStore.getState().notifications.map(n => n.id)).toEqual(['retained']);
    expect(useSocialStore.getState().notificationLoading).toBe(false);
    expect(useSocialStore.getState().notificationError).not.toBeNull();
  });
});
