import { useState } from 'react';
import { Button, Card, Typography } from 'antd';
import { LoaderCircle, ShieldCheck } from 'lucide-react';

import {
  LoginApprovalState,
  type LoginApprovalProjection,
} from '../../services/loginApproval';

const { Text, Title } = Typography;

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
      <Card className="auth-gate-card" variant="borderless">
        <section className="auth-gate-brand">
          <ShieldCheck size={32} aria-hidden="true" />
          <div className="auth-gate-brand-copy">
            <Title level={1} className="auth-gate-title">
              {t('mobile.loginApproval.waiting.title')}
            </Title>
            <Text type="secondary">{t('mobile.loginApproval.waiting.subtitle')}</Text>
          </div>
        </section>

        {waiting ? <LoaderCircle size={20} aria-hidden="true" className="mobile-login-approval-spinner" /> : null}

        <section className="mobile-login-approval-code-block">
          <Text type="secondary">{t('mobile.loginApproval.comparison')}</Text>
          <output
            className="mobile-login-approval-code"
            data-pt-approval-code={projection.comparisonCode}
            aria-label={t('mobile.loginApproval.comparison')}
          >
            {projection.comparisonCode}
          </output>
        </section>

        {reason ? (
          <Text type="warning" role="status">
            {t(reason)}
          </Text>
        ) : null}
        {errorKey ? (
          <Text type="danger" role="alert">
            {t(errorKey)}
          </Text>
        ) : null}

        <div className="auth-actions">
          <Button disabled={busy || !waiting} loading={busy} onClick={onCancel}>
            {t('mobile.loginApproval.cancel')}
          </Button>
        </div>

        <button
          type="button"
          className="mobile-login-approval-fallback-toggle"
          aria-expanded={showFallback}
          onClick={() => setShowFallback((value) => !value)}
        >
          {t('mobile.loginApproval.fallback')}
        </button>
        {showFallback ? (
          <div className="mobile-login-approval-fallback">{fallback}</div>
        ) : null}
      </Card>
    </main>
  );
}
