import { create, fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  ListActorDevicesResponseSchema, RevokeActorDeviceRequestSchema, RevokeActorDeviceResponseSchema,
  type ActorDevice,
} from '../../gen/proto/domain/actor/actor_pb';
import { executeStationOperation, responseBytes, type StationTransportOperation } from '../stationTransport';
import { AgentSettingsError } from './agentSettingsRpc';

export function createSecurityGateway(session: MobileAuthSession) {
  const rpc = async <Reply extends DescMessage>(
    operation: StationTransportOperation, schema: Reply, signal?: AbortSignal,
  ): Promise<MessageShape<Reply>> => {
    const response = await executeStationOperation(session, operation, signal);
    if (response.status < 200 || response.status >= 300) {
      throw new AgentSettingsError(response.status, 'mobile.settings.security.devicesFailed');
    }
    return fromBinary(schema, responseBytes(response));
  };
  return {
    listDevices: (signal?: AbortSignal) => rpc({ operationId: 'actor_devices_list' }, ListActorDevicesResponseSchema, signal),
    revokeDevice: (device: ActorDevice, signal?: AbortSignal) => rpc({
      operationId: 'actor_devices_revoke',
      body_bytes: Array.from(toBinary(RevokeActorDeviceRequestSchema, create(RevokeActorDeviceRequestSchema, {
        deviceId: device.ref?.deviceId, observedProfileVersion: device.profileVersion,
      }))),
    }, RevokeActorDeviceResponseSchema, signal),
  };
}
