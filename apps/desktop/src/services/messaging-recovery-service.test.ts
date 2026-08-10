import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messagingRecoveryService } from './messaging-recovery-service';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('messagingRecoveryService', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('creates a canonical revision from only the recovery phrase', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: {
        status: JSON.stringify({
          backup: {
            backupId: 'revision-1',
            revision: 'revision-1',
            formatVersion: 1,
            createdAtUnixMs: 10,
            blobSizeBytes: 20,
          },
          messageCount: 1,
          conversationCount: 1,
          attachmentCount: 1,
          verifiedFingerprintCount: 1,
        }),
      },
    });

    const result = await messagingRecoveryService.createRevision('twenty four words');

    expect(result.backup.revision).toBe('revision-1');
    expect(invokeMock).toHaveBeenCalledWith('messaging_recovery_create_revision', {
      input: { recoveryPhrase: 'twenty four words' },
    });
  });

  it('restores the latest canonical revision', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: {
        status: JSON.stringify({
          backup: {
            backupId: 'revision-2',
            revision: 'revision-2',
            formatVersion: 1,
            createdAtUnixMs: 20,
            blobSizeBytes: 30,
          },
          deviceId: 'fresh-device',
          fingerprint: 'actor-fingerprint',
          messageCount: 3,
          conversationCount: 1,
          attachmentCount: 1,
          verifiedFingerprintCount: 1,
          conversations: [],
          attachments: [],
          verifiedFingerprints: [],
        }),
      },
    });

    const result = await messagingRecoveryService.restoreLatest('twenty four words');

    expect(result.deviceId).toBe('fresh-device');
    expect(invokeMock).toHaveBeenCalledWith('messaging_recovery_restore_latest', {
      recoveryPhrase: 'twenty four words',
    });
  });
});
