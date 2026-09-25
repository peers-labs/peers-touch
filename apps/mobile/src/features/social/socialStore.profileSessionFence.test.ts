import type { CacheReadResult } from '@peers-touch/client-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import {
  createMobileClientStorageRuntime,
  type MobileClientStorageRuntime,
} from '../../storage/mobileClientStorage';
import {
  createProfileGateway,
  type ProfileGateway,
} from '../../services/gateways/profileGateway';
import { ProfileUpdateOutcome } from '../../gen/proto/domain/actor/actor_pb';
import { SocialApiError, type PeerProfile } from './socialTypes';
import { useSocialStore } from './socialStore';

const oldSession = session('station-a', 'ptid:alice');
const replacementSession = session('station-b', 'ptid:carol');
const oldCurrentProfile = profile('ptid:alice', 'Old Alice');
const oldPeerProfile = profile('ptid:bob', 'Old Bob');
const replacementProfile = profile('ptid:carol', 'Current Carol');
const replacementPeerProfile = profile('ptid:bob', 'Current Bob');
const replacementError = new SocialApiError({
  method: 'GET',
  path: '/replacement-profile',
  message: 'mobile.profile.replacementError',
});

type ProfileOutcome = Awaited<ReturnType<ProfileGateway['getPeerProfile']>>;
type ProfileMutationOutcome = Awaited<ReturnType<ProfileGateway['updateCurrentProfile']>>;

