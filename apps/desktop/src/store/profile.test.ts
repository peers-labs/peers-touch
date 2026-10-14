import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile } from '../services/desktop_api';

const api = vi.hoisted(() => ({
  profileGet: vi.fn(),
  profileUpdate: vi.fn(),
  profileUploadAvatarOss: vi.fn(),
  profileUploadHeaderOss: vi.fn(),
}));
const session = vi.hoisted(() => ({ actorPtid: 'ptid:self', sessionEpoch: 1 }));
vi.mock('../services/desktop_api', () => ({ api }));
vi.mock('./session', () => ({
  currentAuthenticatedActorPtid: () => session.actorPtid,
  useSessionStore: { getState: () => session },
}));
import { useProfileStore } from './profile';

function profile(revision: number, name = 'Alice'): AccountProfile {
  return {
    id: 'storage-id', profile_revision: revision, username: 'alice', acct: 'alice@station',
    display_name: name, note: '', url: '', avatar: '', header: '', locked: false,
    created_at: '', statuses_count: 0, following_count: 0, followers_count: 0,
    region: '', timezone: '', tags: [], links: [], default_visibility: '',
    manually_approves_followers: false, contact_policy: 'anyone',
    federation_visibility: {}, auto_expire_days: 0, federated_handle: 'alice@station',
    home_station_peer_id: '', home_station_domain: 'station', discoverability: 'hidden',
    peers_touch: { network_id: 'ptid:self' },
  };
}

describe('canonical account profile projection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    session.actorPtid = 'ptid:self';
    session.sessionEpoch = 1;
    useProfileStore.getState().reset();
  });

  it('keeps a mutation newer than a delayed read', async () => {
    let complete!: (value: AccountProfile) => void;
    api.profileGet.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const read = useProfileStore.getState().refresh();
    api.profileUpdate.mockResolvedValueOnce({
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED', profile: profile(8, 'Updated'),
    });
    await useProfileStore.getState().update({ display_name: 'Updated', observed_revision: 7 });
    complete(profile(7));
    await read;
    expect(useProfileStore.getState().profile?.display_name).toBe('Updated');
    expect(useProfileStore.getState().profile?.profile_revision).toBe(8);
  });

  it('retains the conflict snapshot without replaying the old draft', async () => {
    const input = { display_name: 'Old draft', observed_revision: 7 };
    api.profileUpdate.mockResolvedValueOnce({
      outcome: 'PROFILE_UPDATE_OUTCOME_CONFLICT', profile: profile(9, 'Other device'),
    });
    const result = await useProfileStore.getState().update(input);
    expect(result.outcome).toBe('PROFILE_UPDATE_OUTCOME_CONFLICT');
    expect(api.profileUpdate).toHaveBeenCalledTimes(1);
    expect(api.profileUpdate).toHaveBeenCalledWith(input);
    expect(input.observed_revision).toBe(7);
    expect(useProfileStore.getState()).toMatchObject({
      error: 'provider.account.profile.conflict', saving: false,
      profile: { profile_revision: 9, display_name: 'Other device' },
    });
  });

  it('rejects old-session reads even when the same actor logs in again', async () => {
    let complete!: (value: AccountProfile) => void;
    api.profileGet.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const read = useProfileStore.getState().refresh();
    session.sessionEpoch += 1;
    useProfileStore.getState().reset();
    complete(profile(7));
    await read;
    expect(useProfileStore.getState().profile).toBeNull();
  });

  it('does not publish a different actor returned by the transport', async () => {
    const wrongActor = profile(7);
    wrongActor.peers_touch.network_id = 'ptid:other';
    api.profileGet.mockResolvedValueOnce(wrongActor);
    await useProfileStore.getState().refresh();
    expect(useProfileStore.getState().profile).toBeNull();
    expect(useProfileStore.getState().error).toBe('provider.account.failedToLoad');
  });
});
