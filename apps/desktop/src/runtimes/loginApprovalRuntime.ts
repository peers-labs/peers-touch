import {
  loginApprovalApproverCommands,
  loginApprovalClaimantCommands,
  LOGIN_APPROVAL_STATE,
  type CreateLoginApprovalInput,
} from '../services/loginApproval';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { isTerminal, useLoginApprovalStore } from '../store/loginApproval';
import { useSessionStore } from '../store/session';

// Bounded budgets from DLA-D08: claimant polls at least every 2s, the
// authenticated approver view at least every 5s. Background tabs never poll.
const CLAIMANT_INTERVAL_MS = 2_000;
const APPROVER_INTERVAL_MS = 5_000;

let claimantTimer: ReturnType<typeof setTimeout> | undefined;
let approverTimer: ReturnType<typeof setTimeout> | undefined;
let claimantGeneration = 0;
let approverGeneration = 0;
let claimantFlight: Promise<void> | null = null;
let approverFlight: Promise<void> | null = null;
let unsubscribe: (() => void) | undefined;

const store = () => useLoginApprovalStore.getState();

function stopClaimant() { if (claimantTimer) clearTimeout(claimantTimer); claimantTimer = undefined; }
function stopApprover() { if (approverTimer) clearTimeout(approverTimer); approverTimer = undefined; }

function scheduleClaimant() {
  stopClaimant();
  const current = store().claimant;
  if (!current || isTerminal(current.state) || document.hidden) return;
  claimantTimer = setTimeout(() => { void pollClaimant(); }, CLAIMANT_INTERVAL_MS);
}

function scheduleApprover() {
  stopApprover();
  if (document.hidden) return;
  approverTimer = setTimeout(() => { void pollApprover(); }, APPROVER_INTERVAL_MS);
}

async function pollClaimant() {
  if (claimantFlight || document.hidden) { scheduleClaimant(); return; }
  const generation = claimantGeneration;
  const current = store().claimant;
  if (!current || isTerminal(current.state)) return;
  const job = loginApprovalClaimantCommands.status(current.revision)
    .then((projection) => {
      if (generation === claimantGeneration) store().setClaimant(projection);
    })
    .catch((error: unknown) => {
      if (generation === claimantGeneration) {
        store().setClaimantError(error instanceof Error ? error.message : 'loginApproval.pollFailed');
      }
    })
    .finally(() => {
      if (claimantFlight === job) claimantFlight = null;
      scheduleClaimant();
    });
  claimantFlight = job;
  await job;
}

async function pollApprover() {
  if (approverFlight || document.hidden) { scheduleApprover(); return; }
  const generation = approverGeneration;
  const revision = store().pending[0]?.revision ?? 0;
  const job = loginApprovalApproverCommands.listPending(revision)
    .then(({ approvals }) => {
      if (generation === approverGeneration) store().setPending(approvals);
    })
    .catch((error: unknown) => {
      if (generation === approverGeneration) {
        store().setApproverError(error instanceof Error ? error.message : 'loginApproval.pollFailed');
      }
    })
    .finally(() => {
      if (approverFlight === job) approverFlight = null;
      scheduleApprover();
    });
  approverFlight = job;
  await job;
}

// Claimant actions used by the login waiting card.
async function requestApproval(input: CreateLoginApprovalInput): Promise<void> {
  const generation = ++claimantGeneration;
  const sessionEpoch = useSessionStore.getState().sessionEpoch;
  stopClaimant();
  store().setClaimantBusy(true);
  try {
    const projection = await loginApprovalClaimantCommands.create(input);
    if (generation === claimantGeneration &&
      useSessionStore.getState().sessionEpoch === sessionEpoch) {
      store().setClaimant(projection);
      scheduleClaimant();
    }
  } catch (error) {
    if (generation === claimantGeneration) {
      store().setClaimantError(error instanceof Error ? error.message : 'loginApproval.createFailed');
    }
  } finally {
    if (generation === claimantGeneration) store().setClaimantBusy(false);
  }
}

async function cancelClaimant(): Promise<void> {
  const current = store().claimant;
  if (!current) return;
  const generation = ++claimantGeneration;
  stopClaimant();
  try {
    const projection = await loginApprovalClaimantCommands.cancel(current.revision);
    if (generation === claimantGeneration) store().setClaimant(projection);
  } catch (error) {
    if (generation === claimantGeneration) {
      store().setClaimantError(error instanceof Error ? error.message : 'loginApproval.cancelFailed');
    }
  }
}

function clearClaimant() {
  claimantGeneration += 1;
  stopClaimant();
  store().setClaimant(null);
}

// Approver actions used by the Shell global dialog.
async function decide(approvalId: string, observedRevision: number, allow: boolean): Promise<void> {
  if (store().approverBusy) return;
  const generation = approverGeneration;
  store().setApproverBusy(true);
  try {
    const command = allow
      ? loginApprovalApproverCommands.approve
      : loginApprovalApproverCommands.deny;
    await command(approvalId, observedRevision);
    if (generation === approverGeneration) {
      store().setPending(store().pending.filter((item) => item.approvalId !== approvalId));
    }
  } catch (error) {
    if (generation === approverGeneration) {
      store().setApproverError(error instanceof Error ? error.message : 'loginApproval.decideFailed');
    }
  } finally {
    if (generation === approverGeneration) store().setApproverBusy(false);
  }
}

function onForeground() {
  if (!document.hidden) {
    void pollClaimant();
    void pollApprover();
  }
}

export const loginApprovalActions = {
  requestApproval,
  cancelClaimant,
  clearClaimant,
  approve: (approvalId: string, revision: number) => decide(approvalId, revision, true),
  deny: (approvalId: string, revision: number) => decide(approvalId, revision, false),
  refreshApprover: pollApprover,
};

export const loginApprovalRuntime: RuntimeDescriptor = {
  id: 'login-approval',
  scope: 'app',
  install() {
    if (unsubscribe) return;
    let previous = useSessionStore.getState().sessionEpoch;
    unsubscribe = useSessionStore.subscribe((session) => {
      if (session.sessionEpoch !== previous) {
        previous = session.sessionEpoch;
        clearClaimant();
      }
    });
    document.addEventListener('visibilitychange', onForeground);
  },
  teardown() {
    unsubscribe?.();
    unsubscribe = undefined;
    document.removeEventListener('visibilitychange', onForeground);
    stopClaimant();
    stopApprover();
    store().reset();
  },
  async bootstrap() {},
  async reconcile() {
    await pollApprover();
  },
};

export const __testing = {
  LOGIN_APPROVAL_STATE,
  resetTimers: () => { stopClaimant(); stopApprover(); },
};
