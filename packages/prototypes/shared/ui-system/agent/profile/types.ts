/**
 * Agent Profile view models (frontend-eles · desktop · agent).
 *
 * Mirrors the production AgentProfilePage vocabulary: one persisted identity
 * (initial | emoji | image), two instruction documents (SOUL.md / AGENTS.md),
 * and bound capability extensions split into Skills and MCP. The catalog for
 * the lazy picker stays separate from the bound rows, exactly like production:
 * Profile shows only what is bound, the picker owns the searchable catalog.
 */
import type { AvatarMode } from '../types';

export type ExtensionKind = 'skill' | 'mcp';

export interface ExtensionRecord {
  capabilityId: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  enabled: boolean;
}

/** A catalog row is an unbound capability the picker can bind. */
export interface CatalogEntry {
  capabilityId: string;
  kind: ExtensionKind;
  name: string;
  description: string;
}

export interface ProfileDocuments {
  soulMd: string;
  agentsMd: string;
}

export interface AvatarChoice {
  mode: AvatarMode;
  /** Emoji glyph for emoji mode, or a data: URL for image mode. */
  value: string;
}

export const AVATAR_EMOJIS: readonly string[] = [
  '🤖', '🛠️', '🧠', '📚', '✍️', '🔍', '📊', '💬',
  '✅', '🌐', '🔒', '⚡', '🎨', '🧪', '📎', '🗂️',
  '💻', '🛡️', '🪄', '📌', '🔭', '🏁', '🧭', '🚀',
];

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
