import type {
  MobileRuntimeDescriptor,
  RuntimeTeardownContext,
} from '../app/lifecycle/types';
import {
  isTerminalLoginApproval,
  useLoginApprovalStore,
} from '../features/auth/loginApprovalStore';
import {
  approveLoginApproval,
  cancelLoginApproval,
  createLoginApproval,
  denyLoginApproval,
  listPendingLoginApprovals,
  readLoginApproval,
  LoginApprovalState,
  type CreateLoginApprovalInput,
} from '../services/loginApproval';

// Bounded budgets (DLA-D08): claimant polls at least every 2s, the approver
// view at least every 5s. Backgrounded apps never poll.
const CLAIMANT_INTERVAL_MS = 2_000;
const APPROVER_INTERVAL_MS = 5_000;

let claimantTimer: ReturnType<typeof setTimeout> | null = null;
let approverTimer: ReturnType<typeof setTimeout> | null = null;
let epoch = 0;
let claimantFlight: Promise<void> | null = null;
let approverFlight: Promise<void> | null = null;

const store = () => useLoginApprovalStore.getState();

function stopClaimant(): void {
  if (claimantTimer !== null) clearTimeout(claimantTimer);
  claimantTimer = null;
}
function stopApprover(): void {
  if (approverTimer !== null) clearTimeout(approverTimer);
  approverTimer = null;
}

function scheduleClaimant(): void {
  stopClaimant();
  const current = store().claimant;
  if (!current || isTerminalLoginApproval(current.state) || document.hidden) return;
  claimantTimer = setTimeout(() => {
    void pollClaimant();
  }, CLAIMANT_INTERVAL_MS);
}

function scheduleApprover(): void {
  stopApprover();
  if (document.hidden) return;
  approverTimer = setTimeout(() => {
    void pollApprover();
  }, APPROVER_INTERVAL_MS);
}

async function pollClaimant(): Promise<void> {
  if (claimantFlight || document.hidden) {
    scheduleClaimant();
    return;
  }
  const generation = epoch;
  const current = store().claimant;
  if (!current || isTerminalLoginApproval(current.state)) return;
  const job = readLoginApproval(current.revision)
    .then((projection) => {
      if (generation === epoch) store().setClaimant(projection);
    })
    .catch(() => {
      if (generation === epoch) store().setClaimantError('mobile.loginApproval.pollFailed');
    })
    .finally(() => {
      if (claimantFlight === job) claimantFlight = null;
      scheduleClaimant();
    });
  claimantFlight = job;
  await job;
}

async function pollApprover(): Promise<void> {
  if (approverFlight || document.hidden) {
    scheduleApprover();
    return;
  }
  const generation = epoch;
  const revision = store().pending[0]?.revision ?? 0;
  const job = listPendingLoginApprovals(revision)
    .then(({ approvals }) => {
      if (generation === epoch) store().setPending(approvals);
    })
    .catch(() => {
      if (generation === epoch) store().setApproverError('mobile.loginApproval.pollFailed');
    })
    .finally(() => {
      if (approverFlight === job) approverFlight = null;
      scheduleApprover();
    });
  approverFlight = job;
  await job;
}

export async function requestLoginApproval(input: CreateLoginApprovalInput): Promise<void> {
  const generation = ++epoch;
  stopClaimant();
  store().setClaimantBusy(true);
  try {
    const projection = await createLoginApproval(input);
    if (generation === epoch) {
      store().setClaimant(projection);
      scheduleClaimant();
    }
  } catch {
    if (generation === epoch) store().setClaimantError('mobile.loginApproval.createFailed');
  } finally {
    if (generation === epoch) store().setClaimantBusy(false);
  }
}

export async function cancelClaimantLoginApproval(): Promise<void> {
  const current = store().claimant;
  if (!current) return;
  const generation = ++epoch;
  stopClaimant();
  try {
    const projection = await cancelLoginApproval(current.revision);
    if (generation === epoch) store().setClaimant(projection);
  } catch {
    if (generation === epoch) store().setClaimantError('mobile.loginApproval.cancelFailed');
  }
}

export function clearClaimantLoginApproval(): void {
  epoch += 1;
  stopClaimant();
  store().setClaimant(null);
}

async function decide(approvalId: string, observedRevision: number, allow: boolean): Promise<void> {
  if (store().approverBusy) return;
  const generation = epoch;
  store().setApproverBusy(true);
  try {
    const command = allow ? approveLoginApproval : denyLoginApproval;
    await command(approvalId, observedRevision);
    if (generation === epoch) {
      store().setPending(
        store().pending.filter((item) => item.approvalId !== approvalId),
      );
    }
  } catch {
    if (generation === epoch) store().setApproverError('mobile.loginApproval.decideFailed');
  } finally {
    if (generation === epoch) store().setApproverBusy(false);
  }
}

export const approvePendingLoginApproval = (approvalId: string, revision: number) =>
  decide(approvalId, revision, true);
export const denyPendingLoginApproval = (approvalId: string, revision: number) =>
  decide(approvalId, revision, false);

function onForeground(): void {
  if (document.hidden) return;
  void pollClaimant();
  void pollApprover();
}

export const loginApprovalRuntime: MobileRuntimeDescriptor = {
  id: 'login-approval',
  title: 'Login Approval',
  responsibility:
    'Owns claimant-first device approval waiting state and authenticated approver polling.',
  dependsOn: ['secure-storage'],
  async bootstrap() {
    epoch += 1;
    document.addEventListener('visibilitychange', onForeground);
    await pollApprover();
  },
  async suspend() {
    epoch += 1;
    stopClaimant();
    stopApprover();
  },
  async resume() {
    epoch += 1;
    onForeground();
  },
  async teardown(_context: RuntimeTeardownContext) {
    epoch += 1;
    document.removeEventListener('visibilitychange', onForeground);
    stopClaimant();
    stopApprover();
    store().reset();
    return { runtimeId: 'login-approval', success: true, durationMs: 0 };
  },
};

export const __testing = {
  LoginApprovalState,
  resetTimers: () => {
    stopClaimant();
    stopApprover();
  },
};
