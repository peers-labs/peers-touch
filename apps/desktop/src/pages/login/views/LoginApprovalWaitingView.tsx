import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Spin, Text } from '@peers-touch/ui';

import { LOGIN_APPROVAL_STATE, type LoginApprovalProjection } from '../../../services/loginApproval';
import { loginApprovalActions } from '../../../runtimes/loginApprovalRuntime';

interface Props {
  projection: LoginApprovalProjection;
  busy: boolean;
  error: string | null;
  // Folded fallback surface (recovery phrase / future email challenge). It is
  // not rendered until the user expands it, so recovery never enters the main
  // login path.
  fallback?: React.ReactNode;
}

function terminalReasonKey(state: number): string | null {
  switch (state) {
    case LOGIN_APPROVAL_STATE.DENIED: return 'auth.loginApproval.denied';
    case LOGIN_APPROVAL_STATE.CANCELLED: return 'auth.loginApproval.cancelled';
    case LOGIN_APPROVAL_STATE.EXPIRED: return 'auth.loginApproval.expired';
    default: return null;
  }
}

export function LoginApprovalWaitingView({ projection, busy, error, fallback }: Props) {
  const { t } = useTranslation('auth');
  const [showFallback, setShowFallback] = useState(false);
  const reason = terminalReasonKey(projection.state);
  const stillWaiting = projection.state === LOGIN_APPROVAL_STATE.PENDING
    || projection.state === LOGIN_APPROVAL_STATE.APPROVED;

  return (
    <div className="pt-login-approval-waiting" data-pt-approval-state={projection.state}>
      <Text strong className="pt-login-approval-waiting-title">
        {t('auth.loginApproval.waiting.title')}
      </Text>
      {stillWaiting ? <Spin /> : null}
      <Text tone="secondary">{t('auth.loginApproval.waiting.subtitle')}</Text>

      <div className="pt-login-approval-waiting-code" data-pt-approval-code={projection.comparisonCode}>
        <Text tone="secondary">{t('auth.loginApproval.waiting.comparison')}</Text>
        <Text strong className="pt-login-approval-waiting-code-value">{projection.comparisonCode}</Text>
      </div>

      {reason ? <Alert tone="warning" title={t(reason)} /> : null}
      {error ? <Alert tone="danger" title={error} /> : null}

      <Button
        actionId="login-approval-cancel"
        emphasis="secondary"
        execution={busy ? 'pending' : 'idle'}
        availability={!stillWaiting
          ? { kind: 'disabled', reason: t('auth.loginApproval.waiting.cancel') }
          : undefined}
        onActivate={() => { void loginApprovalActions.cancelClaimant(); }}
      >
        {t('auth.loginApproval.waiting.cancel')}
      </Button>

      <button
        type="button"
        className="pt-login-approval-fallback-toggle"
        onClick={() => setShowFallback((value) => !value)}
      >
        {t('auth.loginApproval.waiting.fallback')}
      </button>
      {showFallback ? <div className="pt-login-approval-fallback">{fallback}</div> : null}
    </div>
  );
}
