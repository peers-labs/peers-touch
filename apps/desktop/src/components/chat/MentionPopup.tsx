import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMentionStore } from '../../store/mentions';
import { useAgentStore } from '../../store/agent';
import type { Agent } from '../../services/desktop_api';

// ──────────────────────────────────────────────────────────────────────────────
// MentionPopup — dropdown shown when user types "@" in chat composer.
// Displays filtered agent list with keyboard navigation and click-to-select.
// ──────────────────────────────────────────────────────────────────────────────

interface MentionPopupProps {
  /** Callback when an agent is selected; receives agent and the text to insert. */
  onSelect: (agent: Agent, insertText: string) => void;
  /** Absolute Y offset from the top of the composer area for positioning. */
  anchorTop?: number;
  /** Absolute X offset from the left of the composer area for positioning. */
  anchorLeft?: number;
}

function MentionAvatar({ agent }: { agent: Agent }) {
  const name = agent.title || agent.name;
  if (agent.avatar) {
    return (
      <span className="sc-mention__avatar">
        <img src={agent.avatar} alt={name} />
      </span>
    );
  }
  return (
    <span
      className="sc-mention__avatar"
      style={{ background: agent.backgroundColor || 'var(--pt-primary)' }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function MentionPopup({ onSelect, anchorTop, anchorLeft }: MentionPopupProps) {
  const { t } = useTranslation('agent');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const showMentionPopup = useMentionStore((s) => s.showMentionPopup);
  const mentionQuery = useMentionStore((s) => s.mentionQuery);
  const closePopup = useMentionStore((s) => s.closePopup);
  const addMention = useMentionStore((s) => s.addMention);

  // Recompute filtered agents on each render (query-driven).
  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = useAgentStore((s) => s.selectedAgent);
  const mentionedAgentIds = useMentionStore((s) => s.mentionedAgentIds);

  const filteredAgents = agents.filter((agent) => {
    if (mentionedAgentIds.includes(agent.id)) return false;
    if (agent.name === selectedAgent) return false;
    const query = mentionQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      agent.name.toLowerCase().includes(query) ||
      agent.title.toLowerCase().includes(query)
    );
  });

  const selectAgent = useCallback(
    (agent: Agent) => {
      addMention(agent.id);
      closePopup();
      const insertText = `@${agent.title || agent.name} `;
      onSelect(agent, insertText);
    },
    [addMention, closePopup, onSelect],
  );

  // Reset active index when list changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [mentionQuery]);

  // Keyboard navigation — exposed via imperative handle on the document.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!showMentionPopup) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % Math.max(filteredAgents.length, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) =>
          prev <= 0 ? Math.max(filteredAgents.length - 1, 0) : prev - 1,
        );
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const agent = filteredAgents[activeIndex];
        if (agent) {
          selectAgent(agent);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closePopup();
      }
    },
    [showMentionPopup, filteredAgents, activeIndex, closePopup, selectAgent],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // Scroll active item into view.
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!showMentionPopup) return null;

  return (
    <div
      className="sc-mention-popup"
      data-pt-agent-mention-popup
      ref={listRef}
      style={{ bottom: anchorTop ?? '100%', left: anchorLeft ?? 0 }}
    >
      {filteredAgents.length === 0 ? (
        <div className="sc-mention-popup__empty">
          {t('agent.mentions.noAgents')}
        </div>
      ) : (
        filteredAgents.map((agent, index) => (
          <button
            type="button"
            className={`sc-mention-popup__option${index === activeIndex ? ' is-active' : ''}`}
            data-pt-agent-mention-option={agent.id}
            key={agent.id}
            onClick={() => selectAgent(agent)}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <MentionAvatar agent={agent} />
            <span className="sc-mention-popup__option-name">
              {agent.title || agent.name}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
