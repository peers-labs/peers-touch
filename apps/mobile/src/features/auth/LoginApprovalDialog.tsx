import { Button, Dialog, Text } from '@peers-touch/ui';

import type { PendingLoginApproval } from '../../services/loginApproval';

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  readonly pending: PendingLoginApproval[];
  readonly busy: boolean;
  readonly errorKey: string | null;
  readonly t: Translate;
  readonly onAllow: (approvalId: string, revision: number) => void;
  readonly onDeny: (approvalId: string, revision: number) => void;
  /** Dismiss only closes the prompt; the request stays pending Station-side. */
  readonly onDismiss: () => void;
}

interface ContentProps {
  readonly current: PendingLoginApproval;
  readonly busy: boolean;
  readonly errorKey: string | null;
  readonly t: Translate;
  readonly onAllow: (approvalId: string, revision: number) => void;
  readonly onDeny: (approvalId: string, revision: number) => void;
}

/** Portal-free presentational body so the decision contract is unit-testable. */
export function LoginApprovalDialogContent({
  current,
  busy,
  errorKey,
  t,
  onAllow,
  onDeny,
}: ContentProps) {
  return (
    <div data-pt-approval-dialog="open">
      <Text tone="secondary">{t('mobile.loginApproval.dialog.subtitle')}</Text>
      <section className="mobile-login-approval-device" data-pt-approval-device={current.deviceLabel}>
        <strong>{current.deviceLabel || current.claimantDeviceId}</strong>
        <Text tone="secondary">{current.platform}</Text>
      </section>
      <section className="mobile-login-approval-code-block">
        <Text tone="secondary">{t('mobile.loginApproval.comparison')}</Text>
        <output
          className="mobile-login-approval-code"
          data-pt-approval-code={current.comparisonCode}
        >
          {current.comparisonCode}
        </output>
      </section>
      {errorKey ? (
        <Text tone="danger" role="alert">
          {t(errorKey)}
        </Text>
      ) : null}
      <div className="mobile-login-approval-actions">
        <Button
          actionId="login-approval-deny"
          availability={busy ? { kind: 'disabled', reason: t('mobile.loginApproval.deciding') } : undefined}
          onActivate={() => onDeny(current.approvalId, current.revision)}
        >
          {t('mobile.loginApproval.dialog.deny')}
        </Button>
        <Button
          actionId="login-approval-allow"
          emphasis="primary"
          execution={busy ? 'pending' : 'idle'}
          onActivate={() => onAllow(current.approvalId, current.revision)}
        >
          {t('mobile.loginApproval.dialog.allow')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Authenticated approver surface. Rendered at the Shell level, never inside a
 * chat route or the settings device panel.
 */
export function LoginApprovalDialog({
  pending,
  busy,
  errorKey,
  t,
  onAllow,
  onDeny,
  onDismiss,
}: Props) {
  const current = pending[0];
  return (
    <Dialog
      open={!!current}
      className="mobile-login-approval-dialog"
      title={t('mobile.loginApproval.dialog.title')}
      onDismiss={onDismiss}
      closeLabel={t('mobile.loginApproval.cancel')}
      footer={null}
    >
      {current ? (
        <LoginApprovalDialogContent
          current={current}
          busy={busy}
          errorKey={errorKey}
          t={t}
          onAllow={onAllow}
          onDeny={onDeny}
        />
      ) : null}
    </Dialog>
  );
}
