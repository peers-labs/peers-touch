import { Check, X } from 'lucide-react';
import { T } from '../theme';

/**
 * Canonical accept / reject decision pair for inbound relationship requests
 * (friend requests, group invites). This is the ONLY visual form of that
 * decision across the product — the contacts book, the notification center,
 * and future surfaces must reuse it instead of restyling per surface.
 *
 * Geometry contract (enforced by qa/geometry_checks.py):
 *   30×30 hit area, radius 8; accept = primary wash + primary glyph,
 *   reject = hairline border + neutral glyph. Buttons share one center line
 *   and a trailing edge inside their row.
 */
export function RequestDecisionButtons({
  targetName,
  onAccept,
  onReject,
  acceptLabel = 'Accept',
  rejectLabel = 'Reject',
}: {
  targetName: string;
  onAccept: () => void;
  onReject: () => void;
  acceptLabel?: string;
  rejectLabel?: string;
}) {
  return (
    <span
      data-decision-buttons
      style={{ display: 'inline-flex', gap: 5, flexShrink: 0, alignItems: 'center' }}
    >
      <button
        type="button"
        data-decision-action="accept"
        aria-label={`${acceptLabel} ${targetName}`}
        title={acceptLabel}
        onClick={(event) => {
          event.stopPropagation();
          onAccept();
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, padding: 0, border: 'none', borderRadius: 8,
          background: T.primaryWash, color: T.primary, cursor: 'pointer',
        }}
      >
        <Check size={15} />
      </button>
      <button
        type="button"
        data-decision-action="reject"
        aria-label={`${rejectLabel} ${targetName}`}
        title={rejectLabel}
        onClick={(event) => {
          event.stopPropagation();
          onReject();
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, padding: 0,
          border: `1px solid ${T.border}`, borderRadius: 8,
          background: T.bg, color: T.textSecondary, cursor: 'pointer',
        }}
      >
        <X size={14} />
      </button>
    </span>
  );
}
