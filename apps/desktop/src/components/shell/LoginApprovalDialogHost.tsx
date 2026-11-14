import { useTranslation } from 'react-i18next';
import { Button, Dialog, Text } from '@peers-touch/ui';

import { loginApprovalActions } from '../../runtimes/loginApprovalRuntime';
import { useLoginApprovalStore } from '../../store/loginApproval';
import type { PendingLoginApproval } from '../../services/loginApproval';

type Translate = (key: string) => string;

interface LoginApprovalDialogContentProps {
  current: PendingLoginApproval;
  busy: boolean;
  error: string | null;
  t: Translate;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * Presentational approver dialog. Kept props-driven so the security-relevant
 * device identity and comparison-code projection is testable without a live
 * store or Tauri runtime; the connected host below owns state and actions.
 */
export function LoginApprovalDialogContent({
  current,
  busy,
  error,
  t,
  onApprove,
  onDeny,
}: LoginApprovalDialogContentProps) {
  return (
    <Dialog
      open
      className="pt-login-approval-dialog"
      title={t('auth.loginApproval.dialog.title')}
      width={420}
      onDismiss={() => { /* Approval stays pending; dismissing only closes the prompt. */ }}
    >
      <Text tone="secondary">{t('auth.loginApproval.dialog.subtitle')}</Text>
      <div className="pt-login-approval-device" data-pt-approval-device={current.deviceLabel}>
        <Text strong>{current.deviceLabel || current.claimantDeviceId}</Text>
        <Text tone="secondary">{current.platform}</Text>
      </div>
      <div className="pt-login-approval-code" data-pt-approval-code={current.comparisonCode}>
        <Text tone="secondary">{t('auth.loginApproval.waiting.comparison')}</Text>
        <Text strong className="pt-login-approval-code-value">{current.comparisonCode}</Text>
      </div>
      {error ? <Text tone="danger">{error}</Text> : null}
      <div className="pt-login-approval-actions">
        <Button
          actionId="login-approval-deny"
          emphasis="secondary"
          availability={busy ? { kind: 'disabled', reason: t('auth.loginApproval.dialog.deny') } : undefined}
          onActivate={onDeny}
        >
          {t('auth.loginApproval.dialog.deny')}
        </Button>
        <Button
          actionId="login-approval-allow"
          execution={busy ? 'pending' : 'idle'}
          onActivate={onApprove}
        >
          {t('auth.loginApproval.dialog.allow')}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Shell-level approver surface. It renders only when an authenticated device
 * has a pending request; it is never mounted inside the chat route or the
 * settings device panel.
 */
export function LoginApprovalDialogHost() {
  const { t } = useTranslation('auth');
  const pending = useLoginApprovalStore((state) => state.pending);
  const busy = useLoginApprovalStore((state) => state.approverBusy);
  const error = useLoginApprovalStore((state) => state.approverError);
  const current = pending[0];

  if (!current) return null;

  return (
    <LoginApprovalDialogContent
      current={current}
      busy={busy}
      error={error}
      t={t}
      onApprove={() => { void loginApprovalActions.approve(current.approvalId, current.revision); }}
      onDeny={() => { void loginApprovalActions.deny(current.approvalId, current.revision); }}
    />
  );
}
