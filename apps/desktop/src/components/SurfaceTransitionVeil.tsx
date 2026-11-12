import { BRANDING } from '../branding';

interface SurfaceTransitionVeilProps {
  /** Mounted and covering the window (opacity 1). */
  visible: boolean;
  /** Playing the opacity-only exit fade while the ready shell paints beneath. */
  leaving: boolean;
}

/**
 * Full-window boot veil shown while the native window resizes from the compact
 * auth surface to the ready shell. It mirrors the ResumingView boot grammar
 * (neutral paper canvas, ink wordmark, one pine connection mark) so the
 * auth → ready transition reads as one continuous surface instead of exposing
 * the shell re-laying out at intermediate widths. The veil only cross-fades —
 * it never translates — per the surface motion contract.
 */
export function SurfaceTransitionVeil({ visible, leaving }: SurfaceTransitionVeilProps) {
  if (!visible) return null;
  return (
    <div
      className={`pt-surface-veil${leaving ? ' is-leaving' : ''}`}
      data-pt-surface-veil={leaving ? 'leaving' : 'covering'}
      aria-busy="true"
    >
      <span className="pt-surface-veil__wordmark">{BRANDING.appName}</span>
      <span className="pt-surface-veil__ring" aria-label="Loading" role="status" />
    </div>
  );
}
