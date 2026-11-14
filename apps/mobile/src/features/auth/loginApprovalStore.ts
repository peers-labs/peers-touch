import { create } from 'zustand';
import type {
  LoginApprovalProjection,
  PendingLoginApproval,
} from '../../services/loginApproval';

interface LoginApprovalSnapshot {
  // Claimant projection rendered on the waiting card.
  claimant: LoginApprovalProjection | null;
  claimantBusy: boolean;
  claimantErrorKey: string | null;
  // Approver projection rendered by the global approver surface.
  pending: PendingLoginApproval[];
  approverBusy: boolean;
  approverErrorKey: string | null;
  reset(): void;
  setClaimant(projection: LoginApprovalProjection | null): void;
  setClaimantBusy(busy: boolean): void;
  setClaimantError(key: string | null): void;
  setPending(pending: PendingLoginApproval[]): void;
  setApproverBusy(busy: boolean): void;
  setApproverError(key: string | null): void;
}

export const useLoginApprovalStore = create<LoginApprovalSnapshot>((set) => ({
  claimant: null,
  claimantBusy: false,
  claimantErrorKey: null,
  pending: [],
  approverBusy: false,
  approverErrorKey: null,
  reset: () =>
    set({
      claimant: null,
      claimantBusy: false,
      claimantErrorKey: null,
      pending: [],
      approverBusy: false,
      approverErrorKey: null,
    }),
  setClaimant: (claimant) => set({ claimant, claimantErrorKey: null }),
  setClaimantBusy: (claimantBusy) => set({ claimantBusy }),
  setClaimantError: (claimantErrorKey) => set({ claimantErrorKey }),
  setPending: (pending) => set({ pending, approverErrorKey: null }),
  setApproverBusy: (approverBusy) => set({ approverBusy }),
  setApproverError: (approverErrorKey) => set({ approverErrorKey }),
}));

export const isTerminalLoginApproval = (state: number): boolean =>
  state >= 7; // COMMITTED and all denial/cancellation/expiry states.
