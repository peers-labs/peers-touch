export interface SenderTypingRequest {
  readonly attempt: number;
  readonly conversationId: string;
  readonly typing: boolean;
}

export type SenderTypingResult =
  | {
      readonly ok: true;
      readonly request: SenderTypingRequest;
    }
  | {
      readonly ok: false;
      readonly request: SenderTypingRequest;
      readonly error: unknown;
    };

/** Ephemeral presence failure is diagnostic only and never changes composer layout. */
export async function dispatchSenderTypingRequest(
  request: SenderTypingRequest,
  dispatch: (conversationId: string, typing: boolean) => Promise<void>,
): Promise<SenderTypingResult> {
  try {
    await dispatch(request.conversationId, request.typing);
    return { ok: true, request };
  } catch (error) {
    return { ok: false, request, error };
  }
}
