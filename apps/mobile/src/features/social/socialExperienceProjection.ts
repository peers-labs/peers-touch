import type { MomentsFeedState } from './momentsFeedStore';
import type { MomentsAvailability } from '../../runtimes/momentsProjectionDescriptor';
import type { PrivateMomentsRuntimeSnapshot } from '../../runtimes/privateMomentsRuntime';

export interface MobileSocialScope {
  readonly stationPeerId: string;
  readonly actorPtid: string;
  readonly deviceId: string;
  readonly lifecycleGeneration: string;
}

export interface SocialRuntimeProjection {
  readonly availability: MomentsAvailability;
  readonly privateSocial: PrivateMomentsRuntimeSnapshot | null;
}

export interface SocialExperienceProjection {
  readonly scope: MobileSocialScope;
  readonly revision: number;
  readonly home: MomentsFeedState;
  readonly runtime: SocialRuntimeProjection;
}
