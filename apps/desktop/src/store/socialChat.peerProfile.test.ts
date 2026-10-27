import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../services/desktop_api';
import { useSessionStore } from './session';
import { useSocialChatStore } from './socialChat';

const alice = 'ptid:peer:alice';
const bob = 'ptid:peer:bob';
type PeerProfile = Awaited<ReturnType<typeof api.peerProfileGet>>;

function profile(avatar: string): PeerProfile {
  return { avatar, display_name: 'Bob', username: 'bob' } as PeerProfile;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('Social profile refresh lifecycle', () => {
  beforeEach(() => {
    useSessionStore.setState({
      authenticated: true,
      sessionEpoch: 1,
      currentUser: {
        actorPtid: alice, name: 'Alice', email: 'alice@test', loginMethod: 'password',
      },
    });
    useSocialChatStore.getState().reset();
    useSocialChatStore.setState({ currentUserPtid: alice });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSocialChatStore.getState().reset();
    useSessionStore.setState({ authenticated: false, currentUser: null });
  });

  it('preserves an already loaded peer profile when reconnect refresh fails', async () => {
    const previous = profile('previous-avatar');
    useSocialChatStore.setState({ peerProfiles: { [bob]: previous } });
    vi.spyOn(api, 'peerProfileGet').mockRejectedValue(new Error('transport unavailable'));

    await useSocialChatStore.getState().loadPeerProfile(bob, true);

    expect(useSocialChatStore.getState().peerProfiles[bob]).toBe(previous);
    expect(useSocialChatStore.getState().peerProfileLoading[bob]).toBe(false);
  });

  it('caches an initial failed read and retries it through the runtime refresh', async () => {
    const read = vi.spyOn(api, 'peerProfileGet')
      .mockRejectedValueOnce(new Error('transport unavailable'))
      .mockResolvedValueOnce(profile('restored-avatar'));
    await useSocialChatStore.getState().loadPeerProfile(bob);
    expect(useSocialChatStore.getState().peerProfiles[bob]).toBeNull();

    await useSocialChatStore.getState().loadPeerProfile(bob);
    expect(read).toHaveBeenCalledTimes(1);
    await useSocialChatStore.getState().loadPeerProfile(bob, true);
    expect(useSocialChatStore.getState().peerProfiles[bob]?.avatar).toBe('restored-avatar');
  });

  it('replaces the previous profile after a successful refresh', async () => {
    useSocialChatStore.setState({ peerProfiles: { [bob]: profile('old-avatar') } });
    const updated = profile('updated-avatar');
    vi.spyOn(api, 'peerProfileGet').mockResolvedValue(updated);

    await useSocialChatStore.getState().loadPeerProfile(bob, true);

    expect(useSocialChatStore.getState().peerProfiles[bob]).toBe(updated);
  });

  it('projects an authoritative avatar removal after a successful refresh', async () => {
    useSocialChatStore.setState({ peerProfiles: { [bob]: profile('old-avatar') } });
    const updated = profile('');
    vi.spyOn(api, 'peerProfileGet').mockResolvedValue(updated);

    await useSocialChatStore.getState().loadPeerProfile(bob, true);

    expect(useSocialChatStore.getState().peerProfiles[bob]).toBe(updated);
    expect(useSocialChatStore.getState().peerProfiles[bob]?.avatar).toBe('');
  });

  it('rejects a late profile response after the same actor projection resets', async () => {
    const pending = deferred<PeerProfile>();
    vi.spyOn(api, 'peerProfileGet').mockReturnValue(pending.promise);
    const loading = useSocialChatStore.getState().loadPeerProfile(bob);
    useSocialChatStore.getState().reset();
    pending.resolve(profile('old-scope-avatar'));
    await loading;

    expect(useSocialChatStore.getState().peerProfiles).toEqual({});
    expect(useSocialChatStore.getState().peerProfileLoading).toEqual({});
  });

  it('rejects a late profile response after a session epoch changes', async () => {
    const pending = deferred<PeerProfile>();
    vi.spyOn(api, 'peerProfileGet').mockReturnValue(pending.promise);
    const loading = useSocialChatStore.getState().loadPeerProfile(bob);
    useSessionStore.setState({ sessionEpoch: 2 });
    useSocialChatStore.getState().reset();
    pending.resolve(profile('old-session-avatar'));
    await loading;

    expect(useSocialChatStore.getState().peerProfiles).toEqual({});
  });

  it('does not overwrite a new actor projection after an old request fails', async () => {
    const pending = deferred<PeerProfile>();
    vi.spyOn(api, 'peerProfileGet').mockReturnValue(pending.promise);
    const loading = useSocialChatStore.getState().loadPeerProfile(bob);
    useSessionStore.setState({
      currentUser: {
        actorPtid: 'ptid:peer:carol', name: 'Carol', email: 'carol@test', loginMethod: 'password',
      },
    });
    useSocialChatStore.getState().reset();
    const current = profile('current-actor-avatar');
    useSocialChatStore.setState({
      peerProfiles: { [bob]: current }, peerProfileLoading: { [bob]: true },
    });
    pending.reject(new Error('old transport failed'));
    await loading;

    expect(useSocialChatStore.getState().peerProfiles[bob]).toBe(current);
    expect(useSocialChatStore.getState().peerProfileLoading[bob]).toBe(true);
  });

  it('rejects an authoritative resolve completion after the projection resets', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.federationResolve>>>();
    const stationProfile = { ...profile('station-avatar'), acct: 'bob@station.test' };
    vi.spyOn(api, 'peerProfileGet').mockResolvedValue(stationProfile);
    vi.spyOn(api, 'federationResolve').mockReturnValue(pending.promise);
    const state = useSocialChatStore.getState();
    vi.spyOn(state, 'getIMConversations').mockReturnValue([
      { peerPtid: bob, federationId: 'federation' },
    ] as ReturnType<typeof state.getIMConversations>);
    const loading = state.loadPeerProfile(bob);
    await vi.waitFor(() => expect(api.federationResolve).toHaveBeenCalled());
    state.reset();
    pending.resolve({} as Awaited<ReturnType<typeof api.federationResolve>>);
    await loading;

    expect(useSocialChatStore.getState().peerProfiles).toEqual({});
  });

  it('rejects a late self profile read after the same actor projection resets', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.actorGetMyProfile>>>();
    vi.spyOn(api, 'actorGetMyProfile').mockReturnValue(pending.promise);
    const loading = useSocialChatStore.getState().loadCurrentUserProfile();
    useSocialChatStore.getState().reset();
    pending.resolve({ actorPtid: alice, avatar: 'old-avatar' } as Awaited<ReturnType<typeof api.actorGetMyProfile>>);
    await loading;

    expect(useSocialChatStore.getState().currentUserProfile).toBeNull();
  });
});
