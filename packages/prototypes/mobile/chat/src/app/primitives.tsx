/**
 * MobileApp shared view primitives — layout-only presentational pieces used
 * across screens. They compose @peers-touch/ui controls but never encode
 * business state; parents pass data and callbacks.
 */
import { useEffect, type ReactNode } from 'react';
import { Avatar, Button, Icon, IconButton } from '@peers-touch/ui';

export function IdentityAvatar({ name, size, tone, online, group }: {
  name: string; size: number; tone: string; online?: boolean; group?: boolean;
}) {
  return (
    <span className="ma-avatar-wrap">
      <Avatar name={group ? '' : name} size={size} background={tone}
        fallback={group ? <Icon iconId="users" size={size * 0.46} /> : undefined} />
      {online && <span className="ma-online-dot" />}
    </span>
  );
}

export function StatusBar() {
  return (
    <div className="ma-statusbar">
      <span>9:41</span>
      <span className="ma-status-icons"><span>5G</span><span>100%</span></span>
    </div>
  );
}

/** Back + centered title + optional trailing actions, shared by every pushed
    secondary page (thread / detail / setting / search). */
export function SubHeader({ title, onBack, actions }: { title: string; onBack?: () => void; actions?: ReactNode }) {
  return (
    <header className="ma-thread-topbar">
      {onBack
        ? <IconButton actionId="ma.back" iconId="chevron-left" label="返回" emphasis="quiet" iconSize={22} onActivate={onBack} />
        : <span className="ma-thread-topbar-spacer" />}
      <span className="ma-thread-name">{title}</span>
      <span className="ma-thread-actions">{actions}</span>
    </header>
  );
}

export function DetailShell({ title, onBack, action, children }: {
  title: string; onBack: () => void; action?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="ma-page ma-detail">
      <SubHeader title={title} onBack={onBack} actions={action} />
      <div className="ma-detail-body">{children}</div>
    </div>
  );
}

export function DetailHero({ name, meta, tone, group }: { name: string; meta: string; tone: string; group?: boolean }) {
  return (
    <div className="ma-detail-hero">
      <Avatar name={group ? '' : name} size={72} background={tone} fallback={group ? <Icon iconId="users" size={33} /> : undefined} />
      <strong>{name}</strong>
      <em>{meta}</em>
    </div>
  );
}

export interface SheetAction { id: string; label: string; icon?: never; tone?: 'default' | 'danger'; onActivate: () => void }

/** In-frame bottom action sheet. Stays inside the phone screen (absolute to
    .ma-root) instead of portaling to the browser viewport. */
export function ActionSheet({ title, open, onClose, children, actions }: {
  title: string; open: boolean; onClose: () => void; children?: ReactNode; actions?: SheetAction[];
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ma-sheet-scrim" onClick={onClose}>
      <div className="ma-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <span className="ma-sheet-grip" />
        <h3 className="ma-sheet-title">{title}</h3>
        {children}
        {actions && (
          <div className="ma-sheet-actions">
            {actions.map(a => (
              <Button key={a.id} actionId={a.id} fullWidth emphasis="quiet"
                className={`ma-sheet-action${a.tone === 'danger' ? ' is-danger' : ''}`}
                tone={a.tone === 'danger' ? 'danger' : undefined}
                onActivate={a.onActivate}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
