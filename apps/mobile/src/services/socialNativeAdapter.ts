import type { MobileAuthSession } from '../features/auth/authSession';
import {
  executeNativeStationOperation,
  type StationTransportOperation,
  type StationTransportResponse,
} from './stationTransport';

type SocialOperationId =
  | 'social_circles_list'
  | 'social_circle_create'
  | 'social_circle_update'
  | 'social_circle_delete'
  | 'social_circle_members_list'
  | 'social_circle_members_add'
  | 'social_circle_members_remove'
  | 'moments_timeline'
  | 'moments_post_get'
  | 'moments_delete'
  | 'moments_react'
  | 'moments_unreact'
  | 'moments_comments_list'
  | 'moments_comment_create'
  | 'moments_comment_delete'
  | 'moments_create';

export type SocialNativeOperation = Extract<
  StationTransportOperation,
  { operationId: SocialOperationId }
>;

export function executeSocialNativeOperation(
  session: MobileAuthSession,
  operation: SocialNativeOperation,
  signal?: AbortSignal,
): Promise<StationTransportResponse> {
  return executeNativeStationOperation(
    'social_adapter_execute',
    session,
    operation,
    signal,
  );
}
