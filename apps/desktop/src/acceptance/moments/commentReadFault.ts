/** One bounded pause after a real public Comment response has been verified. */
type ReadState = 'armed' | 'held' | 'released' | 'expired' | 'cancelled';

interface ReadFault {
  postId: string;
  state: ReadState;
  effectCount: number;
  assertScope: () => void;
  timer: ReturnType<typeof setTimeout>;
  release?: () => void;
  reject?: (error: Error) => void;
}

const READ_DEADLINE_MS = 30_000;
let active: ReadFault | undefined;

export function armCommentRead(postId: string, assertScope: () => void): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1' || !postId.trim()) {
    throw new Error('moments.acceptance.commentReadFaultUnavailable');
  }
  if (active) throw new Error('moments.acceptance.commentReadFaultAlreadyActive');
  assertScope();
  const fault: ReadFault = {
    postId, state: 'armed', effectCount: 0, assertScope,
    timer: setTimeout(() => {
      fault.state = 'expired';
      fault.reject?.(new Error('moments.acceptance.commentReadFaultTimeout'));
    }, READ_DEADLINE_MS),
  };
  active = fault;
}

/** Payload, Native verification and Store publication remain with their owners. */
export async function holdVerifiedCommentRead(postId: string): Promise<void> {
  const fault = active;
  if (!fault || fault.state !== 'armed' || fault.postId !== postId) return;
  fault.assertScope();
  fault.state = 'held';
  fault.effectCount += 1;
  await new Promise<void>((resolve, reject) => {
    fault.release = resolve;
    fault.reject = reject;
  });
  fault.assertScope();
}

export function commentReadFaultStatus() {
  active?.assertScope();
  return active
    ? { state: active.state, effectCount: active.effectCount }
    : { state: 'idle', effectCount: 0 };
}

export function releaseCommentRead(): void {
  const fault = active;
  if (!fault || fault.state !== 'held') {
    throw new Error('moments.acceptance.commentReadFaultNotHeld');
  }
  fault.assertScope();
  clearTimeout(fault.timer);
  fault.state = 'released';
  fault.release?.();
}

export function clearCommentRead(): void {
  const fault = active;
  active = undefined;
  if (!fault) return;
  clearTimeout(fault.timer);
  fault.state = 'cancelled';
  fault.reject?.(new Error('moments.acceptance.commentReadFaultCancelled'));
}
