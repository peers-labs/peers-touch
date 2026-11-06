/**
 * Desktop shell — profile popover.
 *
 * Opens from the rail avatar with the canonical identity geometry: cover
 * banner + avatar overlapping its lower edge with a white separation ring,
 * handle, posts/follows/followers, join date, and a manage-account action
 * that routes into Settings. Single-instance: the caller owns open state and
 * closes on outside click / Escape / navigation. Read-only prototype content
 * shared with the Settings identity card (林野 / @linye) — no mocked client.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { Globe } from 'lucide-react';
import { Button } from '@peers-touch/ui';
import { T } from './theme';

const STATS: { value: number; label: string }[] = [
  { value: 12, label: '动态' },
  { value: 86, label: '关注' },
  { value: 104, label: '粉丝' },
];

export function ProfilePopover({
  anchorRef, onClose, onManageAccount,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onManageAccount: () => void;
}) {
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ left: rect.right + 12, top: rect.top - 8 });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchorRef]);

  return (
    <>
      <div aria-hidden
        onClick={onClose} onWheel={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
      <div
        role="dialog" aria-label="我的资料"
        data-shell-profile
        style={{
          position: 'fixed', left: anchor.left, top: anchor.top, zIndex: 56,
          width: 340, borderRadius: 16, overflow: 'hidden',
          background: T.white, border: `1px solid ${T.borderSoft}`,
          boxShadow: '0 18px 48px rgba(15,23,42,0.22)',
        }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      >
        <div style={{
          position: 'relative', height: 124,
          background: `linear-gradient(120deg, ${T.primary} 0%, #9a8df0 100%)`,
        }} />
        <div style={{ padding: '0 18px 16px' }}>
          <div style={{ marginTop: -34 }}>
            <div style={{
              position: 'relative', zIndex: 1,
              width: 72, height: 72, borderRadius: 14,
              background: '#2f6a50',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontWeight: 700, color: T.white,
              border: `4px solid ${T.white}`,
              boxShadow: '0 4px 14px rgba(15,23,42,0.16)',
            }}>
              林
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>林野</div>
            <div style={{ fontSize: 13, color: T.textSecondary, marginTop: 2 }}>@linye · 松绿书屋站</div>
          </div>
          <div style={{ display: 'flex', gap: 22, marginTop: 14 }}>
            {STATS.map(stat => (
              <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <strong style={{ fontSize: 17, fontWeight: 700, color: T.text, fontVariantNumeric: 'tabular-nums' }}>
                  {stat.value}
                </strong>
                <span style={{ fontSize: 12, color: T.textSecondary }}>{stat.label}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 10 }}>2025-10 加入</div>
          <div style={{ height: 1, background: T.borderSoft, margin: '14px 0' }} />
          <Button
            actionId="shell.profile.manage"
            data-shell-profile-manage
            fullWidth
            emphasis="secondary"
            leading={<Globe size={15} />}
            label="管理账号"
            onActivate={onManageAccount}
            style={{
              width: '100%', height: 38, borderRadius: 10,
              border: `1px solid ${T.borderSoft}`,
              fontSize: 13, fontWeight: 600,
            }}
          />
        </div>
      </div>
    </>
  );
}
