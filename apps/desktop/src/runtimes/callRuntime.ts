import type { RuntimeDescriptor } from '../kernel/runtime';
import { callP2p } from '../modules/p2p/callP2p';
import { groupCallManager } from '../modules/groupCall';

let activeActorPtid = '';

export const callRuntime: RuntimeDescriptor = {
  id: 'call',
  scope: 'session',
  install(): void {},
  async teardown(): Promise<void> {
    activeActorPtid = '';
    callP2p.closeAll();
    await groupCallManager.leaveGroupCall();
  },
  async bootstrap(actorPtid: string | null): Promise<void> {
    if (!actorPtid) return;
    if (activeActorPtid && activeActorPtid !== actorPtid) {
      callP2p.closeAll();
      await groupCallManager.leaveGroupCall();
    }
    activeActorPtid = actorPtid;
    await callP2p.ensurePeerRegistered(actorPtid);
    await callP2p.reconcileActiveCalls();
  },
  async reconcile(): Promise<void> {
    await callP2p.reconcileActiveCalls();
  },
};
