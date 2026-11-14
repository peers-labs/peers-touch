import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LoginApprovalDialogContent,
  LoginApprovalDialogHost,
} from './LoginApprovalDialogHost';
import { useLoginApprovalStore } from '../../store/loginApproval';
import type { PendingLoginApproval } from '../../services/loginApproval';

const t = (key: string) => ({
  'auth.loginApproval.dialog.title': 'Approve sign-in',
  'auth.loginApproval.dialog.subtitle': 'A device is requesting access',
  'auth.loginApproval.dialog.deny': 'Deny',
  'auth.loginApproval.dialog.allow': 'Approve',
  'auth.loginApproval.waiting.comparison': 'Comparison code',
})[key] ?? key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

vi.mock('@peers-touch/ui', () => ({
  Dialog: ({ title, children }: { title?: string; children?: ReactNode }) => (
    <div role="dialog" aria-label={title}>
      <span>{title}</span>
      {children}
    </div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, actionId }: { children?: ReactNode; actionId?: string }) => (
    <button data-action-id={actionId}>{children}</button>
  ),
}));

vi.mock('../../runtimes/loginApprovalRuntime', () => ({
  loginApprovalActions: { approve: vi.fn(), deny: vi.fn() },
}));

function pendingApproval(overrides: Partial<PendingLoginApproval> = {}): PendingLoginApproval {
  return {
    approvalId: 'approval-1',
    claimantDeviceId: 'claimant-device',
    platform: 'desktop',
    deviceLabel: 'Alice MacBook',
    comparisonCode: '42-77-19',
    expiresAtUnixMs: Date.now() + 60_000,
    revision: 3,
    ...overrides,
  };
}

describe('LoginApprovalDialogHost', () => {
  afterEach(() => {
    useLoginApprovalStore.getState().reset();
  });

  it('renders nothing when no approval is pending', () => {
    useLoginApprovalStore.getState().setPending([]);
    expect(renderToStaticMarkup(<LoginApprovalDialogHost />)).toBe('');
  });
});

describe('LoginApprovalDialogContent', () => {
  it('projects the pending device and comparison code into the Shell dialog', () => {
    const markup = renderToStaticMarkup(
      <LoginApprovalDialogContent
        current={pendingApproval()}
        busy={false}
        error={null}
        t={t}
        onApprove={() => undefined}
        onDeny={() => undefined}
      />,
    );

    expect(markup).toContain('Approve sign-in');
    expect(markup).toContain('Alice MacBook');
    expect(markup).toContain('desktop');
    expect(markup).toContain('42-77-19');
    expect(markup).toContain('data-action-id="login-approval-deny"');
    expect(markup).toContain('data-action-id="login-approval-allow"');
  });

  it('falls back to the raw device id when no friendly label exists', () => {
    const markup = renderToStaticMarkup(
      <LoginApprovalDialogContent
        current={pendingApproval({ deviceLabel: '', claimantDeviceId: 'raw-device-id' })}
        busy={false}
        error={null}
        t={t}
        onApprove={() => undefined}
        onDeny={() => undefined}
      />,
    );

    expect(markup).toContain('raw-device-id');
  });

  it('surfaces an approver error without dropping the dialog', () => {
    const markup = renderToStaticMarkup(
      <LoginApprovalDialogContent
        current={pendingApproval()}
        busy={false}
        error="auth.loginApproval.decideFailed"
        t={t}
        onApprove={() => undefined}
        onDeny={() => undefined}
      />,
    );

    expect(markup).toContain('auth.loginApproval.decideFailed');
    expect(markup).toContain('42-77-19');
  });
});
