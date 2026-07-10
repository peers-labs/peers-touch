import type { AtelierProjectionSnapshot } from '../domain/projection';

export interface AtelierProjectionSubscriptionKey {
  hasSnapshot: boolean;
  taskId: string;
  afterEventSeq: number;
}

export function deriveAtelierProjectionSubscriptionKey(
  snapshot: AtelierProjectionSnapshot | null,
  selectedTaskId: string,
): AtelierProjectionSubscriptionKey {
  const taskId = selectedTaskId || snapshot?.selectedTaskId || snapshot?.workspace.tasks[0]?.id || '';
  const afterEventSeq = snapshot?.workspace.replay?.[taskId]?.nextEventSeq ?? 0;

  return {
    hasSnapshot: Boolean(snapshot),
    taskId,
    afterEventSeq,
  };
}
