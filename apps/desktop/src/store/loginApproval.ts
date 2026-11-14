import { createDesktopStore } from './createDesktopStore';
import {
  LOGIN_APPROVAL_STATE,
  type LoginApprovalProjection,
  type PendingLoginApproval,
} from '../services/loginApproval';

export { LOGIN_APPROVAL_STATE };

interface LoginApprovalView {
  // Claimant projection shown on the login waiting card.
  claimant: LoginApprovalProjection | null;
  claimantBusy: boolean;
  claimantError: string | null;
  // Approver projection shown in the Shell global dialog.
  pending: PendingLoginApproval[];
  approverBusy: boolean;
  approverError: string | null;
}

const initialState: LoginApprovalView = {
  claimant: null,
  claimantBusy: false,
  claimantError: null,
  pending: [],
  approverBusy: false,
  approverError: null,
};

export const isTerminal = (state: number): boolean =>
  state >= LOGIN_APPROVAL_STATE.COMMITTED;

// The login card hands control to the waiting surface only while the claimant
// transaction is still unresolved. A terminal projection returns the user to
// the credential form instead of stranding them on a dead card.
export function isClaimantWaitingStage(
  claimant: LoginApprovalProjection | null,
): claimant is LoginApprovalProjection {
  return !!claimant && !isTerminal(claimant.state);
}

export const useLoginApprovalStore = createDesktopStore<LoginApprovalView & {
  reset(): void;
  setClaimant(projection: LoginApprovalProjection | null): void;
  setClaimantBusy(busy: boolean): void;
  setClaimantError(error: string | null): void;
  setPending(pending: PendingLoginApproval[]): void;
  setApproverBusy(busy: boolean): void;
  setApproverError(error: string | null): void;
}>('login-approval', (set) => ({
  ...initialState,
  reset: () => set({ ...initialState }),
  setClaimant: (claimant) => set({ claimant, claimantError: null }),
  setClaimantBusy: (claimantBusy) => set({ claimantBusy }),
  setClaimantError: (claimantError) => set({ claimantError }),
  setPending: (pending) => set({ pending, approverError: null }),
  setApproverBusy: (approverBusy) => set({ approverBusy }),
  setApproverError: (approverError) => set({ approverError }),
}));
