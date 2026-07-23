import { registerDevPlugin } from '../registry';

declare const __PT_DEV_WORKTREE__: string;
declare const __PT_DEV_BRANCH__: string;

function WorktreeBadge() {
  const worktree = __PT_DEV_WORKTREE__ || 'unknown';
  const branch = __PT_DEV_BRANCH__ || '';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 4,
        background: 'rgba(0,0,0,0.55)',
        color: '#0f0',
        fontSize: 10,
        fontFamily: 'monospace',
        lineHeight: 1.4,
      }}
    >
      <span style={{ color: '#8f8' }}>wt:</span>
      <span>{worktree}</span>
      {branch && branch !== worktree && (
        <>
          <span style={{ color: '#555' }}>|</span>
          <span style={{ color: '#ff8' }}>{branch}</span>
        </>
      )}
    </span>
  );
}

registerDevPlugin({
  id: 'worktree-badge',
  slot: 'bottomLeft',
  order: 0,
  component: WorktreeBadge,
});
