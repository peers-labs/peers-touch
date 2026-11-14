import { beforeEach, expect, it, vi } from 'vitest';
import { createFeedbackChannel } from '@peers-touch/ui';

const session = vi.hoisted(() => ({
  authenticated: true,
  currentUser: { actorPtid: 'ptid:alice' } as { actorPtid: string } | null,
  stationPeerId: 'station-a' as string | null,
  sessionEpoch: 1,
}));
const listeners = vi.hoisted(() => new Set<(state: typeof session) => void>());
vi.mock('../store/session', () => ({
  useSessionStore: {
    getState: () => session,
    subscribe: (listener: (state: typeof session) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
}));
import { bindFeedbackSession, captureScopedFeedback } from './useAppFeedback';

beforeEach(() => {
  listeners.clear();
  Object.assign(session, {
    authenticated: true, currentUser: { actorPtid: 'ptid:alice' },
    stationPeerId: 'station-a', sessionEpoch: 1,
  });
});

it('dismisses existing notices and confirmations while dropping delayed outgoing results', async () => {
  const channel = createFeedbackChannel();
  const events: unknown[] = [];
  channel.notices.subscribe(event => events.push(event));
  const dispose = bindFeedbackSession(channel);
  const alice = captureScopedFeedback(channel, () => true);
  alice.success('alice result');
  const confirmation = channel.requestConfirmation({ title: 'alice action' });
  session.currentUser = { actorPtid: 'ptid:bob' };
  session.sessionEpoch += 1;
  for (const listener of listeners) listener(session);
  expect(events).toHaveLength(2);
  expect(events[1]).toEqual({ dismiss: 'notice.1' });
  await expect(confirmation).resolves.toBe(false);
  alice.error('late alice result');
  expect(events).toHaveLength(2);
  captureScopedFeedback(channel, () => true).success('bob result');
  expect(events).toHaveLength(3);
  dispose();
  expect(events[3]).toEqual({ dismiss: 'notice.3' });
  expect(listeners.size).toBe(0);
});

it('fences same-actor session replacement, Station change, logout and unmounted consumers', () => {
  const channel = createFeedbackChannel();
  const publish = vi.fn();
  channel.notices.subscribe(publish);
  const first = captureScopedFeedback(channel, () => true);
  session.sessionEpoch += 1;
  first.warning('replaced session');
  const second = captureScopedFeedback(channel, () => true);
  session.stationPeerId = 'station-b';
  second.error('old Station');
  const third = captureScopedFeedback(channel, () => true);
  session.authenticated = false;
  third.success('logged out');
  captureScopedFeedback(channel, () => true).error('unauthenticated');
  session.authenticated = true;
  captureScopedFeedback(channel, () => false).error('unmounted');
  expect(publish).not.toHaveBeenCalled();
});
