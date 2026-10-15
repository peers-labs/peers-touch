import { useEffect, useRef, useState } from 'react';
import type { MobileAuthSession } from '../auth/authSession';
import { createMobileActorStorageRuntime } from '../../storage/mobileClientStorage';

const STORAGE_KEY = 'mobile-chat-recent-searches';
const MAX_QUERIES = 10;
const pendingWrites = new Map<string, Promise<unknown>>();

export function normalizeChatSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

export function prependRecentChatSearch(history: readonly string[], query: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of [query, ...history]) {
    const normalized = normalizeChatSearchQuery(value);
    const identity = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
    if (result.length === MAX_QUERIES) break;
  }
  return result;
}

function readHistory(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('queries' in value)) return [];
  const queries = value.queries;
  return Array.isArray(queries)
    ? prependRecentChatSearch(queries.filter((query): query is string => typeof query === 'string'), '')
    : [];
}

/** Device-local UI preferences; never store credentials or message bodies here. */
export function useRecentChatSearch(session: MobileAuthSession | null) {
  const scope = session ? `${session.stationPeerId}\u0000${session.actorRef.ptid}` : '';
  const identity = useRef(scope);
  identity.current = scope;
  const mounted = useRef(true);
  const revision = useRef(0);
  const failedOperation = useRef<{
    scope: string;
    reduce: (queries: string[]) => string[];
  } | null>(null);
  const [state, setState] = useState({ scope: '', queries: [] as string[], failed: false });
  const stationPeerId = session?.stationPeerId ?? '';
  const ptid = session?.actorRef.ptid ?? '';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!scope) return;
    const admittedRevision = revision.current;
    const repository = createMobileActorStorageRuntime(stationPeerId, ptid).repositories.chatPreferences;
    void (pendingWrites.get(scope) ?? Promise.resolve())
      .then(() => repository.readValue(STORAGE_KEY))
      .then((value) => {
        if (active && identity.current === scope && revision.current === admittedRevision) {
          setState({ scope, queries: readHistory(value), failed: false });
        }
      })
      .catch(() => {
        if (active && identity.current === scope && revision.current === admittedRevision) {
          setState({ scope, queries: [], failed: true });
        }
      });
    return () => { active = false; };
  }, [scope, stationPeerId, ptid]);

  function update(reduce: (queries: string[]) => string[]): void {
    if (!scope) return;
    revision.current += 1;
    const repository = createMobileActorStorageRuntime(stationPeerId, ptid).repositories.chatPreferences;
    // Serialize read/modify/write across tab remounts and simultaneous search surfaces.
    const operation = (pendingWrites.get(scope) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const queries = reduce(readHistory(await repository.readValue(STORAGE_KEY)));
        await repository.write(STORAGE_KEY, { queries });
        if (mounted.current && identity.current === scope) {
          failedOperation.current = null;
          setState({ scope, queries, failed: false });
        }
      })
      .catch(() => {
        if (mounted.current && identity.current === scope) {
          failedOperation.current = { scope, reduce };
          setState((current) => ({
            scope, queries: current.scope === scope ? current.queries : [], failed: true,
          }));
        }
      });
    pendingWrites.set(scope, operation);
    void operation.finally(() => {
      if (pendingWrites.get(scope) === operation) pendingWrites.delete(scope);
    });
  }

  return {
    queries: state.scope === scope ? state.queries : [],
    failed: state.scope === scope && state.failed,
    remember: (query: string) => {
      if (normalizeChatSearchQuery(query)) update((queries) => prependRecentChatSearch(queries, query));
    },
    remove: (query: string) => update((queries) => queries.filter(
      (item) => item.toLocaleLowerCase() !== normalizeChatSearchQuery(query).toLocaleLowerCase(),
    )),
    clear: () => update(() => []),
    retry: () => update(failedOperation.current?.scope === scope
      ? failedOperation.current.reduce
      : (queries) => queries),
  };
}
