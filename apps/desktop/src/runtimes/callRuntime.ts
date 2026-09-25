import type { RuntimeDescriptor } from '../kernel/runtime';
import { callP2p } from '../modules/p2p/callP2p';

let activeActorPtid = '';

export const callRuntime: RuntimeDescriptor = {
  id: 'call',
  scope: 'session',
  install(): void {},
  teardown(): void {
    activeActorPtid = '';
    callP2p.closeAll();
  },
  async bootstrap(actorPtid: string | null): Promise<void> {
    if (!actorPtid) return;
    if (activeActorPtid && activeActorPtid !== actorPtid) {
      callP2p.closeAll();
    }
    activeActorPtid = actorPtid;
    await callP2p.ensurePeerRegistered(actorPtid);
    await callP2p.reconcileActiveCalls();
  },
  async reconcile(): Promise<void> {
    await callP2p.reconcileActiveCalls();
  },
};
