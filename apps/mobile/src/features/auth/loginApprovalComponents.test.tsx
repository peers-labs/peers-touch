import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { LoginApprovalDialogContent } from './LoginApprovalDialog';
import { LoginApprovalWaitingCard } from './LoginApprovalWaitingCard';
import { LoginApprovalState, type LoginApprovalProjection } from '../../services/loginApproval';

const t = vi.fn((key: string) => key);

const projection = (state: LoginApprovalProjection['state']): LoginApprovalProjection => ({
  approvalId: 'a1',
  state,
  revision: 1,
  expiresAtUnixMs: Date.now() + 600_000,
  comparisonCode: '246810',
  reason: 0,
});

const pending = {
  approvalId: 'a1',
  claimantDeviceId: 'phone-new',
  platform: 'ios' as const,
  deviceLabel: 'Alice iPhone',
  comparisonCode: '246810',
  expiresAtUnixMs: Date.now() + 600_000,
  revision: 1,
};

describe('LoginApprovalWaitingCard', () => {
  it('renders the comparison code and waiting copy for a pending transaction', () => {
    const onCancel = vi.fn();
    const markup = renderToStaticMarkup(
      <LoginApprovalWaitingCard
        projection={projection(LoginApprovalState.PENDING)}
        busy={false}
        errorKey={null}
        t={t}
        onCancel={onCancel}
      />,
    );
    expect(markup).toContain('246810');
    expect(markup).toContain('mobile.loginApproval.waiting.title');
    expect(markup).toContain('data-pt-approval-state="1"');
    // The folded recovery entry exists but its body is not rendered by default.
    expect(markup).toContain('mobile.loginApproval.fallback');
    expect(markup).not.toContain('mobile-login-approval-fallback"');
  });

  it('surfaces the typed terminal reason instead of a generic failure', () => {
    const markup = renderToStaticMarkup(
      <LoginApprovalWaitingCard
        projection={projection(LoginApprovalState.DENIED)}
        busy={false}
        errorKey={null}
        t={t}
        onCancel={vi.fn()}
      />,
    );
    expect(markup).toContain('mobile.loginApproval.denied');
  });
});

describe('LoginApprovalDialogContent', () => {
  it('exposes the claimant device and comparison code to the approver', () => {
    const markup = renderToStaticMarkup(
      <LoginApprovalDialogContent
        current={pending}
        busy={false}
        errorKey={null}
        t={t}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(markup).toContain('Alice iPhone');
    expect(markup).toContain('246810');
    expect(markup).toContain('mobile.loginApproval.dialog.allow');
    expect(markup).toContain('mobile.loginApproval.dialog.deny');
  });

  it('renders a typed error without dropping the decision controls', () => {
    const markup = renderToStaticMarkup(
      <LoginApprovalDialogContent
        current={pending}
        busy={false}
        errorKey="mobile.loginApproval.decideFailed"
        t={t}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(markup).toContain('mobile.loginApproval.decideFailed');
    expect(markup).toContain('role="alert"');
  });
});
