import type { MessageInitShape } from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import * as provider from '../../gen/proto/domain/agent/provider_pb';
import * as operations from '../../gen/proto/domain/agent/provider_operations_pb';
import { createAgentSettingsRpc } from './agentSettingsRpc';

export function createAgentSettingsGateway(session: MobileAuthSession) {
  const rpc = createAgentSettingsRpc(session);

  return {
    listProviders: (signal?: AbortSignal) => rpc(
      'provider_list', provider.ListProvidersRequestSchema,
      provider.ListProvidersResponseSchema, {}, signal,
    ),
    getProvider: (providerId: string, signal?: AbortSignal) => rpc(
      'provider_get', provider.GetProviderRequestSchema,
      provider.GetProviderResponseSchema, { providerId }, signal,
    ),
    createProvider: (input: MessageInitShape<typeof provider.CreateProviderRequestSchema>, signal?: AbortSignal) => rpc(
      'provider_create', provider.CreateProviderRequestSchema,
      provider.CreateProviderResponseSchema, input, signal,
    ),
    updateProvider: (input: MessageInitShape<typeof provider.UpdateProviderRequestSchema>, signal?: AbortSignal) => rpc(
      'provider_update', provider.UpdateProviderRequestSchema,
      provider.UpdateProviderResponseSchema, input, signal,
    ),
    deleteProvider: (providerId: string, version: bigint, signal?: AbortSignal) => rpc(
      'provider_delete', provider.DeleteProviderRequestSchema,
      provider.DeleteProviderResponseSchema, { providerId, version }, signal,
    ),
    checkProvider: (providerId: string, version: bigint, modelId: string, signal?: AbortSignal) => rpc(
      'provider_check', operations.CheckProviderRequestSchema,
      operations.CheckProviderResponseSchema, { providerId, version, modelId }, signal,
    ),
    discoverModels: (providerId: string, version: bigint, signal?: AbortSignal) => rpc(
      'provider_models_discover', operations.DiscoverProviderModelsRequestSchema,
      operations.DiscoverProviderModelsResponseSchema, { providerId, version }, signal,
    ),
    listAvailableModels: (signal?: AbortSignal) => rpc(
      'models_available', provider.ListAvailableModelsRequestSchema,
      provider.ListAvailableModelsResponseSchema, {}, signal,
    ),
    createModel: (input: MessageInitShape<typeof provider.CreateModelRequestSchema>, signal?: AbortSignal) => rpc(
      'model_create', provider.CreateModelRequestSchema,
      provider.CreateModelResponseSchema, input, signal,
    ),
    setCredential: (providerId: string, apiKey: string, signal?: AbortSignal) => rpc(
      'credential_set', provider.SetCredentialRequestSchema,
      provider.SetCredentialResponseSchema, { providerId, apiKey }, signal,
    ),
    credentialStatus: (providerId: string, signal?: AbortSignal) => rpc(
      'credential_status', provider.GetCredentialStatusRequestSchema,
      provider.GetCredentialStatusResponseSchema, { providerId }, signal,
    ),
  };
}

export type AgentSettingsGateway = ReturnType<typeof createAgentSettingsGateway>;
