import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function resolveStatus(data: unknown): void {
  vi.mocked(invoke).mockResolvedValueOnce({
    ok: true,
    data: {
      command: 'test',
      status: JSON.stringify(data),
    },
  });
}

describe('Desktop provider model capability transport', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('maps model editor flags to canonical capability IDs', async () => {
    resolveStatus({ ok: true });

    await api.addModel('provider-1', {
      id: 'model-1',
      context_window: 128000,
      streaming: true,
      function_call: false,
      vision: true,
      reasoning: true,
      image_output: false,
      search: true,
      video: true,
    });

    expect(invoke).toHaveBeenCalledWith('model_add', {
      input: {
        provider_id: 'provider-1',
        data: {
          id: 'model-1',
          context_window: 128000,
          streaming: true,
          function_call: false,
          vision: true,
          reasoning: true,
          image_output: false,
          search: true,
          video: true,
          capabilities: {
            flags: {
              streaming: true,
              'native-tools': false,
              'image-input': true,
              reasoning: true,
              'image-output': false,
            },
          },
        },
      },
    });
  });

  it('projects canonical capability readback into model UI fields', async () => {
    resolveStatus({
      provider: {
        id: 'provider-1',
        enabled: true,
        models: [{
          id: 'model-1',
          display_name: 'Model 1',
          type: 'chat',
          enabled: true,
          context_window: 128000,
          capabilities: {
            flags: {
              streaming: true,
              'native-tools': true,
              'image-input': false,
              reasoning: true,
              'image-output': false,
            },
          },
        }],
      },
    });

    const provider = await api.getProvider('provider-1');

    expect(provider.models[0]).toMatchObject({
      id: 'model-1',
      streaming: true,
      function_call: true,
      vision: false,
      reasoning: true,
      image_output: false,
    });
  });
});
