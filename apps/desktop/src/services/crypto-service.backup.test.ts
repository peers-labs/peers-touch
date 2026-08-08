import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import { cryptoService, type RecoveryBackupMetadata } from './crypto-service';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('cryptoService recovery backup contract', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('uploads the recovery phrase and all device-independent metadata', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: {
        status: JSON.stringify({
          backup: {
            backupId: 'backup-1',
            revision: 1,
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
    const metadata: RecoveryBackupMetadata = {
      conversations: [{
        scope: 'friend',
        conversationId: 'conversation-1',
        metadata: { peerPtid: 'ptid:bob' },
      }],
      attachments: [{
        messageId: 'message-1',
        attachmentId: 'cid-1',
        metadata: { keyB64: 'key', nonceB64: 'nonce' },
      }],
      verifiedFingerprints: [{
        peerPtid: 'ptid:bob',
        fingerprint: 'abcd',
        verifiedAtUnixMs: 11,
      }],
    };

    const result = await cryptoService.createBackup('twenty four words', metadata);

    expect(result.backup.revision).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith('crypto_backup_create', {
      input: {
        recoveryPhrase: 'twenty four words',
        ...metadata,
      },
    });
  });

  it('restores only the latest Station revision', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: {
        status: JSON.stringify({
          backup: {
            backupId: 'backup-2',
            revision: 2,
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

    const result = await cryptoService.restoreLatestBackup('twenty four words');

    expect(result.deviceId).toBe('fresh-device');
    expect(invokeMock).toHaveBeenCalledWith('crypto_backup_restore_latest', {
      recoveryPhrase: 'twenty four words',
    });
  });
});
