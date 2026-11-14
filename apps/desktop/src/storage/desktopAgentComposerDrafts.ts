/**
 * Durable task-level composer drafts (TW-D2).
 *
 * One draft belongs to one agent session key (a task conversation, or an
 * agent-draft key before the first Turn creates the conversation). A draft
 * survives task switches, window closes, and renderer reloads through the
 * existing actor-scoped client-storage owner (`agent.composer-draft`).
 *
 * Only text and Station-owned attachment references are persisted:
 * - Inline resource/selection references are encoded in the draft text.
 * - Attachment binaries are already owned by Station OSS; the draft only
 *   keeps their refs. Abandoned blobs are reclaimed by the Station OSS TTL
 *   sweeper, so a switch/close must not delete a still-drafted ref.
 *
 * Parsing/bounding are pure functions so node-environment tests can cover
 * them without a DOM; the sync helpers are the browser bridge and degrade
 * to in-memory behavior when no Storage is available.
 */

import type { AgentAttachmentRefInput } from '../services/desktop_api';
import {
  readDesktopDomainValueSync,
  removeDesktopDomainValueSync,
  writeDesktopDomainValueSync,
} from './desktopClientStorage';

const DRAFT_DOMAIN = 'agent.composer-draft';
const DRAFT_DOCUMENT_KEY = 'task-composer';
const DOCUMENT_SCHEMA = 1;
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_ATTACHMENTS_PER_DRAFT = 10;
const MAX_DRAFT_ENTRIES = 100;

export interface AgentComposerDraftEntry {
  text: string;
  attachments: AgentAttachmentRefInput[];
  updatedAt: number;
}

export interface AgentComposerDraftDocument {
  schema: 1;
  drafts: Record<string, AgentComposerDraftEntry>;
}

export interface AgentComposerDraftTables {
  texts: Record<string, string>;
  attachments: Record<string, AgentAttachmentRefInput[]>;
}

const ATTACHMENT_FIELDS: readonly (keyof AgentAttachmentRefInput)[] = [
  'attachment_id',
  'object_ref',
  'mime_type',
  'size_bytes',
  'checksum',
  'filename',
  'authorization_scope',
  'expires_at',
  'extracted_content_ref',
];

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

/**
 * A ref is accepted only when every Station-issued field is present and the
 * object grant has not already expired. One malformed ref never poisons the
 * rest of the draft.
 */
export function parseAgentAttachmentRef(
  value: unknown,
  nowMs: number,
): AgentAttachmentRefInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of ATTACHMENT_FIELDS) {
    if (typeof record[field] !== 'string' && field !== 'size_bytes') return null;
  }
  if (typeof record.size_bytes !== 'number' || !Number.isFinite(record.size_bytes)) {
    return null;
  }
  if (record.size_bytes < 0) return null;
  const expiresAt = String(record.expires_at);
  if (expiresAt) {
    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) return null;
  }
  return {
    attachment_id: String(record.attachment_id),
    object_ref: String(record.object_ref),
    mime_type: String(record.mime_type),
    size_bytes: record.size_bytes,
    checksum: String(record.checksum),
    filename: String(record.filename),
    authorization_scope: String(record.authorization_scope),
    expires_at: expiresAt,
    extracted_content_ref: String(record.extracted_content_ref),
  };
}

function parseDraftEntry(
  value: unknown,
  nowMs: number,
): AgentComposerDraftEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== 'string' || byteLength(record.text) > MAX_TEXT_BYTES) {
    return null;
  }
  if (!Array.isArray(record.attachments)) return null;
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) {
    return null;
  }
  const attachments: AgentAttachmentRefInput[] = [];
  for (const item of record.attachments.slice(0, MAX_ATTACHMENTS_PER_DRAFT)) {
    const parsed = parseAgentAttachmentRef(item, nowMs);
    if (parsed) attachments.push(parsed);
  }
  if (!record.text && attachments.length === 0) return null;
  return { text: record.text, attachments, updatedAt: record.updatedAt };
}

