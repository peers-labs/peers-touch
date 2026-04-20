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
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];
export const EVENT_NAMES: EventType[] = Object.values(EVENT);
