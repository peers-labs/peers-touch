export type ConversationClearBatchItemState =
  | 'succeeded'
  | 'failed'
  | 'scope_changed';

export interface ConversationClearBatchItemResult {
  readonly state: ConversationClearBatchItemState;
  readonly releasedBytes?: bigint;
}

export interface ConversationClearBatchProgress {
  readonly completedCount: number;
  readonly totalCount: number;
  readonly conversationId: string;
}

export interface ConversationClearBatchResult {
  readonly status: 'succeeded' | 'partial_failure' | 'scope_changed';
  readonly requestedIds: readonly string[];
  readonly succeededIds: readonly string[];
  readonly failedIds: readonly string[];
  readonly remainingIds: readonly string[];
  readonly completedCount: number;
  readonly releasedBytes: bigint;
}

export interface RunConversationClearBatchInput {
  readonly conversationIds: readonly string[];
  readonly clearConversation: (
    conversationId: string,
  ) => Promise<ConversationClearBatchItemResult>;
  readonly onProgress?: (progress: ConversationClearBatchProgress) => void;
}

export async function runConversationClearBatch({
  conversationIds,
  clearConversation,
  onProgress,
}: RunConversationClearBatchInput): Promise<ConversationClearBatchResult> {
  const requestedIds = [...new Set(
    conversationIds.map((conversationId) => conversationId.trim()).filter(Boolean),
  )];
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  let completedCount = 0;
  let releasedBytes = 0n;

  for (const [index, conversationId] of requestedIds.entries()) {
    let item: ConversationClearBatchItemResult;
    try {
      item = await clearConversation(conversationId);
    } catch {
      item = { state: 'failed' };
    }

    if (item.state === 'scope_changed') {
      return {
        status: 'scope_changed',
        requestedIds,
        succeededIds,
        failedIds,
        remainingIds: requestedIds.slice(index),
        completedCount,
        releasedBytes,
      };
    }

    completedCount += 1;
    if (item.state === 'succeeded') {
      succeededIds.push(conversationId);
      if ((item.releasedBytes ?? 0n) > 0n) {
        releasedBytes += item.releasedBytes ?? 0n;
      }
    } else {
      failedIds.push(conversationId);
    }
    onProgress?.({
      completedCount,
      totalCount: requestedIds.length,
      conversationId,
    });
  }

  return {
    status: failedIds.length === 0 ? 'succeeded' : 'partial_failure',
    requestedIds,
    succeededIds,
    failedIds,
    remainingIds: [],
    completedCount,
    releasedBytes,
  };
}
