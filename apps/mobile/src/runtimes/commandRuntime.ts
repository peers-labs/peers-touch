// Command Runtime — Mobile InteractionAdmission adapter.
//
// This runtime wraps the Rust CommandLedger and DraftStore via Tauri
// invoke calls, exposing a typed InteractionAdmission interface to
// the Mobile Shell.  It projects pending / failed / unknown state
// for UI consumption and provides draft restoration ports consumed
// by W3's lifecycle kernel.

import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Domain types — mirrored from Rust entry.rs / types.rs
// ---------------------------------------------------------------------------

export type CommandCategory = 'chat' | 'social' | 'moments' | 'system';

export type CommandStatus = 'pending' | 'committed' | 'failed' | 'unknown';

/** Projection of a ledger entry visible to the UI layer. */
export interface CommandProjection {
  readonly id: string;
  readonly category: CommandCategory;
  readonly commandType: string;
  readonly orderingKey: string;
  readonly status: CommandStatus;
  readonly createdAtMs: number;
  readonly attemptCount: number;
  readonly failureReason: string | null;
}

export type DraftKind = 'chat' | 'moments';

export interface DraftProjection {
  readonly key: string;
  readonly kind: DraftKind;
  readonly payloadJson: string;
  readonly updatedAtMs: number;
}

// ---------------------------------------------------------------------------
// InteractionAdmission interface
// ---------------------------------------------------------------------------

export interface InteractionAdmission {
  /** Initialize the ledger with a storage directory and encryption secret. */
  initialize(dbDir: string, encryptionSecretB64: string): Promise<void>;

  /** Admit a new command into the ledger. Returns the assigned command ID. */
  admit(envelope: CommandEnvelope): Promise<string>;

  /** Mark a command as committed by the Station. */
  markCommitted(commandId: string): Promise<void>;

  /** Mark a command as failed with a reason. */
  markFailed(commandId: string, reason: string): Promise<void>;

  /** Read back non-committed entries for a given ordering key. */
  readback(orderingKey: string): Promise<CommandProjection[]>;

  /** Read back all entries with a specific status. */
  readbackByStatus(status: CommandStatus): Promise<CommandProjection[]>;

  /** Purge all committed entries to reclaim storage. */
  purgeCommitted(): Promise<number>;

  /** Shutdown the ledger, releasing resources. */
  shutdown(): Promise<void>;
}

/** Typed command envelope submitted by the UI layer (MS-P06). */
export interface CommandEnvelope {
  readonly commandType: string;
  readonly category: CommandCategory;
  readonly orderingKey: string;
  readonly payloadJson: string;
  readonly idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Draft restoration port
// ---------------------------------------------------------------------------

export interface DraftRestorationPort {
  /** Initialize the draft store with a storage directory and encryption secret. */
  initialize(dbDir: string, encryptionSecretB64: string): Promise<void>;

  /** Save (upsert) a draft. */
  save(kind: DraftKind, domainKey: string, payloadJson: string): Promise<void>;

  /** Load a draft by kind and domain key. */
  load(kind: DraftKind, domainKey: string): Promise<DraftProjection | null>;

  /** List all drafts of a given kind. */
  list(kind: DraftKind): Promise<DraftProjection[]>;

  /** Remove a draft. */
  remove(kind: DraftKind, domainKey: string): Promise<void>;

