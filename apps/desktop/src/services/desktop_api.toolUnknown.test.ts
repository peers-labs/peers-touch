import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentToolUnknownError,
} from './desktop_api';

describe('Desktop unknown-tool typed error mapping', () => {
  it('maps the canonical Station payload to tool selection', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.toolUnknown',
      error_type: 'TOOL_UNKNOWN',
      locale_key: 'agent.errors.toolUnknown',
      retryable: false,
      terminal: true,
      details: {
        tool_id: 'skills_list',
        tool_version: 'manifest-version',
      },
    });

    expect(isAgentToolUnknownError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'chooseTool',
      toolId: 'skills_list',
      toolVersion: 'manifest-version',
      label: 'agent.recovery.chooseTool',
    });
  });

  it.each([
    ['wrong type', 'OTHER', 'agent.errors.toolUnknown', false, true, {
      tool_id: 'skills_list',
      tool_version: 'manifest-version',
    }],
    ['wrong locale', 'TOOL_UNKNOWN', 'agent.errors.providerTimeout', false, true, {
      tool_id: 'skills_list',
      tool_version: 'manifest-version',
    }],
    ['retryable', 'TOOL_UNKNOWN', 'agent.errors.toolUnknown', true, true, {
      tool_id: 'skills_list',
      tool_version: 'manifest-version',
    }],
    ['empty tool id', 'TOOL_UNKNOWN', 'agent.errors.toolUnknown', false, true, {
      tool_id: '',
      tool_version: 'manifest-version',
    }],
    ['empty tool version', 'TOOL_UNKNOWN', 'agent.errors.toolUnknown', false, true, {
      tool_id: 'skills_list',
      tool_version: '',
    }],
    ['extra detail', 'TOOL_UNKNOWN', 'agent.errors.toolUnknown', false, true, {
      tool_id: 'skills_list',
      tool_version: 'manifest-version',
      capability_id: 'tool:skills_list',
    }],
  ])('rejects %s', (
    _case,
    errorType,
    localeKey,
    retryable,
    terminal,
    details,
  ) => {
    const error = agentTurnStreamErrorFromData({
      error: localeKey,
      error_type: errorType,
      locale_key: localeKey,
      retryable,
      terminal,
      details,
    });

    expect(isAgentToolUnknownError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
