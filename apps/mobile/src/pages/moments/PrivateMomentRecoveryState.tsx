import { ArrowLeft, KeyRound, RotateCcw, ShieldAlert, ShieldX } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { PrivateMomentReadProjection } from '../../services/mobileCommands';

import './PrivateMomentRecoveryState.css';

type BlockingPrivateMomentState = Extract<
  PrivateMomentReadProjection['state'],
  'RECOVERY_REQUIRED' | 'INTEGRITY_FAILURE' | 'DELETED_OR_REVOKED'
>;

const REVOCATION_REASONS = new Set([
  'RESOURCE_DELETED',
  'RELATIONSHIP_REVOKED',
  'RECIPIENT_BLOCKED',
]);

interface PrivateMomentRecoveryStateProps {
  readonly projection: PrivateMomentReadProjection & {
    readonly state: BlockingPrivateMomentState;
  };
  readonly busy: boolean;
  readonly error: boolean;
  readonly onBack: () => void;
  readonly onRecover: () => void;
  readonly onRetryVerification: () => void;
}

export function PrivateMomentRecoveryState({
  projection,
  busy,
  error,
  onBack,
  onRecover,
  onRetryVerification,
}: PrivateMomentRecoveryStateProps) {
  const { t } = useMobileI18n();
  const recoveryRequired = projection.state === 'RECOVERY_REQUIRED';
  const revoked = projection.state === 'DELETED_OR_REVOKED';
  const revocationReason = revoked && projection.errorCode
    && REVOCATION_REASONS.has(projection.errorCode)
    ? projection.errorCode
    : null;
  const stateKey = revocationReason
    ? `moments.private.revocation.${revocationReason}`
    : `mobile.moments.private.state.${projection.state}`;
  const Icon = recoveryRequired ? KeyRound : revoked ? ShieldX : ShieldAlert;
  const action = revoked
    ? {
        icon: <ArrowLeft size={15} />,
        label: t('common.action.back'),
        onClick: onBack,
      }
    : recoveryRequired
      ? {
          icon: <KeyRound size={15} />,
          label: t('mobile.moments.private.recovery.action'),
          onClick: onRecover,
        }
      : {
          icon: <RotateCcw size={15} />,
          label: t('mobile.moments.private.integrity.retry'),
          onClick: onRetryVerification,
        };

  return (
    <section
      className="private-moment-recovery"
      data-private-moment-state={projection.state}
      data-private-moment-post-id={projection.postId}
      role="alert"
      aria-busy={busy}
    >
      <span className="private-moment-recovery__icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="private-moment-recovery__copy">
        <strong>{t(`${stateKey}.title`)}</strong>
        <p>{t(`${stateKey}.description`)}</p>
        {revoked ? <p>{t('moments.private.revocation.copyBoundary')}</p> : null}
        {error ? <p className="private-moment-recovery__error">
          {t('mobile.moments.private.recovery.failed')}
        </p> : null}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={action.onClick}
      >
        {action.icon}
        {action.label}
      </button>
    </section>
  );
}
