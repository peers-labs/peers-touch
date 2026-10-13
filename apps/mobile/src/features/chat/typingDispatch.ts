export interface SenderTypingRequest {
  readonly conversationId: string;
  readonly typing: boolean;
}

export async function dispatchSenderTypingRequest(
  request: SenderTypingRequest,
  dispatch: (conversationId: string, typing: boolean) => Promise<void>,
): Promise<void> {
  try {
    await dispatch(request.conversationId, request.typing);
  } catch {
    // Typing is best-effort presence. Durable messaging remains usable.
  }
}
