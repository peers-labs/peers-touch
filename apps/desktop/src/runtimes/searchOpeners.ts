import type { ResolvedResource } from '../gen/proto/domain/search/search_pb';
import type { Navigation } from '../types/navigation';
import { openMessagingResource } from '../messaging/openResource';
import { openDeviceSocialResource, openStationSocialResource } from '../services/socialOpenResource';

type Opener = (resolved: ResolvedResource, navigation: Navigation, current: () => boolean) => Promise<void>;

// Composition owns these bindings. Result rows never choose a domain action.
const openers: ReadonlyMap<string, Opener> = new Map([
  ['messaging.device.open', async (resolved, navigation, current) => {
    if (!resolved.resource) throw new Error('search.error.resourceUnavailable');
    await openMessagingResource(resolved.resource, () => navigation.navigateTo('chat'), current);
  }],
  ['social.device.open', async (resolved, navigation, current) => {
    if (!resolved.resource) throw new Error('search.error.resourceUnavailable');
    await openDeviceSocialResource(resolved.resource, navigation, current);
  }],
  ['social.station.public.open', async (resolved, navigation, current) => {
    if (!resolved.resource) throw new Error('search.error.resourceUnavailable');
    await openStationSocialResource(resolved.resource, navigation, current);
  }],
]);

export async function openSearchResource(
  resolved: ResolvedResource, navigation: Navigation, current: () => boolean,
): Promise<void> {
  const opener = openers.get(resolved.resolverBinding);
  if (!opener || !resolved.resource || !current()) throw new Error('search.error.resourceUnavailable');
  await opener(resolved, navigation, current);
}
