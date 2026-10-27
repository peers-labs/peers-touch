import { deviceLinkCommands, type DeviceLinkClaim, type DeviceLinkProjection } from '../services/deviceLink';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { useDeviceLinkStore } from '../store/deviceLink';
import { useSessionStore } from '../store/session';

let epoch = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;
let operation: Promise<void> | null = null;
let cancellation: Promise<void> | null = null;
const state = () => useDeviceLinkStore.getState();
const set = useDeviceLinkStore.setState;

function stopTimer() { if (timer) clearTimeout(timer); timer = undefined; }
function publish(projection: DeviceLinkProjection) {
  const selected = state().selectedClaimId;
  set({ projection, error: false, selectedClaimId:
    projection.claims.some((claim) => claim.id === selected) ? selected : projection.claims[0]?.id ?? null });
}
function schedule() {
  stopTimer();
  if (!state().open || (state().projection?.state ?? 8) >= 8) return;
  timer = setTimeout(() => { void refresh(); }, 2_000);
}
async function refresh() {
  if (operation || !state().open || document.hidden) { schedule(); return; }
  const generation = epoch;
  const job = deviceLinkCommands.status().then((projection) => {
    if (generation === epoch && state().open) publish(projection);
  }).catch(() => {
    if (generation === epoch) set({ error: true });
  }).finally(() => { if (operation === job) operation = null; schedule(); });
  operation = job;
  await job;
}
async function start() {
  if (state().busy) return;
  const generation = ++epoch;
  const sessionEpoch = useSessionStore.getState().sessionEpoch;
  const replace = !!state().projection;
  const previous = operation;
  const previousCancellation = cancellation;
  stopTimer();
  set({ open: true, busy: true, error: false, projection: null, selectedClaimId: null });
  // Native Create serializes cancellation before new allocation. In-flight
  // projection reads settle before another command can replace this scope.
  const job = (async () => {
    try {
      await previous;
      await previousCancellation;
      if (generation !== epoch || !state().open || useSessionStore.getState().sessionEpoch !== sessionEpoch) return;
      if (replace) {
        await deviceLinkCommands.cancel();
        if (generation !== epoch || !state().open || useSessionStore.getState().sessionEpoch !== sessionEpoch) return;
      }
      const projection = await deviceLinkCommands.create();
      if (generation === epoch && state().open) publish(projection);
    } catch { if (generation === epoch) set({ error: true }); }
    finally { if (generation === epoch) set({ busy: false }); }
  })();
  operation = job;
  await job;
  if (operation === job) operation = null;
  schedule();
}
async function close() {
  const generation = ++epoch;
  stopTimer();
  set({ open: false, busy: false, projection: null, selectedClaimId: null, error: false });
  // Native cancellation also invalidates an in-flight create immediately.
  const job = deviceLinkCommands.cancel().then(() => undefined).catch(() => {
    if (generation === epoch) set({ error: true });
  }).finally(() => { if (cancellation === job) cancellation = null; });
  cancellation = job;
  await job;
}
async function decide(claim: DeviceLinkClaim, allow: boolean) {
  if (operation || state().busy || !state().projection) return;
  const generation = epoch;
  const revision = state().projection!.revision;
  set({ busy: true, error: false });
  const job = deviceLinkCommands.decide(claim, revision, allow).then((projection) => {
    if (generation === epoch && state().open) publish(projection);
  }).catch(() => { if (generation === epoch) set({ error: true }); })
    .finally(() => { if (generation === epoch) set({ busy: false }); if (operation === job) operation = null; schedule(); });
  operation = job;
  await job;
}
function foreground() { if (!document.hidden) void refresh(); }

export const deviceLinkActions = { start, close, decide, retry: refresh,
  select: (id: string) => set({ selectedClaimId: id }) };
export const deviceLinkRuntime: RuntimeDescriptor = {
  id: 'device-link', scope: 'app',
  install() {
    if (unsubscribe) return;
    let previous = useSessionStore.getState().sessionEpoch;
    unsubscribe = useSessionStore.subscribe((session) => {
      if (session.sessionEpoch !== previous) { previous = session.sessionEpoch; void close(); }
    });
    document.addEventListener('visibilitychange', foreground);
  },
  teardown() {
    unsubscribe?.(); unsubscribe = undefined;
    document.removeEventListener('visibilitychange', foreground);
    void close();
  },
  async bootstrap() {},
  async reconcile() { await refresh(); },
};
