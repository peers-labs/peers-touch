import type { Circle, CircleMember } from '../gen/proto/domain/social/circle_pb';
import { socialCircleListMembers, socialCircleListMine } from './social_api';

const PAGE_SIZE = 20;
const MAX_PAGES = 100;
const READ_BUDGET_MS = 20_000;

interface CirclePage<T> {
  items: T[];
  nextCursor: string;
  hasMore: boolean;
}

/** Publish only a complete traversal, within one scope and one read budget. */
async function collectPages<T>(
  read: (cursor?: string) => Promise<CirclePage<T>>,
  key: (item: T) => string,
  assertScope: () => void,
): Promise<T[]> {
  const deadline = Date.now() + READ_BUDGET_MS;
  const items = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    assertScope();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('CIRCLE_READ_TIMEOUT');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      read(cursor),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('CIRCLE_READ_TIMEOUT')), remaining);
      }),
    ]).finally(() => clearTimeout(timer));
    assertScope();
    if (response.items.length > PAGE_SIZE) throw new Error('CIRCLE_PAGE_INVALID');
    for (const item of response.items) {
      const id = key(item);
      if (!id) throw new Error('CIRCLE_PROJECTION_INVALID');
      items.set(id, item);
    }
    if (!response.hasMore) {
      if (response.nextCursor) throw new Error('CIRCLE_CURSOR_INVALID');
      return [...items.values()];
    }
    if (!response.items.length || !response.nextCursor || cursors.has(response.nextCursor)) {
      throw new Error('CIRCLE_CURSOR_INVALID');
    }
    cursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  throw new Error('CIRCLE_READ_LIMIT_EXCEEDED');
}

export function loadAllSocialCircles(assertScope: () => void): Promise<Circle[]> {
  return collectPages(async cursor => {
    const response = await socialCircleListMine(cursor, PAGE_SIZE);
    return { items: response.circles, nextCursor: response.nextCursor, hasMore: response.hasMore };
  }, circle => circle.id > 0n ? String(circle.id) : '', assertScope);
}

export function loadAllSocialCircleMembers(circleId: string, assertScope: () => void): Promise<CircleMember[]> {
  return collectPages(async cursor => {
    const response = await socialCircleListMembers(circleId, cursor, PAGE_SIZE);
    return { items: response.members, nextCursor: response.nextCursor, hasMore: response.hasMore };
  }, member => String(member.circleId) === circleId
    && member.actorPtid.startsWith('ptid:')
    && member.actorPtid === member.actorPtid.trim() ? member.actorPtid : '', assertScope);
}
