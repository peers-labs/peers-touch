// Agent Prototype — Builder Sidebar (Right Panel)
// Matches production BuilderPanel (320px, collapsible):
// - Header: "Agent Builder" title + description
// - Context summary: 3 cards showing model/capabilities/focus
// - Suggestion buttons: 3-4 quick action prompts
// - Bottom: composer textarea + send button

import { type CSSProperties, useState } from 'react';
import { Sparkles, Bot } from 'lucide-react';
import { T } from '../theme';
import { PanelToggleDock } from '../../../../shared/PanelToggleButton';

interface BuilderSidebarProps {
  modelLabel: string;
  capabilitiesSummary: string;
  focusLabel: string;
  expanded: boolean;
  onToggle: () => void;
}

// -- Context summary items --

interface ContextItem {
  label: string;
  value: string;
  ready: boolean;
}

// -- Suggestion prompts (matching production suggestQuestions) --

const SUGGESTIONS = [
  'Optimize this agent description for A2A routing',
  'Set up as a customer support agent',
  'Configure for automated code review',
  'Design as a research analyst',
];

export function BuilderSidebar({
  modelLabel,
  capabilitiesSummary,
  focusLabel,
  expanded,
  onToggle,
}: BuilderSidebarProps) {
  const [composerText, setComposerText] = useState('');

  const contextItems: ContextItem[] = [
    { label: 'Model', value: modelLabel, ready: Boolean(modelLabel) },
    { label: 'Capabilities', value: capabilitiesSummary, ready: capabilitiesSummary !== '0 tools, 0 skills' },
    { label: 'Focus', value: focusLabel, ready: true },
  ];

  if (!expanded) {
    return (
      <div style={S.collapsedToggle}>
        <PanelToggleDock side="right" open={false} title="展开 Agent Builder" onClick={onToggle} />
      </div>
    );
  }

  return (
    <aside style={S.aside}>
      <PanelToggleDock side="right" open title="折叠 Agent Builder" onClick={onToggle} />
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <Bot size={16} color={T.action.primary} />
          <span style={S.headerTitle}>Agent Builder</span>
        </div>
      </div>
      <p style={S.headerDesc}>
        Turn a use case into a full agent profile. Describe what you want and the builder will configure this agent.
      </p>

      {/* Context summary cards */}
      <div style={S.contextSection}>
        {contextItems.map((item) => (
          <div key={item.label} style={S.contextCard}>
            <span style={S.contextLabel}>{item.label}</span>
            <span style={{ ...S.contextValue, color: item.ready ? T.text.primary : T.text.quaternary }}>
              {item.value || 'Not set'}
            </span>
            {item.ready && <span style={S.contextDot} />}
          </div>
        ))}
      </div>

      {/* Suggestion buttons */}
      <div style={S.suggestions}>
        {SUGGESTIONS.map((text) => (
          <button key={text} type="button" style={S.suggestionBtn}>
            <Sparkles size={12} color={T.action.primary} style={{ flexShrink: 0 }} />
            <span style={S.suggestionText}>{text}</span>
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Composer */}
      <div style={S.composer}>
        <textarea
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          placeholder="Ask, create, or start a task..."
          style={S.composerInput}
          rows={2}
        />
        <button type="button" style={S.composerSend} title="Send">
          <Sparkles size={14} color={composerText.trim() ? T.action.primary : T.text.quaternary} />
        </button>
      </div>
    </aside>
  );
}

// -- Styles --

const S: Record<string, CSSProperties> = {
  aside: {
    width: 280,
    minWidth: 280,
    height: '100%',
    borderLeft: `1px solid ${T.border.hairline}`,
    background: T.surface.base,
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 16px',
    overflow: 'auto',
    flexShrink: 0,
    position: 'relative',
    paddingTop: 56,
  },

  // Collapsed state
  collapsedToggle: {
    width: 40,
    minWidth: 40,
    height: '100%',
    borderLeft: `1px solid ${T.border.hairline}`,
    background: T.surface.base,
    border: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 14,
    cursor: 'pointer',
    flexShrink: 0,
    position: 'relative',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: T.text.primary,
  },
  collapseBtn: {
    width: 24,
    height: 24,
    border: 0,
    borderRadius: 6,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  headerDesc: {
    margin: '0 0 16px',
    fontSize: 11,
    color: T.text.muted,
    lineHeight: 1.5,
  },

  // Context cards
  contextSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 16,
  },
  contextCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
  },
  contextLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: T.text.muted,
    minWidth: 70,
    flexShrink: 0,
  },
  contextValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    minWidth: 0,
  },
  contextDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: T.trust.success,
    flexShrink: 0,
  },

  // Suggestions
  suggestions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  suggestionBtn: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '9px 10px',
    borderRadius: 8,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    textAlign: 'left' as const,
    cursor: 'pointer',
    width: '100%',
  },
  suggestionText: {
    fontSize: 12,
    color: T.text.secondary,
    lineHeight: 1.4,
  },

  // Composer
  composer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 6,
    padding: '8px 10px',
    borderRadius: 10,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    marginTop: 16,
  },
  composerInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    fontSize: 12,
    color: T.text.primary,
    background: 'transparent',
    minHeight: 36,
    lineHeight: 1.5,
  },
  composerSend: {
    width: 28,
    height: 28,
    border: 0,
    borderRadius: 6,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
};
