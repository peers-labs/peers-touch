/**
 * Gateway barrel — re-exports all domain API gateways and shared types.
 *
 * Import from this module to access any domain gateway factory without
 * knowing the internal file layout.
 */

export { createGatewayTransport, unwrapOutcome } from './gatewayTypes';
export type {
  CommandOutcome,
  CommandWithReadback,
  GatewayError,
  GatewayRequestOptions,
  HttpMethod,
  ReadbackAdapter,
} from './gatewayTypes';

export { createSocialGateway } from './socialGateway';
export type { SocialGateway, SocialFriendRequestsResult } from './socialGateway';

export { createMomentsGateway } from './momentsGateway';
export type { MomentsGateway, MomentCreatedResult } from './momentsGateway';

export { createNotificationGateway } from './notificationGateway';
export type { NotificationGateway, NotificationListResult } from './notificationGateway';

export { createProfileGateway } from './profileGateway';
export type {
  ProfileGateway,
  ActorSearchResultList,
  FederationResolveResult,
  EditableProfileInput,
  ProfileUpdateResult,
} from './profileGateway';
