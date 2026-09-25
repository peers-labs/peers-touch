export type SenderTypingFeedbackPhase = 'idle' | 'waiting' | 'retrying' | 'failed';

export interface SenderTypingRequest {
  readonly attempt: number;
  readonly conversationId: string;
  readonly typing: boolean;
}

export type SenderTypingFeedback =
  | {
      readonly phase: 'idle';
      readonly request: null;
    }
  | {
      readonly phase: 'waiting' | 'retrying';
      readonly request: SenderTypingRequest;
    }
  | {
      readonly phase: 'failed';
      readonly request: SenderTypingRequest;
      readonly error: unknown;
    };

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

export const IDLE_SENDER_TYPING_FEEDBACK: SenderTypingFeedback = {
  phase: 'idle',
  request: null,
};

export function beginSenderTypingFeedback(
  request: SenderTypingRequest,
  retry: boolean,
): SenderTypingFeedback {
  return {
    phase: retry ? 'retrying' : 'waiting',
    request,
  };
}

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

export function settleSenderTypingFeedback(
  current: SenderTypingFeedback,
  result: SenderTypingResult,
): SenderTypingFeedback {
  if (
    current.phase === 'idle'
    || current.request.attempt !== result.request.attempt
    || current.request.conversationId !== result.request.conversationId
  ) {
    return current;
  }

  if (result.ok === true) return IDLE_SENDER_TYPING_FEEDBACK;

  return {
    phase: 'failed',
    request: result.request,
    error: result.error,
  };
}
