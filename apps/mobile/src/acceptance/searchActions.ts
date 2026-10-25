import { fromJson, toJson, type JsonObject } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import {
  ResourceRefSchema, ResolvedResourceSchema, SearchKind,
  SearchReadStateSchema, SearchResponseSchema,
} from '../gen/proto/domain/search/search_pb';
import { mobileSearchService } from '../services/search';

type ReadResult = { accepted: true; value: JsonObject } | { accepted: false; errorCode: string };

export interface MobileSearchAcceptanceContracts {
  'search.page': {
    input: {
      query: string; requestId?: string; conversationId?: string; cursor?: string;
      locale?: string; refresh?: boolean; attachmentNamesOnly?: boolean; limit?: number;
    };
    output: ReadResult;
  };
  'search.resolve': {
    input: { resource: JsonObject; requestId?: string };
    output: ReadResult;
  };
  'search.state': { input: undefined; output: JsonObject };
  'search.cancel': { input: { requestId: string }; output: { cancelled: boolean } };
  'search.reads': { input: undefined; output: { sourceReads: number; hydrationReads: number; observations: number } };
}

async function read(operation: () => Promise<JsonObject>): Promise<ReadResult> {
  try {
    return { accepted: true, value: await operation() };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    return {
      accepted: false,
      errorCode: typeof code === 'string' && code.startsWith('SEARCH_') ? code : 'SEARCH_PROTOCOL',
    };
  }
}

// Supporting native diagnostics only. The Journey drives Search's real UI.
export const mobileSearchAcceptanceActions = {
  'search.page': (input: MobileSearchAcceptanceContracts['search.page']['input']) => read(async () =>
    toJson(SearchResponseSchema, await mobileSearchService.submit(
      input.query, input.requestId ?? crypto.randomUUID(), input.locale ?? 'en',
      SearchKind.MESSAGE, input.conversationId ?? '', input.cursor ?? '', input.refresh ?? false,
      input.attachmentNamesOnly ?? false, input.limit ?? 100,
    )) as JsonObject),
  'search.resolve': (input: MobileSearchAcceptanceContracts['search.resolve']['input']) => read(async () =>
    toJson(ResolvedResourceSchema, await mobileSearchService.resolve(
      fromJson(ResourceRefSchema, input.resource), input.requestId ?? crypto.randomUUID(),
    )) as JsonObject),
  'search.state': async () => toJson(SearchReadStateSchema, await mobileSearchService.readState()) as JsonObject,
  'search.reads': async () => invoke<MobileSearchAcceptanceContracts['search.reads']['output']>('search_read_diagnostics'),
  'search.cancel': async ({ requestId }: { requestId: string }) => {
    const response = await mobileSearchService.cancel(requestId);
    return { cancelled: response.cancelled };
  },
};
