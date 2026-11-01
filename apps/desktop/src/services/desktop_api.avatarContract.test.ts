import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import { api, type AvatarResolveResult, type SyncUserProfileResult } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../kernel/events/bus', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));

function rustOk(status: unknown) {
  return {
    ok: true,
    data: { command: 'cmd', status: JSON.stringify(status) },
  };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe('native avatar entry-point contract (r3.1)', () => {
  it('avatar_resolve_local parses the typed state/identity/local_path contract', async () => {
    vi.mocked(invoke).mockResolvedValue(rustOk({
      state: 'ready',
      identity: '/sub-oss/avatar.png',
      local_path: '/files/avatars/a.png',
      avatar_url: 'station-resource://local/token',
    }));

    const result = await api.avatarResolveLocal('/sub-oss/avatar.png');

    expect(result).toEqual<AvatarResolveResult>({
      state: 'ready',
      identity: '/sub-oss/avatar.png',
      local_path: '/files/avatars/a.png',
      avatar_url: 'station-resource://local/token',
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('avatar_resolve_local', {
      input: { url: '/sub-oss/avatar.png' },
    });
  });

  it('account_sync_avatar shares the same typed contract (no ad-hoc string status)', async () => {
    vi.mocked(invoke).mockResolvedValue(rustOk({
      state: 'failed',
      identity: '/sub-oss/avatar.png',
      local_path: '/files/avatars/last-good.png',
      avatar_url: '',
    }));

    const result = await api.accountSyncAvatar('/sub-oss/avatar.png');

    // Identical wire shape as avatar_resolve_local: one TS contract across
    // all three native entry points.
    expect(result).toEqual<AvatarResolveResult>({
      state: 'failed',
      identity: '/sub-oss/avatar.png',
      local_path: '/files/avatars/last-good.png',
      avatar_url: '',
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('account_sync_avatar', {
      input: { avatar_url: '/sub-oss/avatar.png' },
    });
  });

  it('sync_user_profile carries canonical identity, typed state and revision', async () => {
    vi.mocked(invoke).mockResolvedValue(rustOk({
      name: 'Alice',
      email: '',
      avatar_url: '',
      avatar_identity: '',
      avatar_local_path: null,
      avatar_state: 'absent',
      profile_revision: 7,
      profile_url: '',
      synced: true,
    }));

    const result = await api.syncUserProfile();

    expect(result).toMatchObject<Partial<SyncUserProfileResult>>({
      avatar_state: 'absent',
      avatar_identity: '',
      profile_revision: 7,
    });
  });
});
