import type { MobileDetailRoute } from '../../app/navigation';
import type { ResolvedResource, ResourceRef } from '../../gen/proto/domain/search/search_pb';
import { messagingSearchDetailRoute } from '../chat/openSearchResource';
import { socialSearchDetailRoute } from '../social/openSearchResource';

const openers: ReadonlyMap<string, (resource: ResourceRef) => MobileDetailRoute> = new Map([
  ['messaging.device.open', messagingSearchDetailRoute],
  ['social.device.open', (resource) => socialSearchDetailRoute(resource, 'device')],
  ['social.station.public.open', (resource) => socialSearchDetailRoute(resource, 'station')],
]);

export function resolvedSearchDetailRoute(resolved: ResolvedResource): MobileDetailRoute {
  const opener = openers.get(resolved.resolverBinding);
  if (!opener || !resolved.resource) throw { code: 'SEARCH_RESOURCE_UNAVAILABLE' };
  return opener(resolved.resource);
}
