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
          description: 'Primary model',
          type: 'chat',
          enabled: true,
          context_window: 128000,
          default_reasoning_level: 'medium',
          supported_reasoning_levels: ['low', 'medium', 'high'],
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
      description: 'Primary model',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: ['low', 'medium', 'high'],
      streaming: true,
      function_call: true,
      vision: false,
      reasoning: true,
      image_output: false,
    });
  });

  it('normalizes direct and CLI provider kinds for the mixed Settings list', async () => {
    resolveStatus({
      providers: [
        {
          id: 'ark',
          name: 'Ark',
          runtime_kind: '',
        },
        {
          id: 'ollama',
          name: 'Ollama',
          runtime_kind: 'http',
        },
        {
          id: 'trae-cli',
          name: 'TRAE CLI',
          runtime_kind: 'cli',
        },
      ],
    });

    const providers = await api.listProviders();

    expect(providers.map(({ id, runtime_kind }) => ({ id, runtime_kind }))).toEqual([
      { id: 'ark', runtime_kind: 'direct' },
      { id: 'ollama', runtime_kind: 'direct' },
      { id: 'trae-cli', runtime_kind: 'cli' },
    ]);
  });

  it('projects typed CLI runtime configuration and discovery capability', async () => {
    resolveStatus({
      provider: {
        id: 'trae-cli',
        name: 'TRAE CLI',
        enabled: true,
        runtime_kind: 'cli',
        cli_command: 'traecli --json exec -',
        workspace_policy: 'isolated-agent-workspace',
        runtime_config: {
          default_model: 'default',
          startup_args: ['--verbose'],
          environment: { TRAE_PROFILE: 'work' },
          timeout_seconds: 180,
        },
        default_runtime_config: {
          default_model: 'default',
          startup_args: [],
          environment: {},
          timeout_seconds: 120,
        },
        adapter_capabilities: {
          model_discovery: true,
          startup_args: true,
          environment: true,
          configurable_timeout: true,
          runtime_capabilities: ['streaming', 'reasoning'],
        },
      },
    });

    const provider = await api.getProvider('trae-cli');

    expect(provider).toMatchObject({
      runtime_config: {
        default_model: 'default',
        startup_args: ['--verbose'],
        environment: { TRAE_PROFILE: 'work' },
        timeout_seconds: 180,
      },
      adapter_capabilities: {
        model_discovery: true,
        runtime_capabilities: ['streaming', 'reasoning'],
      },
      workspace_policy: 'isolated-agent-workspace',
    });
  });
});
