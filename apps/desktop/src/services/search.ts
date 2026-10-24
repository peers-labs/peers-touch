// Local, typed Search transport. Scope and authorization stay in the native owner.
import { create, toBinary } from '@bufbuild/protobuf';
import {
  CancelRequestSchema, CancelResponseSchema, ResolveRequestSchema,
  ResolvedResourceSchema, SearchIntent, SearchKind, SearchReadStateSchema,
  SearchResponseSchema, SearchScope, SubmitRequestSchema, SuggestRequestSchema,
  SourceState, type ResourceRef, type SearchReadState, type SearchResponse, type SourceReadState,
} from '../gen/proto/domain/search/search_pb';
import { invokeRustProto } from './desktop_api';
import { useSessionStore } from '../store/session';

export const searchService = {
  suggest(query: string, requestId: string, kinds: SearchKind[] = [], attachmentNamesOnly = false) {
    const request = create(SuggestRequestSchema, { query, requestId, kinds, attachmentNamesOnly, limit: 12 });
    return invokeRustProto('search_suggest', SearchResponseSchema, {
      request_bytes: Array.from(toBinary(SuggestRequestSchema, request)),
    });
  },
  submit(
    query: string, requestId: string, locale: string, cursor = '', refresh = false,
    kinds: SearchKind[] = [], attachmentNamesOnly = false,
  ) {
    const request = create(SubmitRequestSchema, {
      query, requestId, locale, cursor, refresh, limit: 20,
      intent: SearchIntent.FIND, kinds, attachmentNamesOnly,
      scopes: [SearchScope.DEVICE, SearchScope.STATION],
    });
    return invokeRustProto('search_submit', SearchResponseSchema, {
      request_bytes: Array.from(toBinary(SubmitRequestSchema, request)),
    });
  },
  resolve(resource: ResourceRef, sourceId: string, requestId: string) {
    const request = create(ResolveRequestSchema, { resource, sourceId, requestId });
    return invokeRustProto('search_resolve', ResolvedResourceSchema, {
      request_bytes: Array.from(toBinary(ResolveRequestSchema, request)),
    });
  },
  cancel(requestId: string) {
    const request = create(CancelRequestSchema, { requestId });
    return invokeRustProto('search_cancel', CancelResponseSchema, {
      request_bytes: Array.from(toBinary(CancelRequestSchema, request)),
    });
  },
  readState() {
    return invokeRustProto('search_read_state', SearchReadStateSchema);
  },
};

// Content revisions change row data, never the identity of the underlying object.
export function resourceIdentity(resource: ResourceRef | undefined): string {
  if (!resource) return '';
  return JSON.stringify(resource.messageId
    ? [resource.authorityNamespace, 'message', resource.conversationId, resource.messageId]
    : [resource.authorityNamespace, resource.kind, resource.id]);
}

export function captureSearchIdentity(): string {
  const session = useSessionStore.getState();
  return session.authenticated && session.currentUser
    ? JSON.stringify([session.sessionEpoch, session.currentUser.actorPtid]) : '';
}

export function sourceStateIdentity(state: SearchReadState): string {
  return JSON.stringify([state.partition, state.sources.map(source => [
    source.sourceId, source.bindingId, source.sourceRevision, source.readScope,
    source.policyRevision, source.state, source.extent, source.noStore,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

export function searchResponseDeadline(response: SearchResponse): number {
  return Math.min(Number(response.expiresAtUnixMs), ...response.items.map(item =>
    Number(item.readValidity?.leaseUntilUnixMs ?? 0n) || Infinity));
}

function sameReadOwner(source: SourceReadState, current: SourceReadState | undefined): boolean {
  if (!current || current.sourceId !== source.sourceId || current.bindingId !== source.bindingId
    || current.readScope !== source.readScope || current.noStore !== source.noStore) return false;
  // Empty native observations identify a pinned remote owner. Only the native
  // result carries its current remote observation; neither is a reusable lease.
  if (current.state !== SourceState.UNAVAILABLE && current.noStore && !current.sourceRevision && !current.policyRevision) return true;
  return current.sourceRevision === source.sourceRevision && current.policyRevision === source.policyRevision;
}

export function searchResponseCurrent(response: SearchResponse, state: SearchReadState): boolean {
  return response.partition === state.partition && response.sources.every(source => {
    const current = state.sources.find(item => item.sourceId === source.sourceId);
    return sameReadOwner(source, current);
  }) && searchResponseDeadline(response) > Date.now() && response.items.every(item => {
    const source = response.sources.find(row => row.sourceId === item.sourceId);
    const current = state.sources.find(row => row.sourceId === item.sourceId);
    return !!source && !!item.readValidity
      && !!current && current.state !== SourceState.UNAVAILABLE
      && source.state !== SourceState.UNAVAILABLE
      && item.readValidity.readScope === source.readScope
      && item.readValidity.policyRevision === source.policyRevision;
  });
}

// Invalidating one source never hides the still-readable results of another.
export function concealChangedSearchSources(response: SearchResponse, state: SearchReadState): SearchResponse | null {
  if (response.partition !== state.partition || Number(response.expiresAtUnixMs) <= Date.now()) return null;
  const changed = new Set(response.sources.filter(source => {
    const current = state.sources.find(row => row.sourceId === source.sourceId);
    return !sameReadOwner(source, current) || current?.state === SourceState.UNAVAILABLE;
  }).map(source => source.sourceId));
  const items = response.items.filter(item => !changed.has(item.sourceId)
    && !!item.readValidity && (!item.readValidity.leaseUntilUnixMs
      || Number(item.readValidity.leaseUntilUnixMs) > Date.now()));
  if (!changed.size && items.length === response.items.length) return response;
  return {
    ...response, items, nextCursor: '', hasMore: false,
    coverage: response.coverage.map(source => changed.has(source.sourceId)
      ? { ...source, state: SourceState.PARTIAL, detailKey: 'search.coverage.partial' } : source),
  };
}
