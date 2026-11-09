import { forwardRef, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import type { Tone } from '@peers-touch/ui-contracts';
import { Icon } from './icon';
import { IconButton } from './actions';

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode; description?: ReactNode; tone?: Tone; action?: ReactNode; icon?: ReactNode;
  /** card = bordered tinted callout for blocking messages; inline = quiet
      in-flow status with a 2px tone rail (no bordered box). */
  variant?: 'card' | 'inline';
  dismissLabel?: string; onDismiss?: () => void;
}
export function Alert({ title, description, tone = 'info', variant = 'card', action, icon, children, dismissLabel, onDismiss, className = '', ...props }: AlertProps) {
  return <div {...props} className={`pt-alert ${className}`} data-tone={tone} data-variant={variant}
    role={props.role ?? (tone === 'danger' ? 'alert' : 'status')}>
    {icon ?? (tone === 'warning' || tone === 'danger' ? <Icon iconId="warning" /> : null)}
    <div className="pt-alert-body">{title && <div className="pt-alert-title">{title}</div>}
      {(description || children) && <div className="pt-alert-description">{description ?? children}</div>}</div>
    {action}{onDismiss && <IconButton actionId="alert.dismiss" iconId="close" label={dismissLabel ?? 'Dismiss'} emphasis="quiet" onActivate={onDismiss} />}
  </div>;
}
export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone; leading?: ReactNode; dismissLabel?: string; onDismiss?: () => void;
}
export function Tag({ children, tone = 'neutral', leading, onDismiss, dismissLabel, className = '', ...props }: TagProps) {
  return <span {...props} className={`pt-tag ${className}`} data-tone={tone}>{leading}{children}
    {onDismiss && <IconButton actionId="tag.dismiss" iconId="close" label={dismissLabel ?? 'Remove'}
      density="compact" emphasis="quiet" onActivate={event => { event.stopPropagation(); onDismiss(); }} />}</span>;
}
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  count?: number; limit?: number; label?: string; showZero?: boolean; indicator?:boolean; tone?:Tone; caption?:ReactNode;
}
// Forward the overlay-trigger ref: Popover/Menu inject an anchor ref onto
// their single trigger child, so a Badge trigger must expose its span for the
// popup to position against (see Tooltip's identical contract).
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { count, limit = 99, label, showZero, indicator, tone='info', caption, children, className = '', ...props },
  ref,
) {
  return <span {...props} ref={ref} className={`pt-badge ${className}`}>{children}
    {indicator&&<span className="pt-badge-indicator" data-tone={tone} role="img" aria-label={label??(typeof caption==='string'?caption:tone)}/>}
    {caption}
    {count !== undefined && (count > 0 || showZero) && <span className="pt-badge-count" aria-label={label}>
      {count > limit ? `${limit}+` : count}</span>}</span>;
});
export interface EmptyProps extends HTMLAttributes<HTMLDivElement> { description?: ReactNode; icon?: ReactNode; action?: ReactNode }
export function Empty({ description = 'No items', icon, action, children, className = '', ...props }: EmptyProps) {
  return <div {...props} className={`pt-empty ${className}`}>{icon}<div>{description}</div>{children}{action}</div>;
}
export interface SpinProps extends HTMLAttributes<HTMLDivElement> { label?: ReactNode; active?: boolean; size?: 'small' | 'normal' | 'large' }
export function Spin({ label, active = true, children, size = 'normal', style, ...props }: SpinProps) {
  if (!active) return <>{children}</>;
  return <div {...props} role="status" aria-busy="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--pt-space-xs)', ...style }}>
    <span className="pt-spinner" style={{ width: size === 'small' ? 14 : size === 'large' ? 28 : 18, height: size === 'small' ? 14 : size === 'large' ? 28 : 18 }} />
    {label}<span className="pt-loading-content">{children}</span>
  </div>;
}
export interface ProgressProps extends HTMLAttributes<HTMLDivElement> { value: number; maximum?: number; label?: string; showValue?: boolean; tone?: Tone }
export function Progress({ value, maximum = 100, label, showValue = true, tone='neutral', className = '', style, ...props }: ProgressProps) {
  return <div {...props} className={`pt-progress ${className}`} style={{accentColor:`var(--pt-${tone==='neutral'?'primary':tone})`,...style}}><progress value={value} max={maximum} aria-label={label} style={{accentColor:'inherit'}} />
    {showValue && <span>{Math.round(value / maximum * 100)}%</span>}</div>;
}
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> { lines?: number; width?: number | string; height?: number | string }
export function Skeleton({ lines = 1, width = '100%', height = 16, style, ...props }: SkeletonProps) {
  return <div {...props} aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-xs)', ...style }}>
    {Array.from({ length: Math.min(50, Math.max(1, lines)) }, (_, i) =>
      <div key={i} className="pt-skeleton" style={{ width: i === lines - 1 && lines > 1 ? '70%' : width, height }} />)}
  </div>;
}
export interface ResultProps { title: ReactNode; description?: ReactNode; tone?: Tone; actions?: ReactNode; icon?: ReactNode }
export function Result({ title, description, tone, actions, icon }: ResultProps) {
  return <div className="pt-empty" data-tone={tone}>{icon}<h2>{title}</h2>{description && <div>{description}</div>}{actions}</div>;
}
export interface ToastNotice { id: string; message: ReactNode; tone?: Tone; duration?: number; action?: ReactNode }
type ToastListener = (notice: ToastNotice | { dismiss: string }) => void;
/** Shell-local instance, so notifications from another window never leak here. */
export function createToastChannel() {
  const listeners = new Set<ToastListener>();
  return {
    publish: (notice: ToastNotice) => { for (const listener of listeners) listener(notice); },
    dismiss: (id: string) => { for (const listener of listeners) listener({ dismiss: id }); },
    subscribe: (listener: ToastListener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type ToastChannel = ReturnType<typeof createToastChannel>;
export function ToastHost({ channel }: { channel: ToastChannel }) {
  const [notices, setNotices] = useState<ToastNotice[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const unsubscribe = channel.subscribe(event => {
      if ('dismiss' in event) {
        const timer = timers.current.get(event.dismiss);
        if (timer) clearTimeout(timer);
        timers.current.delete(event.dismiss);
        setNotices(old => old.filter(item => item.id !== event.dismiss));
        return;
      }
      const timer = timers.current.get(event.id);
      if (timer) clearTimeout(timer);
      setNotices(old => [...old.filter(item => item.id !== event.id), event]);
      if (event.duration !== 0) timers.current.set(event.id, setTimeout(() => channel.dismiss(event.id), event.duration ?? 4000));
    });
    return () => { unsubscribe(); for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, [channel]);
  return <div className="pt-toast-host" aria-live="polite" aria-atomic="false">
    {notices.map(notice => <div key={notice.id} className="pt-toast" data-tone={notice.tone}>
      {notice.message}{notice.action}<IconButton actionId={`toast.${notice.id}.dismiss`} iconId="close" label="Dismiss"
        emphasis="quiet" density="compact" onActivate={() => channel.dismiss(notice.id)} /></div>)}
  </div>;
}
export interface StatisticProps { label?: ReactNode; value: string | number; prefix?: ReactNode; suffix?: ReactNode; precision?: number; valueStyle?: CSSProperties }
export function Statistic({ label, value, prefix, suffix, precision, valueStyle }: StatisticProps) {
  return <div>{label && <div className="pt-list-description">{label}</div>}
    <div style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...valueStyle }}>
      {prefix}{typeof value === 'number' && precision !== undefined ? value.toFixed(precision) : value}{suffix}
    </div></div>;
}
