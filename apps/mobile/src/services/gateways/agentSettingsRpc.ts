import {
  create, fromBinary, fromJson, toBinary,
  type DescMessage, type JsonValue, type MessageInitShape, type MessageShape,
} from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  executeStationOperation, responseBytes, responseJson, type AgentSettingsRpc,
} from '../stationTransport';

export class AgentSettingsError extends Error {
  constructor(readonly status: number | null, readonly errorKey = 'mobile.settings.agent.requestFailed') {
    super(errorKey);
    this.name = 'AgentSettingsError';
  }
}

/** Native path and session admission remain closed to the renderer. */
export function createAgentSettingsRpc(session: MobileAuthSession) {
  return async <Request extends DescMessage, Reply extends DescMessage>(
    operation: AgentSettingsRpc,
    requestSchema: Request,
    replySchema: Reply,
    input: MessageInitShape<Request>,
    signal?: AbortSignal,
  ): Promise<MessageShape<Reply>> => {
    const response = await executeStationOperation(session, {
      operationId: 'agent_settings_execute',
      rpc: operation,
      body_bytes: Array.from(toBinary(requestSchema, create(requestSchema, input))),
    }, signal);
    if (response.status < 200 || response.status >= 300) {
      throw new AgentSettingsError(
        response.status,
        response.status === 409 ? 'mobile.settings.dirty.conflict'
          : response.status === 401 ? 'mobile.auth.sessionExpiredTitle'
            : 'mobile.settings.agent.requestFailed',
      );
    }
    return /protobuf/.test(response.contentType)
      ? fromBinary(replySchema, responseBytes(response))
      : fromJson(replySchema, responseJson(response) as JsonValue);
  };
}
