/**
 * UnknownOutcomeBar — shows pending commands with unknown status.
 *
 * Non-modal notification bar. Tapping opens the command detail.
 * Does not retry — the owning runtime performs reconciliation.
 */

import type { UnknownOutcomeState } from '../../runtimes/recoveryProjection';

interface UnknownOutcomeBarProps {
  readonly state: UnknownOutcomeState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function UnknownOutcomeBar({ state, t }: UnknownOutcomeBarProps) {
  return (
    <div
      className="recovery-bar recovery-unknown-outcome"
      role="alert"
      aria-label={t('mobile.recovery.unknownOutcome.title')}
    >
      <span className="recovery-bar__icon" aria-hidden="true">
        &#x26A0;
      </span>
      <span className="recovery-bar__text">
        {t('mobile.recovery.unknownOutcome.body', { count: state.commands.length })}
      </span>
    </div>
  );
}