  /** Shutdown the draft store. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Rust invoke result types (snake_case from serde)
// ---------------------------------------------------------------------------

interface RustCommandProjection {
  id: string;
  category: CommandCategory;
  command_type: string;
  ordering_key: string;
  status: CommandStatus;
  created_at_ms: number;
  attempt_count: number;
  failure_reason: string | null;
}

interface RustDraftProjection {
  key: string;
  kind: DraftKind;
  payload_json: string;
  updated_at_ms: number;
}

interface RustAdmitResult {
  command_id: string;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function toCommandProjection(raw: RustCommandProjection): CommandProjection {
  return {
    id: raw.id,
    category: raw.category,
    commandType: raw.command_type,
    orderingKey: raw.ordering_key,
    status: raw.status,
    createdAtMs: raw.created_at_ms,
    attemptCount: raw.attempt_count,
    failureReason: raw.failure_reason,
  };
}

function toDraftProjection(raw: RustDraftProjection): DraftProjection {
  return {
    key: raw.key,
    kind: raw.kind,
    payloadJson: raw.payload_json,
    updatedAtMs: raw.updated_at_ms,
  };
}

// ---------------------------------------------------------------------------
// InteractionAdmission implementation
// ---------------------------------------------------------------------------

function createInteractionAdmission(): InteractionAdmission {
  return {
    async initialize(dbDir: string, encryptionSecretB64: string): Promise<void> {
      await invoke('ledger_initialize', {
        input: {
          db_dir: dbDir,
          encryption_secret_b64: encryptionSecretB64,
        },
      });
    },

    async admit(envelope: CommandEnvelope): Promise<string> {
      const result = await invoke<RustAdmitResult>('ledger_admit', {
        input: {
          command_type: envelope.commandType,
          category: envelope.category,
          ordering_key: envelope.orderingKey,
          payload_json: envelope.payloadJson,
          idempotency_key: envelope.idempotencyKey ?? null,
        },
      });
      return result.command_id;
    },

    async markCommitted(commandId: string): Promise<void> {
      await invoke('ledger_update_status', {
        input: {
          id: commandId,
          status: 'committed',
          failure_reason: null,
        },
      });
    },

    async markFailed(commandId: string, reason: string): Promise<void> {
      await invoke('ledger_update_status', {
        input: {
          id: commandId,
          status: 'failed',
          failure_reason: reason,
        },
      });
    },

    async readback(orderingKey: string): Promise<CommandProjection[]> {
      const raw = await invoke<RustCommandProjection[]>('ledger_readback', {
        input: { ordering_key: orderingKey },
      });
      return raw.map(toCommandProjection);
    },

    async readbackByStatus(status: CommandStatus): Promise<CommandProjection[]> {
      const raw = await invoke<RustCommandProjection[]>('ledger_readback_by_status', {
        input: { status },
      });
      return raw.map(toCommandProjection);
    },

    async purgeCommitted(): Promise<number> {
      return invoke<number>('ledger_purge_committed');
    },

    async shutdown(): Promise<void> {
      await invoke('ledger_shutdown');
    },
  };
}

// ---------------------------------------------------------------------------
// DraftRestorationPort implementation
// ---------------------------------------------------------------------------

function createDraftRestorationPort(): DraftRestorationPort {
  return {
    async initialize(dbDir: string, encryptionSecretB64: string): Promise<void> {
      await invoke('draft_store_initialize', {
        input: {
          db_dir: dbDir,
          encryption_secret_b64: encryptionSecretB64,
        },
      });
    },

    async save(kind: DraftKind, domainKey: string, payloadJson: string): Promise<void> {
      await invoke('draft_save', {
        input: {
          kind,
          domain_key: domainKey,
          payload_json: payloadJson,
        },
      });
    },

    async load(kind: DraftKind, domainKey: string): Promise<DraftProjection | null> {
      const raw = await invoke<RustDraftProjection | null>('draft_load', {
        input: {
          kind,
          domain_key: domainKey,
        },
      });
      return raw ? toDraftProjection(raw) : null;
    },

    async list(kind: DraftKind): Promise<DraftProjection[]> {
      const raw = await invoke<RustDraftProjection[]>('draft_list', {
        input: { kind },
      });
      return raw.map(toDraftProjection);
    },

    async remove(kind: DraftKind, domainKey: string): Promise<void> {
      await invoke('draft_remove', {
        input: {
          kind,
          domain_key: domainKey,
        },
      });
    },

    async shutdown(): Promise<void> {
      await invoke('draft_store_shutdown');
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton instances — created once, initialized by the lifecycle kernel
// ---------------------------------------------------------------------------

let admissionInstance: InteractionAdmission | null = null;
let draftPortInstance: DraftRestorationPort | null = null;

/**
 * Get or create the InteractionAdmission singleton.
 *
 * The returned instance must be `initialize()`d before use.
 */
export function getInteractionAdmission(): InteractionAdmission {
  if (!admissionInstance) {
    admissionInstance = createInteractionAdmission();
  }
  return admissionInstance;
}

/**
 * Get or create the DraftRestorationPort singleton.
 *
 * The returned instance must be `initialize()`d before use.
 */
export function getDraftRestorationPort(): DraftRestorationPort {
  if (!draftPortInstance) {
    draftPortInstance = createDraftRestorationPort();
  }
  return draftPortInstance;
}
