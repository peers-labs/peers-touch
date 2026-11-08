import type { BlockedActorProjection } from '../gen/proto/domain/social/relationship_pb';
import { socialListBlockedActors } from './social_api';

/** Relationship authority supplies the full blocked set; no first-page inference. */
export async function loadAllSocialBlockedActors(assertScope: () => void): Promise<BlockedActorProjection[]> {
  const items = new Map<string, BlockedActorProjection>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('SOCIAL_RELATIONSHIP_READ_TIMEOUT')), 20_000);
  });
  try {
    for (let page = 0; page < 100; page += 1) {
      assertScope();
      const response = await Promise.race([socialListBlockedActors(cursor, 100), timeout]);
      assertScope();
      if (response.items.length > 100) throw new Error('SOCIAL_RELATIONSHIP_PAGE_INVALID');
      for (const item of response.items) {
        const id = item.actor?.ptid;
        if (!id?.startsWith('ptid:') || id !== id.trim() || item.revision < 0n) {
          throw new Error('SOCIAL_RELATIONSHIP_PROJECTION_INVALID');
        }
        items.set(id, item);
      }
      if (!response.nextCursor) return [...items.values()];
      if (!response.items.length || cursors.has(response.nextCursor)) {
        throw new Error('SOCIAL_RELATIONSHIP_CURSOR_INVALID');
      }
      cursors.add(response.nextCursor);
      cursor = response.nextCursor;
    }
    throw new Error('SOCIAL_RELATIONSHIP_READ_LIMIT_EXCEEDED');
  } finally { clearTimeout(timer); }
}
