declare const __PT_DEV_WORKTREE__: string;
declare const __PT_DEV_BRANCH__: string;

export function DevOverlay() {
  const worktree = __PT_DEV_WORKTREE__ || 'unknown';
  const branch = __PT_DEV_BRANCH__ || '';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 4,
        left: 4,
        zIndex: 99999,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 4,
        background: 'rgba(0,0,0,0.6)',
        color: '#0f0',
        fontSize: 10,
        fontFamily: 'monospace',
        lineHeight: 1.4,
        opacity: 0.8,
      }}
    >
      <span style={{ color: '#8f8' }}>wt:</span>
      <span>{worktree}</span>
      {branch && (
        <>
          <span style={{ color: '#888' }}>|</span>
          <span style={{ color: '#ff8' }}>{branch}</span>
        </>
      )}
    </div>
  );
}