describe('Social profile session fencing', () => {
  beforeEach(() => {
    useSocialStore.setState(useSocialStore.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSocialStore.setState(useSocialStore.getInitialState(), true);
  });

  it.each(['success', 'error'] as const)(
    'discards a late current-profile cache %s after session replacement',
    async (completion) => {
      const { gateway, storage } = installSession(oldSession);
      const cached = deferred<CacheReadResult<unknown>>();
      const read = vi.spyOn(storage.repositories.peerProfiles, 'read')
        .mockReturnValue(cached.promise);
      const network = vi.spyOn(gateway, 'getPeerProfile');
      const pending = useSocialStore.getState().loadCurrentUserProfile();

      replaceSessionProjection();
      if (completion === 'success') cached.resolve(cacheHit(oldCurrentProfile, oldSession));
      else cached.reject(new Error('old cache failed'));

      await expect(pending).resolves.toBeUndefined();
      expect(read).toHaveBeenCalledWith(oldSession.actorRef.ptid);
      expect(network).not.toHaveBeenCalled();
      expectReplacementProjection();
    },
  );

  it.each(['success', 'error'] as const)(
    'discards a late current-profile network %s after logout',
    async (completion) => {
      const { gateway, storage } = installSession(oldSession);
      const result = deferred<ProfileOutcome>();
      vi.spyOn(gateway, 'getPeerProfile').mockReturnValue(result.promise);
      const write = vi.spyOn(storage.repositories.peerProfiles, 'write');
      const pending = useSocialStore.getState().loadCurrentUserProfile(true);

      useSocialStore.getState().bindSession(null);
      if (completion === 'success') result.resolve(success(oldCurrentProfile));
      else result.reject(new Error('old network failed'));

      await expect(pending).resolves.toBeUndefined();
      expect(write).not.toHaveBeenCalled();
      expect(useSocialStore.getState()).toMatchObject({
        authSession: null,
        currentUserProfile: null,
        peerProfiles: {},
        error: null,
      });
    },
  );

  it('does not publish a current profile after its old scoped cache write finishes', async () => {
    const { gateway, storage } = installSession(oldSession);
    vi.spyOn(gateway, 'getPeerProfile').mockResolvedValue(success(oldCurrentProfile));
    const persisted = deferred<NonNullable<CacheReadResult<unknown>['envelope']>>();
    const write = vi.spyOn(storage.repositories.peerProfiles, 'write')
      .mockReturnValue(persisted.promise);
    const pending = useSocialStore.getState().loadCurrentUserProfile(true);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

    replaceSessionProjection();
    persisted.resolve(cacheEnvelope(oldCurrentProfile, oldSession));

    await expect(pending).resolves.toBeUndefined();
    expectReplacementProjection();
  });

  it('keeps lifecycle drain pending until a scoped profile cache write settles', async () => {
    const { gateway, storage } = installSession(oldSession);
    vi.spyOn(gateway, 'getPeerProfile').mockResolvedValue(success(oldCurrentProfile));
    const persisted = deferred<NonNullable<CacheReadResult<unknown>['envelope']>>();
    const write = vi.spyOn(storage.repositories.peerProfiles, 'write')
      .mockReturnValue(persisted.promise);
    const profileRead = useSocialStore.getState().loadCurrentUserProfile(true);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

    let drained = false;
    const drain = useSocialStore.getState().drainProfileCacheWrites()
      .then(() => {
        drained = true;
      });
    await Promise.resolve();
    expect(drained).toBe(false);

    persisted.resolve(cacheEnvelope(oldCurrentProfile, oldSession));
    await Promise.all([profileRead, drain]);
    expect(drained).toBe(true);
  });

  it.each(['success', 'error'] as const)(
    'rejects a late profile mutation %s with a typed replacement-session failure',
    async (completion) => {
      const { gateway, storage } = installSession(oldSession);
      useSocialStore.setState({ currentUserProfile: oldCurrentProfile });
      const result = deferred<ProfileMutationOutcome>();
      vi.spyOn(gateway, 'updateCurrentProfile').mockReturnValue(result.promise);
      const oldWrite = vi.spyOn(storage.repositories.peerProfiles, 'write');
      const pending = useSocialStore.getState().updateCurrentUserProfile({
        displayName: oldCurrentProfile.displayName,
      });

      const replacement = replaceSessionProjection();
      const replacementWrite = vi.spyOn(replacement.storage.repositories.peerProfiles, 'write');
      if (completion === 'success') {
        result.resolve(profileMutationSuccess(oldCurrentProfile));
      }
      else result.reject(new Error('old mutation failed'));

      await expect(pending).rejects.toMatchObject({
        name: 'SocialApiError',
        context: {
          method: 'POST',
          path: '/actor/profile',
          message: 'mobile.social.notAuthenticated',
        },
      });
      expect(oldWrite).not.toHaveBeenCalled();
      expect(replacementWrite).not.toHaveBeenCalled();
      expectReplacementProjection();
    },
  );

  it('rejects a profile mutation replaced during its old scoped cache write', async () => {
    const { gateway, storage } = installSession(oldSession);
    useSocialStore.setState({ currentUserProfile: oldCurrentProfile });
    vi.spyOn(gateway, 'updateCurrentProfile')
      .mockResolvedValue(profileMutationSuccess(oldCurrentProfile));
    const persisted = deferred<NonNullable<CacheReadResult<unknown>['envelope']>>();
    const oldWrite = vi.spyOn(storage.repositories.peerProfiles, 'write')
      .mockReturnValue(persisted.promise);
    const pending = useSocialStore.getState().updateCurrentUserProfile({
      displayName: oldCurrentProfile.displayName,
    });
    await vi.waitFor(() => expect(oldWrite).toHaveBeenCalledOnce());

    const replacement = replaceSessionProjection();
    const replacementWrite = vi.spyOn(replacement.storage.repositories.peerProfiles, 'write');
    persisted.resolve(cacheEnvelope(oldCurrentProfile, oldSession));

    await expect(pending).rejects.toMatchObject({
      name: 'SocialApiError',
      context: { message: 'mobile.social.notAuthenticated' },
    });
    expect(replacementWrite).not.toHaveBeenCalled();
    expectReplacementProjection();
  });

  it.each(['success', 'error'] as const)(
    'preserves replacement peer flags after an old-session network %s',
    async (completion) => {
      const { gateway, storage } = installSession(oldSession);
      const result = deferred<ProfileOutcome>();
      vi.spyOn(gateway, 'getPeerProfile').mockReturnValue(result.promise);
      const write = vi.spyOn(storage.repositories.peerProfiles, 'write');
      const pending = useSocialStore.getState().loadPeerProfile(oldPeerProfile.id, true);
      expect(useSocialStore.getState().peerProfileLoading[oldPeerProfile.id]).toBe(true);

      replaceSessionProjection();
      if (completion === 'success') result.resolve(success(oldPeerProfile));
      else result.reject(new Error('old peer request failed'));

      await expect(pending).resolves.toBeUndefined();
      expect(write).not.toHaveBeenCalled();
      expectReplacementProjection();
    },
  );

  it('does not publish peer data after its old scoped cache write finishes', async () => {
    const { gateway, storage } = installSession(oldSession);
    vi.spyOn(gateway, 'getPeerProfile').mockResolvedValue(success(oldPeerProfile));
    const persisted = deferred<NonNullable<CacheReadResult<unknown>['envelope']>>();
    const write = vi.spyOn(storage.repositories.peerProfiles, 'write')
      .mockReturnValue(persisted.promise);
    const pending = useSocialStore.getState().loadPeerProfile(oldPeerProfile.id, true);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

    replaceSessionProjection();
    persisted.resolve(cacheEnvelope(oldPeerProfile, oldSession));

    await expect(pending).resolves.toBeUndefined();
    expectReplacementProjection();
  });

  it.each(['success', 'error'] as const)(
    'discards a late peer-profile cache %s after session replacement',
    async (completion) => {
      const { gateway, storage } = installSession(oldSession);
      const cached = deferred<CacheReadResult<unknown>>();
      const read = vi.spyOn(storage.repositories.peerProfiles, 'read')
        .mockReturnValue(cached.promise);
      const network = vi.spyOn(gateway, 'getPeerProfile');
      const pending = useSocialStore.getState().loadPeerProfile(oldPeerProfile.id);

      replaceSessionProjection();
      if (completion === 'success') cached.resolve(cacheHit(oldPeerProfile, oldSession));
      else cached.reject(new Error('old peer cache failed'));

      await expect(pending).resolves.toBeUndefined();
      expect(read).toHaveBeenCalledWith(oldPeerProfile.id);
      expect(network).not.toHaveBeenCalled();
      expectReplacementProjection();
    },
  );

  it('keeps current-session profile reads and mutations functional', async () => {
    const { gateway, storage } = installSession(oldSession);
    const updatedProfile = profile(oldSession.actorRef.ptid, 'Updated Alice');
    vi.spyOn(gateway, 'getPeerProfile')
      .mockResolvedValueOnce(success(oldCurrentProfile))
      .mockResolvedValueOnce(success(oldPeerProfile));
    vi.spyOn(gateway, 'updateCurrentProfile')
      .mockResolvedValue(profileMutationSuccess(updatedProfile));
    const write = vi.spyOn(storage.repositories.peerProfiles, 'write');

    await useSocialStore.getState().loadCurrentUserProfile(true);
    await useSocialStore.getState().loadPeerProfile(oldPeerProfile.id, true);
    await expect(useSocialStore.getState().updateCurrentUserProfile({
      displayName: updatedProfile.displayName,
    })).resolves.toEqual({
      outcome: ProfileUpdateOutcome.APPLIED,
      profile: updatedProfile,
    });

    expect(write.mock.calls).toEqual([
      [oldSession.actorRef.ptid, oldCurrentProfile],
      [oldPeerProfile.id, oldPeerProfile],
      [oldSession.actorRef.ptid, updatedProfile],
    ]);
    expect(useSocialStore.getState()).toMatchObject({
      currentUserProfile: updatedProfile,
      peerProfiles: {
        [oldSession.actorRef.ptid]: updatedProfile,
        [oldPeerProfile.id]: oldPeerProfile,
      },
      peerProfileLoading: { [oldPeerProfile.id]: false },
      peerProfileErrors: { [oldPeerProfile.id]: null },
      error: null,
    });
  });
});

function installSession(authSession: MobileAuthSession): {
  gateway: ProfileGateway;
  storage: MobileClientStorageRuntime;
} {
  const gateway = createProfileGateway(authSession);
  const storage = createMobileClientStorageRuntime(authSession);
  useSocialStore.setState({
    sessionKey: mobileAuthScopeKey(authSession),
    authSession,
    currentUserPtid: authSession.actorRef.ptid,
    profileGateway: gateway,
    storage,
  });
  return { gateway, storage };
}

function replaceSessionProjection(): {
  gateway: ProfileGateway;
  storage: MobileClientStorageRuntime;
} {
  useSocialStore.getState().bindSession(replacementSession);
  const state = useSocialStore.getState();
  if (!state.profileGateway || !state.storage) {
    throw new Error('replacement profile owners were not installed');
  }
  useSocialStore.setState({
    currentUserProfile: replacementProfile,
    peerProfiles: {
      [replacementSession.actorRef.ptid]: replacementProfile,
      [oldPeerProfile.id]: replacementPeerProfile,
    },
    peerProfileLoading: { [oldPeerProfile.id]: true },
    peerProfileErrors: { [oldPeerProfile.id]: replacementError },
    error: replacementError,
  });
  return { gateway: state.profileGateway, storage: state.storage };
}

function expectReplacementProjection(): void {
  expect(useSocialStore.getState()).toMatchObject({
    sessionKey: mobileAuthScopeKey(replacementSession),
    authSession: replacementSession,
    currentUserPtid: replacementSession.actorRef.ptid,
    currentUserProfile: replacementProfile,
    peerProfiles: {
      [replacementSession.actorRef.ptid]: replacementProfile,
      [oldPeerProfile.id]: replacementPeerProfile,
    },
    peerProfileLoading: { [oldPeerProfile.id]: true },
    peerProfileErrors: { [oldPeerProfile.id]: replacementError },
    error: replacementError,
  });
}

function session(stationPeerId: string, ptid: string): MobileAuthSession {
  return {
    stationPeerId,
    stationUrl: `https://${stationPeerId}.example`,
    sessionId: `${stationPeerId}-${ptid}`,
    actorRef: { ptid },
    authenticatedAt: 1,
  };
}

function profile(id: string, displayName: string): PeerProfile {
  return {
    id,
    profileRevision: 1n,
    username: id.replace('ptid:', ''),
    acct: id.replace('ptid:', ''),
    displayName,
    note: '',
    url: '',
    avatar: '',
    header: '',
    locked: false,
    createdAt: '',
    statusesCount: 0,
    followingCount: 0,
    followersCount: 0,
    region: '',
    timezone: '',
    tags: [],
    links: [],
    defaultVisibility: '',
    manuallyApprovesFollowers: false,
    messagePermission: '',
    autoExpireDays: 0,
    networkId: '',
  };
}

function success(value: PeerProfile): ProfileOutcome {
  return { ok: true, data: value };
}

function profileMutationSuccess(value: PeerProfile): ProfileMutationOutcome {
  return {
    ok: true,
    data: {
      outcome: ProfileUpdateOutcome.APPLIED,
      profile: value,
    },
  };
}

function cacheHit(value: PeerProfile, authSession: MobileAuthSession): CacheReadResult<unknown> {
  return {
    envelope: cacheEnvelope(value, authSession),
    hit: true,
    stale: false,
  };
}

function cacheEnvelope(
  value: PeerProfile,
  authSession: MobileAuthSession,
): NonNullable<CacheReadResult<unknown>['envelope']> {
  return {
    schemaVersion: 1,
    domain: 'profile.peer',
    key: value.id,
    scope: {
      app: 'mobile',
      station: authSession.stationPeerId,
      actor: authSession.actorRef.ptid,
      session: mobileAuthScopeKey(authSession),
    },
    value,
    cachedAt: 1,
    expiresAt: null,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
