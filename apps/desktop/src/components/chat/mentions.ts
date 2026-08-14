// ──────────────────────────────────────────────────────────────────────────────
// P3-M8 Mentions — public API surface for chat composer integration.
// ──────────────────────────────────────────────────────────────────────────────

export { MentionPopup } from './MentionPopup';
export { MentionTag, MentionTagBar } from './MentionTag';
export { useMentionTrigger } from './composer/useMentionTrigger';
export { useMentionStore, getFilteredAgents } from '../../store/mentions';
