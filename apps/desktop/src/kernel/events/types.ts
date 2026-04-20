import type { ParsedDeepLink } from '../../utils/deeplink';
import { EVENT } from './catalog';

export interface EventPayloadMap {
  [EVENT.AUTH_IDENTITY_CHANGED]: void;
  [EVENT.AUTH_SESSION_REVOKED]: void;
  [EVENT.OAUTH_CONNECTIONS_CHANGED]: void;
  [EVENT.NAVIGATION_REQUESTED]: ParsedDeepLink | { resource: 'settings'; id?: string };
  [EVENT.AGENT_BUILDER_STREAM_ENDED]: void;
  [EVENT.GLOBAL_CONTEXT_UPDATED]: { slice: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED]: { name: string; error: string; timestamp_ms: number };
}

export interface AppEvent<TType extends keyof EventPayloadMap> {
  type: TType;
  payload: EventPayloadMap[TType];
}
