export const EVENT = {
  AUTH_IDENTITY_CHANGED: 'auth.identity_changed',
  AUTH_SESSION_REVOKED: 'auth.session_revoked',
  OAUTH_CONNECTIONS_CHANGED: 'oauth.connections_changed',
  NAVIGATION_REQUESTED: 'navigation.requested',
  AGENT_BUILDER_STREAM_ENDED: 'agent.builder.stream_ended',
  GLOBAL_CONTEXT_UPDATED: 'global_context.updated',
  GLOBAL_CONTEXT_PIPELINE_STARTED: 'global_context.pipeline_started',
  GLOBAL_CONTEXT_PIPELINE_FINISHED: 'global_context.pipeline_finished',
  GLOBAL_CONTEXT_PIPELINE_FAILED: 'global_context.pipeline_failed',
  REALTIME_MESSAGE_RECEIVED: 'realtime.message_received',
  REALTIME_PRESENCE_FLIP: 'realtime.presence_flip',
  REALTIME_RESYNC: 'realtime.resync',
  REALTIME_CONNECTION_STATE: 'realtime.connection_state',
  REALTIME_CALL_SIGNAL: 'realtime.call_signal',
  REALTIME_MESSAGE_RECEIPT: 'realtime.message_receipt',
  REALTIME_TYPING_STATE: 'realtime.typing_state',
  REALTIME_MESSAGE_MUTATION: 'realtime.message_mutation',
  // Fired by handleInboundSkdm after a peer's Sender Keys
  // distribution message has been successfully consumed and
  // persisted. Subscribers (socialChat) use this to re-attempt
  // decryption of any group ciphertext that previously failed
  // with MissingSkdmError for the same (groupUlid, senderDid,
  // senderKeyId) tuple.
  GROUP_SKDM_INSTALLED: 'crypto.group_skdm_installed',
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];
export const EVENT_NAMES: EventType[] = Object.values(EVENT);
