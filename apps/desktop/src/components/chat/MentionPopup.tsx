import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@lobehub/ui';
import { theme } from 'antd';
import { Flexbox } from 'react-layout-kit';

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

export function MentionPopup({ onSelect, anchorTop, anchorLeft }: MentionPopupProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
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
    [showMentionPopup, filteredAgents, activeIndex, closePopup],
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

  const selectAgent = useCallback(
    (agent: Agent) => {
      addMention(agent.id);
      closePopup();
      const insertText = `@${agent.title || agent.name} `;
      onSelect(agent, insertText);
    },
    [addMention, closePopup, onSelect],
  );

  if (!showMentionPopup) return null;

  return (
    <Flexbox
      data-pt-agent-mention-popup
      ref={listRef}
      style={{
        position: 'absolute',
        bottom: anchorTop ?? '100%',
        left: anchorLeft ?? 0,
        zIndex: token.zIndexPopupBase,
        maxHeight: 240,
        width: 260,
        overflowY: 'auto',
        background: token.colorBgElevated,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
        padding: token.paddingXS,
      }}
    >
      {filteredAgents.length === 0 ? (
        <Flexbox
          align="center"
          justify="center"
          style={{ padding: token.paddingSM, color: token.colorTextSecondary }}
        >
          {t('agent.mentions.noAgents')}
        </Flexbox>
      ) : (
        filteredAgents.map((agent, index) => (
          <Flexbox
            data-pt-agent-mention-option={agent.id}
            key={agent.id}
            horizontal
            align="center"
            gap={token.marginXS}
            onClick={() => selectAgent(agent)}
            onMouseEnter={() => setActiveIndex(index)}
            style={{
              padding: `${token.paddingXS}px ${token.paddingSM}px`,
              borderRadius: token.borderRadius,
              cursor: 'pointer',
              background: index === activeIndex ? token.colorFillSecondary : 'transparent',
              transition: 'background 0.15s',
            }}
          >
            <Avatar
              avatar={agent.avatar || undefined}
              title={agent.title || agent.name}
              size={24}
              shape="circle"
              background={agent.backgroundColor || token.colorPrimary}
            />
            <Flexbox style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: token.fontSize,
                  color: token.colorText,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {agent.title || agent.name}
              </span>
            </Flexbox>
          </Flexbox>
        ))
      )}
    </Flexbox>
  );
}
