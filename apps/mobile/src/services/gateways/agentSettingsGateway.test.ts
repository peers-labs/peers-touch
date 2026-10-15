import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthSession } from '../../features/auth/authSession';
import * as provider from '../../gen/proto/domain/agent/provider_pb';
import { createAgentSettingsGateway } from './agentSettingsGateway';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../stationTransport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../stationTransport')>(),
  executeStationOperation: execute,
}));

const session: MobileAuthSession = {
  stationPeerId: 'station-a', stationUrl: 'https://station.example',
  sessionId: 'session-a', deviceId: 'device-a', lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' }, authenticatedAt: 1,
};

describe('Agent settings generated wire boundary', () => {
  beforeEach(() => execute.mockReset());

  it('accepts the valid empty list request and decodes the raw typed reply', async () => {
    execute.mockResolvedValue({
      status: 200, contentType: 'application/protobuf',
      bodyBytes: Array.from(toBinary(provider.ListProvidersResponseSchema,
        create(provider.ListProvidersResponseSchema, { providers: [{ id: 'service', version: 9007199254740993n }] }))),
    });
    const result = await createAgentSettingsGateway(session).listProviders();
    expect(execute).toHaveBeenCalledWith(session, {
      operationId: 'agent_settings_execute', rpc: 'provider_list', body_bytes: [],
    }, undefined);
    expect(result.providers[0].version).toBe(9007199254740993n);
  });

  it('preserves optional false and the observed version on update', async () => {
    execute.mockResolvedValue({ status: 200, contentType: 'application/protobuf', bodyBytes: [] });
    await createAgentSettingsGateway(session).updateProvider({ providerId: 'service', version: 21n, enabled: false });
    const wire = execute.mock.calls[0][1];
    const decoded = fromBinary(provider.UpdateProviderRequestSchema, Uint8Array.from(wire.body_bytes));
    expect(decoded).toMatchObject({ providerId: 'service', version: 21n, enabled: false });
    expect(decoded.displayName).toBeUndefined();
  });

  it('returns a conflict without silently retrying the write', async () => {
    execute.mockResolvedValue({ status: 409, contentType: 'text/plain', bodyBytes: [] });
    await expect(createAgentSettingsGateway(session).updateProvider({
      providerId: 'service', version: 20n, enabled: true,
    })).rejects.toMatchObject({ status: 409, errorKey: 'mobile.settings.dirty.conflict' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('decodes protobuf JSON through the same generated schema', async () => {
    execute.mockResolvedValue({
      status: 200, contentType: 'application/json',
      bodyBytes: Array.from(new TextEncoder().encode('{"providers":[{"id":"service","version":"21"}]}')),
    });
    expect((await createAgentSettingsGateway(session).listProviders()).providers[0].version).toBe(21n);
  });

  it('passes cancellation to the native transport and does not request key resolution', async () => {
    execute.mockResolvedValue({ status: 200, contentType: 'application/protobuf', bodyBytes: [] });
    const signal = new AbortController().signal;
    await createAgentSettingsGateway(session).credentialStatus('service', signal);
    expect(execute.mock.calls[0][1].rpc).toBe('credential_status');
    expect(execute.mock.calls[0][2]).toBe(signal);
  });
});
