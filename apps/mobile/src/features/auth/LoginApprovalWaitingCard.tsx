import { useState } from 'react';
import { Button, Icon, Spin, Text } from '@peers-touch/ui';

import {
  LoginApprovalState,
  type LoginApprovalProjection,
} from '../../services/loginApproval';

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  readonly projection: LoginApprovalProjection;
  readonly busy: boolean;
  readonly errorKey: string | null;
  readonly t: Translate;
  readonly onCancel: () => void;
  /** Folded fallback surface (recovery phrase / future email challenge). */
  readonly fallback?: React.ReactNode;
}

function reasonKey(state: number): string | null {
  switch (state) {
    case LoginApprovalState.DENIED:
      return 'mobile.loginApproval.denied';
    case LoginApprovalState.CANCELLED:
      return 'mobile.loginApproval.cancelled';
    case LoginApprovalState.EXPIRED:
      return 'mobile.loginApproval.expired';
    default:
      return null;
  }
}

/**
 * Claimant waiting surface. The recovery fallback stays folded behind a
 * low-emphasis link so recovery never enters the main login path.
 */
export function LoginApprovalWaitingCard({
  projection,
  busy,
  errorKey,
  t,
  onCancel,
  fallback,
}: Props) {
  const [showFallback, setShowFallback] = useState(false);
  const reason = reasonKey(projection.state);
  const waiting =
    projection.state === LoginApprovalState.PENDING ||
    projection.state === LoginApprovalState.APPROVED;

  return (
    <main
      className="auth-gate-screen"
      data-product-surface="entry.login-approval-waiting"
      data-pt-approval-state={projection.state}
    >
      <div className="auth-gate-card">
        <div className="auth-gate-card-body">
        <section className="auth-gate-brand">
          <Icon iconId="shield-check" size={32} />
          <div className="auth-gate-brand-copy">
            <h1 className="auth-gate-title">
              {t('mobile.loginApproval.waiting.title')}
            </h1>
            <Text tone="secondary">{t('mobile.loginApproval.waiting.subtitle')}</Text>
          </div>
        </section>

        {waiting ? <Spin active size="small" /> : null}

        <section className="mobile-login-approval-code-block">
          <Text tone="secondary">{t('mobile.loginApproval.comparison')}</Text>
          <output
            className="mobile-login-approval-code"
            data-pt-approval-code={projection.comparisonCode}
            aria-label={t('mobile.loginApproval.comparison')}
          >
            {projection.comparisonCode}
          </output>
        </section>

        {reason ? (
          <Text tone="warning" role="status">
            {t(reason)}
          </Text>
        ) : null}
        {errorKey ? (
          <Text tone="danger" role="alert">
            {t(errorKey)}
          </Text>
        ) : null}

        <div className="auth-actions">
          <Button actionId="login-approval-cancel"
            availability={busy || !waiting ? { kind: 'disabled', reason: t(reason ?? 'mobile.loginApproval.waiting.title') } : undefined}
            execution={busy ? 'pending' : 'idle'} onActivate={onCancel}>
            {t('mobile.loginApproval.cancel')}
          </Button>
        </div>

        <Button
          actionId="login-approval-fallback"
          emphasis="quiet"
          aria-expanded={showFallback}
          onActivate={() => setShowFallback((value) => !value)}
        >
          {t('mobile.loginApproval.fallback')}
        </Button>
        {showFallback ? (
          <div className="mobile-login-approval-fallback">{fallback}</div>
        ) : null}
        </div>
      </div>
    </main>
  );
}
