import { create, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GetTurnAttributionsResponseSchema,
  TurnAttributionProjectionSchema,
  TurnAttributionState,
} from '../gen/proto/domain/agent/agent_pb';
import { api } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Desktop Turn attribution API', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('requests a bounded Turn batch and decodes historical projections', async () => {
    const response = create(GetTurnAttributionsResponseSchema, {
      attributions: [
        create(TurnAttributionProjectionSchema, {
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          state: TurnAttributionState.AVAILABLE,
        }),
      ],
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      ok: true,
      data: Array.from(toBinary(
        GetTurnAttributionsResponseSchema,
        response,
      )),
    });

    const projected = await api.getAgentTurnAttributions(['turn-1']);

    expect(projected.attributions[0]?.attemptId).toBe('attempt-1');
    expect(invoke).toHaveBeenCalledWith('agent_turn_attributions_get', {
      input: { turn_ids: ['turn-1'] },
    });
  });
});
