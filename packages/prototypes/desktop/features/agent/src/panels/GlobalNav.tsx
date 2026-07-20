// Agent Prototype — Global Navigation Rail
// 56px wide vertical icon rail for switching between Agents and Atelier surfaces.
// Shows current agent avatar at top, surface icons in center, settings at bottom.

import type { CSSProperties } from 'react';
import { Users, Zap, Settings } from 'lucide-react';
import { T } from '../theme';
import type { Agent, Surface } from '../types';

interface GlobalNavProps {
  surface: Surface;
  onSurfaceChange: (surface: Surface) => void;
  currentAgent: Agent | undefined;
}

export function GlobalNav({ surface, onSurfaceChange, currentAgent }: GlobalNavProps) {
  return (
    <div style={S.rail}>
      {/* Current agent avatar */}
      <div style={S.avatarSection}>
        <div style={{ ...S.avatar, backgroundColor: currentAgent?.avatar ?? T.action.primary }}>
          <span style={S.avatarLetter}>
            {currentAgent?.name.charAt(0).toUpperCase() ?? 'A'}
          </span>
        </div>
      </div>

      {/* Navigation icons */}
      <div style={S.navSection}>
        <button
          style={{ ...S.navBtn, ...(surface === 'agents' ? S.navBtnActive : {}) }}
          onClick={() => onSurfaceChange('agents')}
          title="Agents"
        >
          {surface === 'agents' && <span style={S.indicator} />}
          <Users size={20} color={surface === 'agents' ? T.action.primary : T.text.muted} />
        </button>

        <button
          style={{ ...S.navBtn, ...(surface === 'atelier' ? S.navBtnActive : {}) }}
          onClick={() => onSurfaceChange('atelier')}
          title="Atelier"
        >
          {surface === 'atelier' && <span style={S.indicator} />}
          <Zap size={20} color={surface === 'atelier' ? T.action.primary : T.text.muted} />
        </button>
      </div>

      {/* Settings at bottom */}
      <div style={S.bottomSection}>
        <button style={S.navBtn} title="Settings">
          <Settings size={18} color={T.text.muted} />
        </button>
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  rail: {
    width: 56,
    minWidth: 56,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    borderRight: `1px solid ${T.border.hairline}`,
    background: T.surface.base,
    paddingTop: 16,
    paddingBottom: 16,
  },

  avatarSection: {
    marginBottom: 24,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
  },

  navSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  navBtn: {
    position: 'relative',
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: T.radius.md,
    background: 'transparent',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  navBtnActive: {
    background: 'rgba(107, 91, 214, 0.08)',
  },
  indicator: {
    position: 'absolute',
    left: -4,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 3,
    height: 16,
    borderRadius: 2,
    background: T.action.primary,
  },

  bottomSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
};
