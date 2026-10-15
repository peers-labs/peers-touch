import {
  create, fromBinary, fromJson, toBinary,
  type DescMessage, type JsonValue, type MessageInitShape, type MessageShape,
} from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import * as wire from '../../gen/proto/domain/federation/federation_projection_service_pb';
import { executeStationOperation, responseBytes, responseJson, type StationTransportOperation } from '../stationTransport';

export class FederationSettingsError extends Error {
  constructor(readonly errorKey = 'mobile.settings.federation.requestFailed') {
    super(errorKey);
  }
}

type Rpc = Extract<StationTransportOperation, { operationId: 'federation_settings_execute' }>['rpc'];

export function createFederationSettingsGateway(session: MobileAuthSession) {
  async function execute<Reply extends DescMessage>(
    rpc: Rpc, replySchema: Reply, body: Uint8Array, signal?: AbortSignal,
  ): Promise<MessageShape<Reply>> {
    const response = await executeStationOperation(session, {
      operationId: 'federation_settings_execute', rpc, body_bytes: Array.from(body),
    }, signal);
    if (response.status < 200 || response.status >= 300) {
      throw new FederationSettingsError(response.status === 403
        ? 'mobile.settings.federation.denied' : 'mobile.settings.federation.requestFailed');
    }
    return /protobuf/.test(response.contentType) ? fromBinary(replySchema, responseBytes(response))
      : fromJson(replySchema, responseJson(response) as JsonValue);
  }
  const mutate = <Request extends DescMessage, Reply extends DescMessage>(
    rpc: Rpc, requestSchema: Request, replySchema: Reply, input: MessageInitShape<Request>, signal?: AbortSignal,
  ) => execute(rpc, replySchema, toBinary(requestSchema, create(requestSchema, input)), signal);
  return {
    list: (signal?: AbortSignal) => execute('list', wire.ListFederationsResponseSchema, new Uint8Array(), signal),
    create: (input: MessageInitShape<typeof wire.CreateFederationRequestSchema>, signal?: AbortSignal) =>
      mutate('create', wire.CreateFederationRequestSchema, wire.CreateFederationResponseSchema, input, signal),
    join: (input: MessageInitShape<typeof wire.JoinFederationRequestSchema>, signal?: AbortSignal) =>
      mutate('join', wire.JoinFederationRequestSchema, wire.JoinFederationResponseSchema, input, signal),
    leave: (federationId: string, signal?: AbortSignal) => mutate(
      'leave', wire.LeaveFederationRequestSchema, wire.LeaveFederationResponseSchema, { federationId }, signal,
    ),
    delete: (federationId: string, signal?: AbortSignal) => mutate(
      'delete', wire.DeleteFederationRequestSchema, wire.DeleteFederationResponseSchema, { federationId }, signal,
    ),
  };
}
