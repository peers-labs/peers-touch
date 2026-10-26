import type { MobileDetailRoute } from '../../app/navigation';
import type { ResourceRef } from '../../gen/proto/domain/search/search_pb';

export function socialSearchDetailRoute(resource: ResourceRef, readSource: 'device' | 'station'): MobileDetailRoute {
  if (resource.kind === 'social-post' && resource.id && !resource.parent) {
    return { routeId: 'detail:moment', postId: resource.id, readSource };
  }
  const parent = resource.parent;
  if (resource.kind !== 'social-comment' || !resource.id || parent?.kind !== 'social-post'
    || !parent.id || parent.authorityNamespace !== resource.authorityNamespace
    || resource.anchor?.kind !== 'comment' || resource.anchor.id !== resource.id) {
    throw { code: 'SEARCH_RESOURCE_UNAVAILABLE' };
  }
  return { routeId: 'detail:moment', postId: parent.id, commentId: resource.id, readSource };
}
