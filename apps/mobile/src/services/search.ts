import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import {
  CancelRequestSchema, CancelResponseSchema, ResolveRequestSchema,
  ResolvedResourceSchema, SearchIntent, SearchKind, SearchReadStateSchema,
  SearchResponseSchema, SearchScope, SubmitRequestSchema, SuggestRequestSchema,
  SourceState, type ResourceRef, type SearchReadState, type SearchResponse, type SourceReadState,
} from '../gen/proto/domain/search/search_pb';

// The native host derives identity and authorization. No renderer account input.
export const mobileSearchService = {
  async suggest(query: string, requestId: string, kinds: SearchKind[], conversationId: string, attachmentNamesOnly = false) {
    const request = create(SuggestRequestSchema, {
      query, requestId, kinds, conversationId, attachmentNamesOnly, limit: 12,
    });
    const bytes = await invoke<number[]>('search_suggest', {
      input: { requestBytes: Array.from(toBinary(SuggestRequestSchema, request)) },
    });
    return fromBinary(SearchResponseSchema, Uint8Array.from(bytes));
  },
  async submit(
    query: string, requestId: string, locale: string, kinds: SearchKind[],
    conversationId: string, cursor = '', refresh = false, attachmentNamesOnly = false, limit = 100,
  ) {
    const request = create(SubmitRequestSchema, {
      query, requestId, locale, kinds, conversationId, cursor, refresh, attachmentNamesOnly, limit,
      intent: SearchIntent.FIND, scopes: conversationId
        ? [SearchScope.DEVICE] : [SearchScope.DEVICE, SearchScope.STATION],
    });
    const bytes = await invoke<number[]>('search_submit', {
      input: { requestBytes: Array.from(toBinary(SubmitRequestSchema, request)) },
    });
    return fromBinary(SearchResponseSchema, Uint8Array.from(bytes));
  },
  async resolve(resource: ResourceRef, sourceId: string, requestId: string) {
    const request = create(ResolveRequestSchema, { resource, sourceId, requestId });
    const bytes = await invoke<number[]>('search_resolve', {
      input: { requestBytes: Array.from(toBinary(ResolveRequestSchema, request)) },
    });
    return fromBinary(ResolvedResourceSchema, Uint8Array.from(bytes));
  },
  async cancel(requestId: string) {
    const request = create(CancelRequestSchema, { requestId });
    const bytes = await invoke<number[]>('search_cancel', {
      input: { requestBytes: Array.from(toBinary(CancelRequestSchema, request)) },
    });
    return fromBinary(CancelResponseSchema, Uint8Array.from(bytes));
  },
  async readState() {
    const bytes = await invoke<number[]>('search_read_state');
    return fromBinary(SearchReadStateSchema, Uint8Array.from(bytes));
  },
};

function sameReadOwner(source: SourceReadState, current: SourceReadState | undefined): boolean {
  if (!current || source.sourceId !== current.sourceId || source.bindingId !== current.bindingId
    || source.readScope !== current.readScope || source.noStore !== current.noStore) return false;
  if (current.state !== SourceState.UNAVAILABLE && current.noStore && !current.sourceRevision && !current.policyRevision) return true;
  return source.sourceRevision === current.sourceRevision && source.policyRevision === current.policyRevision;
}

export function mobileSearchResponseCurrent(response: SearchResponse, state: SearchReadState): boolean {
  return response.partition === state.partition && Number(response.expiresAtUnixMs) > Date.now()
    && response.sources.every(source => {
      const current = state.sources.find(row => row.sourceId === source.sourceId);
      return sameReadOwner(source, current);
    }) && response.items.every(item => {
      const current = response.sources.find(row => row.sourceId === item.sourceId);
      const owner = state.sources.find(row => row.sourceId === item.sourceId);
      const validity = item.readValidity;
      return !!current && current.state !== SourceState.UNAVAILABLE && !!validity
        && !!owner && owner.state !== SourceState.UNAVAILABLE
        && current.readScope === validity.readScope && current.policyRevision === validity.policyRevision
        && (!validity.leaseUntilUnixMs || Number(validity.leaseUntilUnixMs) > Date.now());
    });
}

export function concealChangedMobileSearchSources(
  response: SearchResponse, state: SearchReadState,
): SearchResponse | null {
  if (response.partition !== state.partition || Number(response.expiresAtUnixMs) <= Date.now()) return null;
  const invalid = new Set(response.sources.filter(source => {
    const current = state.sources.find(row => row.sourceId === source.sourceId);
    return !sameReadOwner(source, current) || current?.state === SourceState.UNAVAILABLE;
  }).map(source => source.sourceId));
  const items = response.items.filter(item => !invalid.has(item.sourceId) && !!item.readValidity
    && (!item.readValidity.leaseUntilUnixMs || Number(item.readValidity.leaseUntilUnixMs) > Date.now()));
  if (!invalid.size && items.length === response.items.length) return response;
  return {
    ...response, items, nextCursor: '', hasMore: false,
    coverage: response.coverage.map(source => invalid.has(source.sourceId)
      ? { ...source, state: SourceState.PARTIAL, detailKey: 'search.coverage.partial' } : source),
  };
}

export function mobileSearchResourceIdentity(resource: ResourceRef | undefined): string {
  if (!resource) return '';
  return JSON.stringify(resource.messageId
    ? [resource.authorityNamespace, 'message', resource.conversationId, resource.messageId]
    : [resource.authorityNamespace, resource.kind, resource.id]);
}