export function parseAgentComposerDraftDocument(
  raw: unknown,
  nowMs: number = Date.now(),
): AgentComposerDraftDocument | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (
    record.schema !== DOCUMENT_SCHEMA
    || typeof record.drafts !== 'object'
    || record.drafts === null
    || Array.isArray(record.drafts)
  ) {
    return null;
  }
  const drafts: Record<string, AgentComposerDraftEntry> = {};
  for (const [key, value] of Object.entries(record.drafts as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    const entry = parseDraftEntry(value, nowMs);
    if (normalizedKey && entry) drafts[normalizedKey] = entry;
  }
  return { schema: DOCUMENT_SCHEMA, drafts };
}

function entrySignature(entry: AgentComposerDraftEntry): string {
  return JSON.stringify({
    text: entry.text,
    refs: entry.attachments.map((item) => item.attachment_id),
  });
}

/**
 * Build a bounded document from the live store tables. Entries whose content
 * is unchanged keep their previous `updatedAt`; everything else is stamped
 * now. Least-recently-updated entries are evicted past MAX_DRAFT_ENTRIES.
 */
export function buildAgentComposerDraftDocument(
  tables: AgentComposerDraftTables,
  previous: AgentComposerDraftDocument | null,
  nowMs: number = Date.now(),
): AgentComposerDraftDocument | null {
  const keys = new Set([
    ...Object.keys(tables.texts),
    ...Object.keys(tables.attachments),
  ]);
  const drafts: Record<string, AgentComposerDraftEntry> = {};
  for (const key of keys) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    const text = tables.texts[normalizedKey] ?? '';
    if (byteLength(text) > MAX_TEXT_BYTES) continue;
    const attachments = (tables.attachments[normalizedKey] ?? [])
      .map((item) => parseAgentAttachmentRef(item, nowMs))
      .filter((item): item is AgentAttachmentRefInput => item !== null)
      .slice(0, MAX_ATTACHMENTS_PER_DRAFT);
    if (!text && attachments.length === 0) continue;
    const candidate: AgentComposerDraftEntry = { text, attachments, updatedAt: nowMs };
    const previousEntry = previous?.drafts[normalizedKey];
    if (previousEntry && entrySignature(previousEntry) === entrySignature(candidate)) {
      drafts[normalizedKey] = previousEntry;
    } else {
      drafts[normalizedKey] = candidate;
    }
  }
  const ordered = Object.keys(drafts).sort(
    (a, b) => drafts[a].updatedAt - drafts[b].updatedAt,
  );
  for (const key of ordered.slice(0, Math.max(0, ordered.length - MAX_DRAFT_ENTRIES))) {
    delete drafts[key];
  }
  return Object.keys(drafts).length === 0
    ? null
    : { schema: DOCUMENT_SCHEMA, drafts };
}

export function readAgentComposerDraftsSync(): AgentComposerDraftTables {
  const raw = readDesktopDomainValueSync(DRAFT_DOMAIN, DRAFT_DOCUMENT_KEY);
  const document = parseAgentComposerDraftDocument(raw);
  if (!document) return { texts: {}, attachments: {} };
  const texts: Record<string, string> = {};
  const attachments: Record<string, AgentAttachmentRefInput[]> = {};
  for (const [key, entry] of Object.entries(document.drafts)) {
    texts[key] = entry.text;
    if (entry.attachments.length > 0) attachments[key] = entry.attachments;
  }
  return { texts, attachments };
}

export function writeAgentComposerDraftsSync(tables: AgentComposerDraftTables): void {
  const previous = parseAgentComposerDraftDocument(
    readDesktopDomainValueSync(DRAFT_DOMAIN, DRAFT_DOCUMENT_KEY),
  );
  const document = buildAgentComposerDraftDocument(tables, previous);
  if (!document) {
    removeDesktopDomainValueSync(DRAFT_DOMAIN, DRAFT_DOCUMENT_KEY);
    return;
  }
  writeDesktopDomainValueSync(DRAFT_DOMAIN, DRAFT_DOCUMENT_KEY, document);
}

export function removeAgentComposerDraftsSync(): void {
  removeDesktopDomainValueSync(DRAFT_DOMAIN, DRAFT_DOCUMENT_KEY);
}
