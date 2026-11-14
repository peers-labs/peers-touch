import { useMobileI18n } from '../../app/mobileI18n';
import {
  approvePendingLoginApproval,
  cancelClaimantLoginApproval,
  denyPendingLoginApproval,
} from '../../runtimes/loginApprovalRuntime';
import { useLoginApprovalStore } from './loginApprovalStore';
import { LoginApprovalDialog } from './LoginApprovalDialog';
import { LoginApprovalWaitingCard } from './LoginApprovalWaitingCard';
import './loginApproval.css';

/**
 * Binds the login-approval store to the presentational surfaces.
 *
 * It is deliberately not wired into navigation yet: the native Tauri commands
 * it invokes land with the Mobile Rust slice (DLA-05). Mounting a route before
 * that would create a dead screen, so the host stays available for the native
 * integration step rather than shipping an unreachable path.
 */
export function LoginApprovalHost() {
  const { t } = useMobileI18n();
  const claimant = useLoginApprovalStore((state) => state.claimant);
  const claimantBusy = useLoginApprovalStore((state) => state.claimantBusy);
  const claimantErrorKey = useLoginApprovalStore((state) => state.claimantErrorKey);
  const pending = useLoginApprovalStore((state) => state.pending);
  const approverBusy = useLoginApprovalStore((state) => state.approverBusy);
  const approverErrorKey = useLoginApprovalStore((state) => state.approverErrorKey);

  return (
    <>
      {claimant ? (
        <LoginApprovalWaitingCard
          projection={claimant}
          busy={claimantBusy}
          errorKey={claimantErrorKey}
          t={t}
          onCancel={() => void cancelClaimantLoginApproval()}
        />
      ) : null}
      <LoginApprovalDialog
        pending={pending}
        busy={approverBusy}
        errorKey={approverErrorKey}
        t={t}
        onAllow={(approvalId, revision) =>
          void approvePendingLoginApproval(approvalId, revision)
        }
        onDeny={(approvalId, revision) =>
          void denyPendingLoginApproval(approvalId, revision)
        }
        onDismiss={() => undefined}
      />
    </>
  );
}
