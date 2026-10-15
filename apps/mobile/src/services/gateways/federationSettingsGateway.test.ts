import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthSession } from '../../features/auth/authSession';
import * as wire from '../../gen/proto/domain/federation/federation_projection_service_pb';
import { createFederationSettingsGateway } from './federationSettingsGateway';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../stationTransport', async (original) => ({
  ...await original<typeof import('../stationTransport')>(), executeStationOperation: execute,
}));
const session: MobileAuthSession = {
  stationPeerId: 'station-a', stationUrl: 'https://station.example', sessionId: 'session-a',
  deviceId: 'device-a', lifecycleGeneration: 1, authenticatedAt: 1, actorRef: { ptid: 'ptid:alice' },
};

describe('Federation governance wire boundary', () => {
  beforeEach(() => execute.mockReset());

  it('preserves large ledger heads and never infers owner capabilities for a participant', async () => {
    execute.mockResolvedValue({
      status: 200, contentType: 'application/protobuf',
      bodyBytes: Array.from(toBinary(wire.ListFederationsResponseSchema,
        create(wire.ListFederationsResponseSchema, { federations: [
          { federationId: 'owned', headSeq: 9007199254740993n, capability: { canArchive: true } },
          { federationId: 'participant' },
        ] }))),
    });
    const result = await createFederationSettingsGateway(session).list();
    expect(result.federations[0].headSeq).toBe(9007199254740993n);
    expect(result.federations[0].capability?.canArchive).toBe(true);
    expect(result.federations[1].capability).toBeUndefined();
    expect(execute.mock.calls[0][1]).toEqual({ operationId: 'federation_settings_execute', rpc: 'list', body_bytes: [] });
  });

  it('sends leave by its generated identity and propagates cancellation', async () => {
    execute.mockResolvedValue({ status: 200, contentType: 'application/protobuf',
      bodyBytes: Array.from(toBinary(wire.LeaveFederationResponseSchema,
        create(wire.LeaveFederationResponseSchema, { success: true }))) });
    const signal = new AbortController().signal;
    await createFederationSettingsGateway(session).leave('fed/with-special-character', signal);
    const operation = execute.mock.calls[0][1];
    expect(operation.rpc).toBe('leave');
    expect(fromBinary(wire.LeaveFederationRequestSchema, Uint8Array.from(operation.body_bytes)).federationId)
      .toBe('fed/with-special-character');
    expect(execute.mock.calls[0][2]).toBe(signal);
  });

  it('returns permission failure without retrying a destructive mutation', async () => {
    execute.mockResolvedValue({ status: 403, contentType: 'text/plain', bodyBytes: [] });
    await expect(createFederationSettingsGateway(session).delete('owned')).rejects
      .toMatchObject({ errorKey: 'mobile.settings.federation.denied' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('keeps pending join distinct from an active membership', async () => {
    execute.mockResolvedValue({ status: 200, contentType: 'application/json',
      bodyBytes: Array.from(new TextEncoder().encode('{"status":"pending","proposal_id":"proposal-a"}')) });
    const result = await createFederationSettingsGateway(session).join({
      federationId: 'fed-a', federationEndpoint: 'https://network.example',
    });
    expect(result).toMatchObject({ status: 'pending', proposalId: 'proposal-a' });
    const operation = execute.mock.calls[0][1];
    expect(fromBinary(wire.JoinFederationRequestSchema, Uint8Array.from(operation.body_bytes))).toMatchObject({
      federationId: 'fed-a', federationEndpoint: 'https://network.example',
    });
  });
});
