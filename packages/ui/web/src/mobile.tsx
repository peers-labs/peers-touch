/**
 * Mobile product primitives.
 *
 * These are PRODUCT chrome, not prototype scaffolding: the native Mobile
 * runtime composes the same pieces. They follow the north-star grammar shared
 * with desktop:
 *   - ink/paper surfaces, pine only as the current-location mark;
 *   - every interactive control is a peers-ui action primitive
 *     (IconButton / Button), never a hand-rolled element;
 *   - geometry is token-driven and safe-area aware.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { Badge } from './feedback';
import { IconButton } from './actions';
import type { IconId } from '@peers-touch/ui-assets';

/* ── Device status bar ───────────────────────────────────────────────────
 * Simulated iOS device chrome. In the native runtime the OS owns this row;
 * inside prototype frames the library owns it so every surface shows the SAME
 * truthful anatomy instead of hand-rolled "5G 100%" text. Indicators are
 * inline SVG (device-status glyph family, distinct from the semantic icon
 * set), paint with currentColor, and are hidden from assistive tech since
 * they describe a simulated device, not app content. */
export interface MobileStatusBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  time?: string;
  /** Cellular generation label next to the signal bars (e.g. "5G"). */
  carrier?: string;
  /** Cellular reception 0–4; bars above the level render faint. */
  signalLevel?: 0 | 1 | 2 | 3 | 4;
  /** Show the Wi-Fi glyph. */
  wifi?: boolean;
  /** Charge 0–100; below 20 the battery fill takes the danger token. */
  battery?: number;
  charging?: boolean;
  /** Render the centered Dynamic Island pill (prototype frames only; the
      native OS draws its own, so production callers leave this off). */
  island?: boolean;
}

function SignalBars({ level }: { level: number }) {
  const heights = [4, 6, 8, 10];
  return (
    <svg className="pt-status-signal" width="17" height="11" viewBox="0 0 17 11" aria-hidden="true">
      {heights.map((h, i) => (
        <rect key={i} x={i * 4.33} y={11 - h} width="3" height={h} rx="1"
          fill="currentColor" opacity={i < level ? 1 : 0.25} />
      ))}
    </svg>
  );
}

function WifiGlyph() {
  return (
    <svg className="pt-status-wifi" width="16" height="12" viewBox="0 0 17 12" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 4.2A10.6 10.6 0 0 1 15 4.2" />
      <path d="M4.8 7.1A6.6 6.6 0 0 1 12.2 7.1" />
      <circle cx="8.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BatteryGlyph({ level, charging }: { level: number; charging: boolean }) {
  // iOS anatomy: translucent body outline, solid level fill, nub on the right.
  const clamped = Math.max(0, Math.min(100, level));
  const innerWidth = 20 * (clamped / 100);
  return (
    <svg className="pt-status-battery" width="26.5" height="13" viewBox="0 0 26.5 13" aria-hidden="true">
      <rect x="0.6" y="0.7" width="22.8" height="11.6" rx="3.6" fill="none"
        stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" />
      <rect x="24" y="4" width="1.7" height="5" rx="0.85" fill="currentColor" fillOpacity="0.45" />
      {innerWidth > 0 && (
        <rect className="pt-status-battery-fill" x="1.9" y="2" width={Math.max(2.2, innerWidth)} height="9" rx="1.8"
          fill="currentColor" data-low={clamped <= 20 && !charging ? '' : undefined} />
      )}
      {charging && (
        <path className="pt-status-battery-bolt" d="M13.2 2.4 9.8 7h2.7l-1.3 3.6L15.6 6h-2.8L14.2 2.4Z"
          fill="var(--pt-canvas)" />
      )}
    </svg>
  );
}

export function MobileStatusBar({
  time = '9:41', carrier = '5G', signalLevel = 4, wifi = true, battery = 100, charging = false,
  island = false, className = '', ...props
}: MobileStatusBarProps) {
  return (
    <div {...props} aria-hidden="true" className={`pt-mobile-statusbar ${className}`}>
      {island && <span className="pt-mobile-island" />}
      <span className="pt-mobile-statusbar-time">{time}</span>
      <span className="pt-mobile-statusbar-indicators">
        <SignalBars level={signalLevel} />
        {carrier && <span className="pt-mobile-statusbar-carrier">{carrier}</span>}
        {wifi && <WifiGlyph />}
        <span className="pt-mobile-statusbar-battery-label">{battery}%</span>
        <BatteryGlyph level={battery} charging={charging} />
      </span>
    </div>
  );
}

/* ── Navigation bar (pushed secondary pages) ─────────────────────────────
 * Back on the left, a single centered title, optional trailing actions. */
export interface MobileNavBarProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  onBack?: () => void;
  /** Localized accessible label for the back control; supplied by the caller. */
  backLabel: string;
  actions?: ReactNode;
}
export function MobileNavBar({ title, onBack, backLabel, actions, className = '', ...props }: MobileNavBarProps) {
  return (
    <header {...props} className={`pt-mobile-navbar ${className}`}>
      <span className="pt-mobile-navbar-side">
        {onBack && (
          <IconButton actionId="mobile.nav.back" iconId="chevron-left" iconSize={22}
            label={backLabel} emphasis="quiet" onActivate={onBack} />
        )}
      </span>
      <h1 className="pt-mobile-navbar-title">{title}</h1>
      <span className="pt-mobile-navbar-side pt-mobile-navbar-actions">{actions}</span>
    </header>
  );
}

/* ── Bottom tab bar ──────────────────────────────────────────────────────
 * The mobile equivalent of the desktop SideNav: icon-only tiles with the
 * SAME current-location grammar — pine solid tile with on-accent glyph — so
 * "where you are" reads identically across platforms. Captions are not
 * rendered (the glyph carries meaning at this scale); `label` stays the
 * control's accessible name. Unread count uses the danger pill, matching the
 * desktop rail badge. */
export interface MobileTabItem {
  id: string;
  label: string;
  icon: IconId;
  badgeCount?: number;
}
export interface MobileTabBarProps extends HTMLAttributes<HTMLElement> {
  items: readonly MobileTabItem[];
  value: string;
  onValueChange: (id: string) => void;
  ariaLabel?: string;
}
export function MobileTabBar({ items, value, onValueChange, ariaLabel = '主导航', className = '', ...props }: MobileTabBarProps) {
  return (
    <nav {...props} aria-label={ariaLabel} className={`pt-mobile-tabbar ${className}`}>
      {items.map(item => {
        const active = item.id === value;
        return (
          <span key={item.id} className="pt-mobile-tab">
            <Badge count={item.badgeCount} tone="danger" showZero={false}>
              <IconButton actionId={`mobile.tab.${item.id}`} iconId={item.icon} iconSize={24}
                label={item.label} emphasis="quiet" aria-current={active ? 'page' : undefined}
                data-tab-active={active || undefined}
                onActivate={() => onValueChange(item.id)} />
            </Badge>
          </span>
        );
      })}
    </nav>
  );
}
