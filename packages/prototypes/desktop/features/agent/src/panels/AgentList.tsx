// Agent Prototype — Agent List Sidebar (Collapsible)
// Matches production AgentProfilePage.tsx left aside:
// - Expanded (230px): header with "My Agents" + Workflow + "+", SearchBar, Pinned/All sections
// - Collapsed (48px): only avatar buttons stacked vertically, "+" and Search icons at top
// - Bottom: collapse/expand toggle button

import { type CSSProperties, useState } from 'react';
import {
  Bot,
  Plus,
  Search,
  Workflow,
  MoreHorizontal,
} from 'lucide-react';
import { T } from '../theme';
import type { Agent } from '../types';
import { PanelToggleDock } from '../../../../shared/PanelToggleButton';

interface AgentListProps {
  agents: Agent[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreateAgent: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function AgentList({
  agents,
  selectedId,
  onSelect,
  onCreateAgent,
  collapsed,
  onToggleCollapse,
}: AgentListProps) {
  const [search, setSearch] = useState('');

  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()),
  );
  const pinned = filtered.filter((a) => a.pinned);
  const all = filtered.filter((a) => !a.pinned);

  // Collapsed: show all agents (unfiltered) split by pinned
  const collapsedPinned = agents.filter((a) => a.pinned);
  const collapsedOther = agents.filter((a) => !a.pinned);

  return (
    <aside style={{ ...S.aside, width: collapsed ? 48 : 230 }}>
      {collapsed ? (
        <>
          {/* Collapsed: icon buttons at top */}
          <button style={S.collapsedBtn} type="button" onClick={onCreateAgent} title="Create Agent">
            <Plus size={18} color={T.text.secondary} />
          </button>
          <button
            style={S.collapsedBtn}
            type="button"
            onClick={onToggleCollapse}
            title="Search Agents"
          >
            <Search size={18} color={T.text.secondary} />
          </button>

          {/* Pinned avatars */}
          {collapsedPinned.length > 0 && <div style={S.collapsedDivider} />}
          {collapsedPinned.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              title={agent.name}
              style={{
                ...S.collapsedAvatarBtn,
                background: agent.id === selectedId ? 'rgba(107, 91, 214, 0.08)' : 'transparent',
              }}
            >
              <AgentTile color={agent.avatar} name={agent.name} size={30} selected={agent.id === selectedId} />
            </button>
          ))}

          {/* Other avatars */}
          {collapsedOther.length > 0 && <div style={S.collapsedDivider} />}
          {collapsedOther.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              title={agent.name}
              style={{
                ...S.collapsedAvatarBtn,
                background: agent.id === selectedId ? 'rgba(107, 91, 214, 0.08)' : 'transparent',
              }}
            >
              <AgentTile color={agent.avatar} name={agent.name} size={30} selected={agent.id === selectedId} />
            </button>
          ))}
        </>
      ) : (
        <>
          {/* Expanded header: icon + "My Agents" + Workflow + "+" */}
          <div style={S.header}>
            <Bot size={18} color={T.action.primary} />
            <span style={S.headerTitle}>My Agents</span>
            <button style={S.headerBtn} type="button" title="Workflow">
              <Workflow size={17} color={T.text.secondary} />
            </button>
            <button style={S.headerBtn} type="button" onClick={onCreateAgent} title="Create Agent">
              <Plus size={17} color={T.text.secondary} />
            </button>
          </div>

          {/* Search bar */}
          <div style={S.searchWrap}>
            <Search size={14} color={T.text.quaternary} style={{ flexShrink: 0 }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              style={S.searchInput}
            />
          </div>

          {/* Scrollable list */}
          <div style={S.list}>
            {/* Pinned section */}
            {pinned.length > 0 && (
              <div style={S.sectionLabel}>PINNED</div>
            )}
            {pinned.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                active={agent.id === selectedId}
                onSelect={() => onSelect(agent.id)}
              />
            ))}

            {/* All Agents section */}
            <div style={S.sectionLabel}>ALL AGENTS</div>
            {all.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                active={agent.id === selectedId}
                onSelect={() => onSelect(agent.id)}
              />
            ))}

            {filtered.length === 0 && (
              <div style={S.empty}>No matching agents</div>
            )}
          </div>
        </>
      )}

      <PanelToggleDock
        side="left"
        open={!collapsed}
        title={collapsed ? '展开 Agent 列表' : '折叠 Agent 列表'}
        onClick={onToggleCollapse}
      />
    </aside>
  );
}

// -- AgentTile: square rounded avatar with icon/letter --

function AgentTile({ color, name, size, selected }: { color: string; name: string; size: number; selected: boolean }) {
  const radius = Math.max(8, Math.round(size * 0.3));
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: selected ? 'rgba(107, 91, 214, 0.12)' : color,
        color: selected ? T.action.primary : '#ffffff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: Math.round(size * 0.4),
        fontWeight: 700,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

// -- AgentRow: expanded list item --

function AgentRow({ agent, active, onSelect }: { agent: Agent; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        ...S.row,
        background: active ? 'rgba(107, 91, 214, 0.06)' : 'transparent',
      }}
    >
      <AgentTile color={agent.avatar} name={agent.name} size={32} selected={active} />
      <span style={S.rowContent}>
        <span style={{ ...S.rowName, color: active ? T.action.primary : T.text.primary }}>
          {agent.name}
        </span>
        <span style={S.rowDesc}>{agent.description}</span>
      </span>
      <MoreHorizontal size={14} color={T.text.quaternary} />
    </button>
  );
}

// -- Styles --

const S: Record<string, CSSProperties> = {
  aside: {
    height: '100%',
    borderRight: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    padding: '14px 10px 58px',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },

  // Expanded header
  header: {
    display: 'flex',
    alignItems: 'center',
    height: 36,
    marginBottom: 8,
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: 800,
    color: T.text.primary,
  },
  headerBtn: {
    width: 28,
    height: 28,
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },

  // Search
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 36,
    marginBottom: 12,
    padding: '0 10px',
    borderRadius: 8,
    background: T.surface.subtle,
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: T.text.primary,
    minWidth: 0,
  },

  // List
  list: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '0 0 10px',
  },
  sectionLabel: {
    padding: '8px 8px 4px',
    color: T.text.muted,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.4,
  },
  empty: {
    padding: '20px 8px',
    textAlign: 'center',
    fontSize: 12,
    color: T.text.muted,
  },

  // Row
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    width: '100%',
    padding: '6px 8px',
    borderRadius: 10,
    border: 0,
    color: T.text.primary,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  rowName: {
    display: 'block',
    fontSize: 13,
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  rowDesc: {
    display: 'block',
    fontSize: 11,
    color: T.text.muted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  // Collapsed mode
  collapsedBtn: {
    width: 40,
    height: 40,
    margin: '0 auto 10px',
    border: 0,
    borderRadius: 12,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  collapsedDivider: {
    width: 28,
    height: 1,
    margin: '18px auto 12px',
    background: T.border.hairline,
  },
  collapsedAvatarBtn: {
    width: 40,
    height: 48,
    margin: '0 auto',
    borderRadius: 12,
    border: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
};
