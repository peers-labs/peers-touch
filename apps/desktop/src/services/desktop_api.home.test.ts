import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GetHomeWorkProjectionRequestSchema,
  GetHomeWorkProjectionResponseSchema,
  HomeWorkKind,
} from '../gen/proto/domain/agent/home_pb';
import { api } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Desktop Home projection API', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('encodes the revision cursor and decodes the Station projection', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ok: true,
      data: Array.from(toBinary(
        GetHomeWorkProjectionResponseSchema,
        create(GetHomeWorkProjectionResponseSchema, {
          projection: {
            ptid: 'ptid:actor-1',
            revision: 9n,
            recentWork: [{
              workId: 'conversation-1',
              kind: HomeWorkKind.CHAT,
              agentId: 'agent-1',
              title: 'Recent work',
            }],
          },
        }),
      )),
    });

    const projection = await api.getHomeWorkProjection(7n);

    expect(projection.ptid).toBe('ptid:actor-1');
    expect(projection.revision).toBe(9n);
    expect(projection.recentWork[0]?.workId).toBe('conversation-1');

    const invocation = vi.mocked(invoke).mock.calls[0];
    expect(invocation?.[0]).toBe('agent_home_projection_get');
    const args = invocation?.[1] as {
      input?: { requestBytes?: number[] };
    } | undefined;
    const request = fromBinary(
      GetHomeWorkProjectionRequestSchema,
      new Uint8Array(args?.input?.requestBytes ?? []),
    );
    expect(request.afterRevision).toBe(7n);
  });
});
