/**
 * Human-content projection for the Mobile prototype.
 *
 * R1 contract (see docs/client/common/ui-identity + Mobile retrospective):
 * domain/transport values never occupy human-content or relationship slots.
 * Conversation preview, message body, and Moment author/body slots run through
 * this presenter so seeded/debug/transport strings can never surface verbatim.
 *
 * This is prototype intent, not runtime code. Production implements the same
 * boundary as a presenter between the projection store and the page.
 */
import type { Conversation, Message } from './types';
import copy from '../../../../locales/en/common.json';

/**
 * Transport/seed markers that must never appear in a human content slot.
 * Station host:port, PTID/ULID tokens, and acceptance seed prefixes.
 */
const TRANSPORT_PATTERNS: RegExp[] = [
  /\b\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}\b/u, // 10.37.94.156:18132
  /\b[a-f0-9]{20,}\b/iu, // long hex / ULID-ish id
  /\bptid:/iu,
  /\bMWPU[ _-][A-Za-z0-9 _-]*/u, // acceptance seed text
  /\b\d{10,}\b/u, // bare timestamp/seed numbers
];

export function containsTransportLeak(value: string): boolean {
  return TRANSPORT_PATTERNS.some((pattern) => pattern.test(value));
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u;

export type ProjectedKind =
  | 'text'
  | 'emoji'
  | 'image'
  | 'file'
  | 'system'
  | 'redacted';

export interface ProjectedContent {
  kind: ProjectedKind;
  /** Human-readable representation safe for preview and thread body. */
  label: string;
}

/**
 * Project one inbound/outbound transport item to a human content form.
 * System events and media become localized labels; machine text is redacted
 * rather than shown verbatim.
 */
export function projectMessage(message: Pick<Message, 'text' | 'image' | 'file'>): ProjectedContent {
  if (message.file) {
    return { kind: 'file', label: message.file.name };
  }
  if (message.image) {
    return { kind: 'image', label: copy['mobile.chat.contentPhoto'] ?? '[Photo]' };
  }
  const text = message.text ?? '';
  if (!text.trim()) {
    return { kind: 'text', label: '' };
  }
  if (EMOJI_ONLY.test(text)) {
    return { kind: 'emoji', label: text.trim() };
  }
  if (containsTransportLeak(text)) {
    // A machine/seed string is never product copy. Show a neutral system label
    // instead of the raw value.
    return {
      kind: 'redacted',
      label: copy['mobile.chat.contentSystemUpdate'] ?? 'System update',
    };
  }
  return { kind: 'text', label: text };
}

/** Conversation-list preview projection shared by the list and a11y tree. */
export function projectConversationPreview(
  conversation: Pick<Conversation, 'isGroup' | 'lastSender' | 'lastMessage'>,
  projectedLast: ProjectedContent,
): string {
  const prefix = conversation.isGroup && conversation.lastSender
    ? `${conversation.lastSender}: `
    : '';
  return `${prefix}${projectedLast.label}`;
}

// Already-human media labels used directly in list previews.
const HUMAN_MEDIA_LABEL = /^\s*(?:\[[^\]]+\]|[\w.-]+\.(?:pdf|png|jpg|jpeg|gif|webp|mp4|mov|webm))\s*$/iu;

/**
 * Project a conversation's raw last-message string to a list preview.
 * Existing human media labels (`[Photo]`, `report.pdf`) are preserved;
 * emoji stays; machine/seed strings become a neutral system label.
 */
export function projectConversationLastMessage(raw: string): string {
  if (HUMAN_MEDIA_LABEL.test(raw)) return raw;
  return projectMessage({ text: raw }).label;
}

/**
 * Trust-slot hygiene guard used by the content-projection evidence scenario.
 * Author name, relationship meta, and preview slots must carry no endpoint.
 */
export function assertTrustSlotHygiene(input: {
  name: string;
  relationship?: string;
  preview: string;
}): string[] {
  const violations: string[] = [];
  for (const [slot, value] of Object.entries({
    name: input.name,
    relationship: input.relationship ?? '',
    preview: input.preview,
  })) {
    if (containsTransportLeak(value)) violations.push(slot);
  }
  return violations;
}
