import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDismissedFriendRequestsStore } from './dismissedFriendRequests';

class MemoryStorage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.has(key) ? this.entries.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

describe('dismissedFriendRequests store', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    // The store follows the sessionGroups convention and reads the bare
    // `localStorage` global, so stub both the global and its window alias.
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    useDismissedFriendRequestsStore.setState({
      activeActorPtid: '',
      dismissedPeers: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates an empty set for an actor without persisted dismissals', () => {
    useDismissedFriendRequestsStore.getState().loadForActor('actor-1');
    expect(useDismissedFriendRequestsStore.getState().activeActorPtid).toBe('actor-1');
    expect(useDismissedFriendRequestsStore.getState().dismissedPeers).toEqual([]);
  });

  it('persists dismissals per actor and hides them on rehydration', () => {
    const store = useDismissedFriendRequestsStore.getState();
    store.loadForActor('actor-1');
    store.dismissPeer('peer-a');
    store.dismissPeer('peer-b');

    expect(storage.getItem('peers-dismissed-friend-requests:actor-1')).toBe(
      JSON.stringify(['peer-a', 'peer-b']),
    );

    useDismissedFriendRequestsStore.setState({
      activeActorPtid: '',
      dismissedPeers: [],
    });
    useDismissedFriendRequestsStore.getState().loadForActor('actor-1');
    const rehydrated = useDismissedFriendRequestsStore.getState();
    expect(rehydrated.isDismissed('peer-a')).toBe(true);
    expect(rehydrated.isDismissed('peer-b')).toBe(true);
    expect(rehydrated.isDismissed('peer-c')).toBe(false);
  });

  it('isolates dismissal sets between actors', () => {
    const store = useDismissedFriendRequestsStore.getState();
    store.loadForActor('actor-1');
    store.dismissPeer('peer-a');

    store.loadForActor('actor-2');
    expect(useDismissedFriendRequestsStore.getState().dismissedPeers).toEqual([]);
    expect(useDismissedFriendRequestsStore.getState().isDismissed('peer-a')).toBe(false);

    useDismissedFriendRequestsStore.getState().dismissPeer('peer-z');
    expect(storage.getItem('peers-dismissed-friend-requests:actor-1')).toBe(
      JSON.stringify(['peer-a']),
    );
    expect(storage.getItem('peers-dismissed-friend-requests:actor-2')).toBe(
      JSON.stringify(['peer-z']),
    );
  });

  it('ignores duplicate dismissals and blank identities', () => {
    const store = useDismissedFriendRequestsStore.getState();
    store.loadForActor('actor-1');
    store.dismissPeer('peer-a');
    store.dismissPeer('peer-a');
    store.dismissPeer('   ');

    expect(useDismissedFriendRequestsStore.getState().dismissedPeers).toEqual(['peer-a']);
  });

  it('recovers from corrupt persisted payloads', () => {
    storage.setItem('peers-dismissed-friend-requests:actor-9', 'not-json');
    useDismissedFriendRequestsStore.getState().loadForActor('actor-9');
    expect(useDismissedFriendRequestsStore.getState().dismissedPeers).toEqual([]);
  });
});
