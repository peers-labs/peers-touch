import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { registerDevPlugin } from '../registry';
import { api } from '../../services/desktop_api';
import type { StationListResponse } from '../../services/desktop_api';
import { useSessionStore } from '../../store/session';

declare const __PT_DEV_WORKTREE__: string;
declare const __PT_DEV_BRANCH__: string;

const WORKTREE_BADGE_PREFIX = 'wt:';

function WorktreeBadge() {
  const worktree = __PT_DEV_WORKTREE__ || 'unknown';
  const branch = __PT_DEV_BRANCH__ || '';
  const [expanded, setExpanded] = useState(false);
  const [stationInfo, setStationInfo] = useState<StationListResponse | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const authenticated = useSessionStore((s) => s.authenticated);
  const user = useSessionStore((s) => s.currentUser);

  const loadStation = useCallback(async () => {
    try {
      const result = await api.stationList();
      setStationInfo(result);
    } catch {
      // Station may not be reachable yet
    }
  }, []);

  useEffect(() => {
    if (expanded) void loadStation();
  }, [expanded, loadStation]);

  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expanded]);

  const activeStationPeerId = stationInfo?.active_station_peer_id || '';
  const activeEntry = stationInfo?.entries?.find(
    (entry) => entry.station_peer_id === activeStationPeerId,
  );
  const activeRoute = activeEntry?.routes.find(
    (route) => route.route_id === activeEntry.active_route_id,
  );

  return (
    <div
      ref={panelRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setExpanded(false);
      }}
      style={{ position: 'relative', pointerEvents: 'auto', minWidth: 0, display: 'flex' }}
    >
      <button
        type="button"
        data-dev-worktree-toggle
        aria-label={`${WORKTREE_BADGE_PREFIX} ${worktree}${branch ? ` | ${branch}` : ''}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        title={`${WORKTREE_BADGE_PREFIX} ${worktree}${branch ? ` | ${branch}` : ''}`}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          border: 0,
          borderRadius: 4,
          background: expanded ? 'rgba(20,24,22,0.55)' : 'rgba(20,24,22,0.32)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          color: '#0f0',
          fontSize: 10,
          fontFamily: 'monospace',
          lineHeight: 1.4,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {WORKTREE_BADGE_PREFIX}
      </button>

      {expanded && (
        <div
          id={panelId}
          data-dev-worktree-panel
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            boxSizing: 'border-box',
            width: 'min(360px, calc(100vw - 8px))',
            maxHeight: 'calc(100dvh - 40px)',
            overflowY: 'auto',
            padding: '8px 10px',
            borderRadius: 6,
            background: 'rgba(20,24,22,0.68)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            color: '#ddd',
            fontSize: 11,
            fontFamily: 'monospace',
            lineHeight: 1.6,
            whiteSpace: 'normal',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <Row label="worktree" value={worktree} color="#8f8" />
          {branch && <Row label="branch" value={branch} color="#ff8" />}
          <Divider />
          <Row label="station" value={activeRoute?.endpoint_origin || '—'} color="#8cf" />
          {activeEntry?.display_name && (
            <Row label="label" value={activeEntry.display_name} color="#8cf" />
          )}
          {activeEntry?.station_peer_id && (
            <Row label="peer_id" value={activeEntry.station_peer_id} color="#8cf" />
          )}
          {activeRoute && (
            <Row label="route" value={activeRoute.route_type} color="#8cf" />
          )}
          <Row
            label="online"
            value={activeRoute ? (activeRoute.health === 'available' ? 'yes' : 'no') : '?'}
            color={activeRoute?.health === 'available' ? '#8f8' : '#f88'}
          />
          <Divider />
          <Row
            label="session"
            value={authenticated ? 'active' : 'none'}
            color={authenticated ? '#8f8' : '#f88'}
          />
          {user && (
            <>
              <Row label="actor" value={user.actorPtid} color="#ff8" />
              <Row label="name" value={user.name || '—'} color="#ff8" />
              <Row label="email" value={user.email || '—'} color="#ff8" />
              <Row label="method" value={user.loginMethod} color="#aaa" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: '#888', minWidth: 56, flexShrink: 0 }}>{label}:</span>
      <span style={{ color, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '4px 0' }} />;
}

registerDevPlugin({
  id: 'worktree-badge',
  slot: 'bottomLeft',
  order: 0,
  component: WorktreeBadge,
});
