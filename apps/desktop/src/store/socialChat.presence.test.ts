import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSocialChatStore } from './socialChat';

describe('social chat presence revision fence', () => {
  beforeEach(() => {
    useSocialChatStore.getState().reset();
  });

  afterEach(() => {
    useSocialChatStore.getState().reset();
  });

  it('prevents an older snapshot from overwriting a newer realtime event', () => {
    const store = useSocialChatStore.getState();
    store.setPeerOnline('ptid:alice', true, 10);
    store.setPeerOnline('ptid:alice', false, 9);
    store.clearPeerPresence(['ptid:alice'], 9);

    expect(useSocialChatStore.getState().peerOnline['ptid:alice']).toBe(true);
    expect(useSocialChatStore.getState().peerPresenceRevision['ptid:alice']).toBe(10);
  });

  it('allows a newer authoritative omission to project unknown', () => {
    const store = useSocialChatStore.getState();
    store.setPeerOnline('ptid:alice', true, 10);
    store.clearPeerPresence(['ptid:alice'], 11);

    expect(useSocialChatStore.getState().peerOnline).not.toHaveProperty('ptid:alice');
    expect(useSocialChatStore.getState().peerPresenceRevision['ptid:alice']).toBe(11);
  });
});
