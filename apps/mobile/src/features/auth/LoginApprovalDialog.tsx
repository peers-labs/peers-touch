import { Button, Modal, Typography } from 'antd';

import type { PendingLoginApproval } from '../../services/loginApproval';

const { Text } = Typography;

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
      <Text type="secondary">{t('mobile.loginApproval.dialog.subtitle')}</Text>
      <section className="mobile-login-approval-device" data-pt-approval-device={current.deviceLabel}>
        <Text strong>{current.deviceLabel || current.claimantDeviceId}</Text>
        <Text type="secondary">{current.platform}</Text>
      </section>
      <section className="mobile-login-approval-code-block">
        <Text type="secondary">{t('mobile.loginApproval.comparison')}</Text>
        <output
          className="mobile-login-approval-code"
          data-pt-approval-code={current.comparisonCode}
        >
          {current.comparisonCode}
        </output>
      </section>
      {errorKey ? (
        <Text type="danger" role="alert">
          {t(errorKey)}
        </Text>
      ) : null}
      <div className="mobile-login-approval-actions">
        <Button
          disabled={busy}
          onClick={() => onDeny(current.approvalId, current.revision)}
        >
          {t('mobile.loginApproval.dialog.deny')}
        </Button>
        <Button
          type="primary"
          loading={busy}
          onClick={() => onAllow(current.approvalId, current.revision)}
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
    <Modal
      open={!!current}
      className="mobile-login-approval-dialog"
      title={t('mobile.loginApproval.dialog.title')}
      onCancel={onDismiss}
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
    </Modal>
  );
}
