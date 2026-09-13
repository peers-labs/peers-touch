import type { ErrorMapper, PresentedError } from '../errorPresenter';
import { errorMessage, tError } from '../errorPresenter';
import { RustCommandException } from '../desktop_api';

export type ChatErrorOperation =
  | 'send'
  | 'edit'
  | 'delete'
  | 'createGroup'
  | 'conversationAction';

export interface ChatErrorContext {
  operation: ChatErrorOperation;
}

function presentedError(
  code: string,
  key: string,
  recoverable = true,
  debugMessage?: string,
  detail?: string,
): PresentedError {
  const message = tError(key);
  return {
    code,
    title: tError('error.presentation.title'),
    message: detail ? `${message} ${detail}` : message,
    severity: 'error',
    recoverable,
    debugMessage,
  };
}

function operationFallback(operation: ChatErrorOperation): string {
  switch (operation) {
    case 'edit':
      return 'error.chat.editFailed';
    case 'delete':
      return 'error.chat.deleteFailed';
    case 'conversationAction':
      return 'error.chat.conversationActionFailed';
    case 'createGroup':
      return 'error.groupChat.createGroupFailed';
    case 'send':
    default:
      return 'error.chat.sendFailed';
  }
}

export const mapChatError: ErrorMapper<ChatErrorContext> = (error, context) => {
  const message = errorMessage(error);
  const lowerMessage = message.toLowerCase();
  const details = error instanceof RustCommandException
    ? error.details
    : undefined;
  const stationCode = typeof details?.error_code === 'string'
    ? details.error_code
    : '';
  const reason = typeof details?.reason === 'string'
    ? details.reason.trim()
    : '';

  if (
    context?.operation === 'createGroup'
    && stationCode === 'CONVERSATION_ACTOR_KEY_UNAVAILABLE'
  ) {
    return presentedError(
      stationCode,
      'error.chat.groupActorUnavailable',
      true,
      message,
      reason,
    );
  }

  if (
    context?.operation === 'createGroup'
    && stationCode === 'CONVERSATION_FEDERATION_STATION_INACTIVE'
  ) {
    return presentedError(
      stationCode,
      'error.chat.groupFederationInactive',
      true,
      message,
      reason,
    );
  }

  if (
    lowerMessage.includes('open_database failed')
    || lowerMessage.includes('database key verification failed')
    || lowerMessage.includes('corrupted database')
  ) {
    return presentedError('chat.localCryptoStoreUnavailable', 'error.chat.localCryptoStoreUnavailable', false);
  }

  if (
    lowerMessage.includes('no sender chain installed')
    || lowerMessage.includes('missing skdm')
    || lowerMessage.includes('sender-key')
    || lowerMessage.includes('sender key')
  ) {
    return presentedError('chat.senderKeySyncing', 'error.chat.senderKeySyncing');
  }

  if (
    lowerMessage.includes('establishing secure channel')
    || lowerMessage.includes('key bundle')
    || lowerMessage.includes('encryption keys')
  ) {
    return presentedError('chat.secureChannelUnavailable', 'error.chat.secureChannelUnavailable');
  }

  if (lowerMessage.includes('forbidden') || lowerMessage.includes('permission') || lowerMessage.includes('not member')) {
    return presentedError('chat.permissionDenied', 'error.chat.permissionDenied');
  }

  if (lowerMessage.includes('not found')) {
    return presentedError('chat.conversationUnavailable', 'error.chat.conversationUnavailable');
  }

  return presentedError(
    `chat.${context?.operation ?? 'operation'}Failed`,
    operationFallback(context?.operation ?? 'send'),
    true,
    message,
    context?.operation === 'createGroup' ? reason : undefined,
  );
};
