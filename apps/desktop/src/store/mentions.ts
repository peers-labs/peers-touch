import { createDesktopStore } from './createDesktopStore';
import { useAgentStore } from './agent';
import type { Agent } from '../services/desktop_api';

// ──────────────────────────────────────────────────────────────────────────────
// Mention Store — manages @mention state for chat composer delegation.
// Part of P3-M8 "Mentions" milestone.
// ──────────────────────────────────────────────────────────────────────────────

interface MentionState {
  /** IDs of agents currently mentioned in the compose draft. */
  mentionedAgentIds: string[];
  /** Whether the mention popup is visible. */
  showMentionPopup: boolean;
  /** Current search query after the "@" trigger character. */
  mentionQuery: string;
  /** Cursor position when "@" was typed (used for popup positioning). */
  cursorPosition: number;

  addMention: (agentId: string) => void;
  removeMention: (agentId: string) => void;
  clearMentions: () => void;
  setMentionQuery: (query: string) => void;
  setCursorPosition: (position: number) => void;
  openPopup: () => void;
  closePopup: () => void;
}

export const useMentionStore = createDesktopStore<MentionState>('mentions', (set, get) => ({
  mentionedAgentIds: [],
  showMentionPopup: false,
  mentionQuery: '',
  cursorPosition: 0,

  addMention: (agentId: string) => {
    const { mentionedAgentIds } = get();
    if (mentionedAgentIds.includes(agentId)) return;
    set({ mentionedAgentIds: [...mentionedAgentIds, agentId] });
  },

  removeMention: (agentId: string) => {
    set({
      mentionedAgentIds: get().mentionedAgentIds.filter((id) => id !== agentId),
    });
  },

  clearMentions: () => {
    set({ mentionedAgentIds: [], mentionQuery: '', showMentionPopup: false });
  },

  setMentionQuery: (query: string) => {
    set({ mentionQuery: query });
  },

  setCursorPosition: (position: number) => {
    set({ cursorPosition: position });
  },

  openPopup: () => {
    set({ showMentionPopup: true });
  },

  closePopup: () => {
    set({ showMentionPopup: false, mentionQuery: '' });
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Selectors
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns agents filtered by the current mentionQuery.
 * Excludes agents already mentioned and the currently-selected agent (self).
 */
export function getFilteredAgents(): Agent[] {
  const { mentionQuery, mentionedAgentIds } = useMentionStore.getState();
  const { agents, selectedAgent } = useAgentStore.getState();

  const query = mentionQuery.toLowerCase().trim();

  return agents.filter((agent) => {
    // Exclude already-mentioned agents and self.
    if (mentionedAgentIds.includes(agent.id)) return false;
    if (agent.name === selectedAgent) return false;

    if (!query) return true;
    return (
      agent.name.toLowerCase().includes(query) ||
      agent.title.toLowerCase().includes(query)
    );
  });
}
