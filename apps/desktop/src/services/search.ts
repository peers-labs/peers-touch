// Local, typed Search transport. Scope and authorization stay in the native owner.
import { create, toBinary } from '@bufbuild/protobuf';
import {
  CancelRequestSchema, CancelResponseSchema, ResolveRequestSchema,
  ResolvedResourceSchema, SearchIntent, SearchKind, SearchReadStateSchema,
  SearchResponseSchema, SearchScope, SubmitRequestSchema, SuggestRequestSchema,
  type ResourceRef,
} from '../gen/proto/domain/search/search_pb';
import { invokeRustProto } from './desktop_api';

export const searchService = {
  suggest(query: string, requestId: string, kind = SearchKind.UNSPECIFIED) {
    const request = create(SuggestRequestSchema, { query, requestId, kind, limit: 12 });
    return invokeRustProto('search_suggest', SearchResponseSchema, {
      request_bytes: Array.from(toBinary(SuggestRequestSchema, request)),
    });
  },
  submit(query: string, requestId: string, locale: string, cursor = '', refresh = false) {
    const request = create(SubmitRequestSchema, {
      query, requestId, locale, cursor, refresh, limit: 20,
      intent: SearchIntent.FIND, kind: SearchKind.MESSAGE, scope: SearchScope.DEVICE,
    });
    return invokeRustProto('search_submit', SearchResponseSchema, {
      request_bytes: Array.from(toBinary(SubmitRequestSchema, request)),
    });
  },
  resolve(resource: ResourceRef, requestId: string) {
    const request = create(ResolveRequestSchema, { resource, requestId });
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
  return resource ? JSON.stringify([
    resource.authorityNamespace, resource.kind, resource.id,
    resource.conversationId, resource.messageId, resource.anchor?.kind, resource.anchor?.id,
  ]) : '';
}
