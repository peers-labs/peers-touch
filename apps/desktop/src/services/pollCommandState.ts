export type PollCommandState = 'pending' | 'unknown' | 'admission' | 'readback' | 'rejected' | 'committed';
export interface PollCommand {
  operationId: string;
  options: readonly number[];
  state: PollCommandState;
  error?: string;
}

export function pollFailureState(error: unknown): PollCommandState {
  const code = String(error);
  if (/FEED_POLL_ADMISSION_UNVERIFIED/.test(code)) return 'readback';
  if (/FEED_POLL_ADMISSION_PENDING/.test(code)) return 'admission';
  if (/FEED_POLL_(CLOSED|INVALID_SELECTION|DEFINITION_CHANGED|TARGET_UNAVAILABLE|NOT_POLL)/
    .test(code)) return 'rejected';
  if (/FEED_(WRITER_NOT_AUTHORIZED|DEVICE_REQUIRED|INVALID|PROJECTION_TAMPERED)/.test(code)) return 'rejected';
  return 'unknown';
}

export function pollErrorKey(error?: string): string {
  if (/FEED_POLL_CLOSED/.test(error ?? '')) return 'moments.poll.closedError';
  if (/FEED_POLL_INVALID_SELECTION/.test(error ?? '')) return 'moments.poll.selectionError';
  if (/FEED_POLL_DEFINITION_CHANGED/.test(error ?? '')) return 'moments.poll.definitionChanged';
  if (/FEED_POLL_(TARGET_UNAVAILABLE|NOT_POLL)/.test(error ?? '')) return 'moments.poll.unavailable';
  if (/FEED_(WRITER_NOT_AUTHORIZED|DEVICE_REQUIRED)/.test(error ?? '')) return 'moments.publicFeed.writerRequired';
  return 'moments.poll.retryError';
}
