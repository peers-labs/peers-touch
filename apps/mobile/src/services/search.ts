import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import {
  CancelRequestSchema, CancelResponseSchema, ResolveRequestSchema,
  ResolvedResourceSchema, SearchIntent, SearchKind, SearchReadStateSchema,
  SearchResponseSchema, SearchScope, SubmitRequestSchema, SuggestRequestSchema,
  type ResourceRef,
} from '../gen/proto/domain/search/search_pb';

// The native host derives identity and authorization. No renderer account input.
export const mobileSearchService = {
  async suggest(query: string, requestId: string, kind: SearchKind, conversationId: string, attachmentNamesOnly = false) {
    const request = create(SuggestRequestSchema, {
      query, requestId, kind, conversationId, attachmentNamesOnly, limit: 12,
    });
    const bytes = await invoke<number[]>('search_suggest', {
      input: { requestBytes: Array.from(toBinary(SuggestRequestSchema, request)) },
    });
    return fromBinary(SearchResponseSchema, Uint8Array.from(bytes));
  },
  async submit(
    query: string, requestId: string, locale: string, kind: SearchKind,
    conversationId: string, cursor = '', refresh = false, attachmentNamesOnly = false, limit = 100,
  ) {
    const request = create(SubmitRequestSchema, {
      query, requestId, locale, kind, conversationId, cursor, refresh, attachmentNamesOnly, limit,
      intent: SearchIntent.FIND, scope: SearchScope.DEVICE,
    });
    const bytes = await invoke<number[]>('search_submit', {
      input: { requestBytes: Array.from(toBinary(SubmitRequestSchema, request)) },
    });
    return fromBinary(SearchResponseSchema, Uint8Array.from(bytes));
  },
  async resolve(resource: ResourceRef, requestId: string) {
    const request = create(ResolveRequestSchema, { resource, requestId });
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
