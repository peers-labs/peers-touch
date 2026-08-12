import { invoke } from '@tauri-apps/api/core';

import { log } from '../utils/logger';

interface RustAppResult<T> {
  ok: boolean;
  data?: {
    command: string;
    status: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  raw?: T;
}

export interface MessagingRecoveryIdentity {
  ready: boolean;
  ptid: string;
  deviceId: string;
  fingerprint: string;
}

export interface MessagingRecoveryRevision {
  backupId: string;
  revision: string;
  formatVersion: number;
  createdAtUnixMs: number;
  blobSizeBytes: number;
}

export interface MessagingRecoveryStatus {
  identity: MessagingRecoveryIdentity;
  exists: boolean;
  latest: MessagingRecoveryRevision | null;
}

export interface MessagingRecoveryResult {
  backup: MessagingRecoveryRevision;
  messageCount: number;
  conversationCount: number;
  attachmentCount: number;
  verifiedFingerprintCount: number;
}

export interface MessagingRecoveryRestoreResult extends MessagingRecoveryResult {
  deviceId: string;
  fingerprint: string;
  conversations: unknown[];
  attachments: unknown[];
  verifiedFingerprints: unknown[];
}

export class MessagingRecoveryServiceError extends Error {
  readonly command: string;
  readonly code: string;

  constructor(command: string, code: string, message: string) {
    super(`[${command}] ${message}`);
    this.name = 'MessagingRecoveryServiceError';
    this.command = command;
    this.code = code;
  }
}

async function invokeRecovery<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = payload
      ? await invoke<RustAppResult<unknown>>(command, payload)
      : await invoke<RustAppResult<unknown>>(command);
    if (!result.ok || !result.data) {
      throw new MessagingRecoveryServiceError(
        command,
        result.error?.code ?? 'INTERNAL_ERROR',
        result.error?.message ?? `${command} failed`,
      );
    }
    log.info('messaging-recovery', `${command} completed`, {
      elapsedMs: Date.now() - startedAt,
    });
    return JSON.parse(result.data.status) as T;
  } catch (error) {
    if (error instanceof MessagingRecoveryServiceError) throw error;
    throw new MessagingRecoveryServiceError(
      command,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const messagingRecoveryService = {
  status(): Promise<MessagingRecoveryStatus> {
    return invokeRecovery('messaging_recovery_status');
  },

  listRevisions(limit = 5): Promise<{ backups: MessagingRecoveryRevision[] }> {
    return invokeRecovery('messaging_recovery_list_revisions', { limit });
  },

  generatePhrase(): Promise<{ words: string[]; wordCount: number }> {
    return invokeRecovery('messaging_recovery_generate_phrase');
  },

  createRevision(recoveryPhrase: string): Promise<MessagingRecoveryResult> {
    return invokeRecovery('messaging_recovery_create_revision', {
      input: { recoveryPhrase },
    });
  },

  restoreLatest(recoveryPhrase: string): Promise<MessagingRecoveryRestoreResult> {
    return invokeRecovery('messaging_recovery_restore_latest', { recoveryPhrase });
  },
} as const;
