import { describe, expect, it } from 'vitest';
import {
  ATELIER_PROJECT_CREATE_FORBIDDEN_ACTIONS,
  ATELIER_PROJECT_CREATE_OPTIONAL_FIELDS,
  ATELIER_PROJECT_CREATE_REQUIRED_FIELDS,
  buildAtelierProjectCreateIntent,
  containsForbiddenAtelierProjectCreatePayloadActions,
} from './projectCreateActionGuards';
import {
  ATELIER_DEFAULT_AGENT_FLOW_ID,
  ATELIER_DEFAULT_DIRECT_RUN_MODEL,
  ATELIER_DEFAULT_RUN_TARGET_KIND,
  ATELIER_DEFAULT_TASK_INTENT_PRESET,
} from '../domain/projection.contract.generated';

describe('project create action guards', () => {
  it('builds trimmed Station-owned project create intents', () => {
    expect(ATELIER_PROJECT_CREATE_REQUIRED_FIELDS).toEqual(['goal', 'agentIds']);
    expect(ATELIER_PROJECT_CREATE_OPTIONAL_FIELDS).toEqual([
      'clientIdempotencyKey',
      'intentPreset',
      'run.kind',
      'run.flowId',
      'run.model',
    ]);
    expect(buildAtelierProjectCreateIntent({
      goal: ' build an Atelier plan ',
      intentPreset: 'code',
      model: 'claude-sonnet',
      runKind: 'agents',
      flowId: 'roundtable',
      project: ' peers-touch ',
      pending: false,
    })).toEqual({
      status: 'ready',
      intent: {
        goal: 'build an Atelier plan',
        intentPreset: 'code',
        model: 'claude-sonnet',
        runKind: 'agents',
        flowId: 'roundtable',
        project: 'peers-touch',
      },
      submitKey: JSON.stringify({
        goal: 'build an Atelier plan',
        intentPreset: 'code',
        model: 'claude-sonnet',
        runKind: 'agents',
        flowId: 'roundtable',
        project: 'peers-touch',
      }),
    });
  });

  it('uses generated defaults for optional project create controls', () => {
    expect(buildAtelierProjectCreateIntent({
      goal: 'draft release notes',
      intentPreset: '',
      model: '',
      runKind: '',
      flowId: '',
      pending: false,
    })).toEqual({
      status: 'ready',
      intent: {
        goal: 'draft release notes',
        intentPreset: ATELIER_DEFAULT_TASK_INTENT_PRESET,
        model: ATELIER_DEFAULT_DIRECT_RUN_MODEL,
        runKind: ATELIER_DEFAULT_RUN_TARGET_KIND,
        flowId: ATELIER_DEFAULT_AGENT_FLOW_ID,
      },
      submitKey: JSON.stringify({
        goal: 'draft release notes',
        intentPreset: ATELIER_DEFAULT_TASK_INTENT_PRESET,
        model: ATELIER_DEFAULT_DIRECT_RUN_MODEL,
        runKind: ATELIER_DEFAULT_RUN_TARGET_KIND,
        flowId: ATELIER_DEFAULT_AGENT_FLOW_ID,
      }),
    });
  });

  it('blocks empty goals and concurrent project creation', () => {
    expect(buildAtelierProjectCreateIntent({
      goal: ' ',
      intentPreset: 'work',
      model: 'openrouter-3o',
      runKind: 'agents',
      flowId: 'expert-hierarchy',
      pending: false,
    })).toEqual({ status: 'blocked' });
    expect(buildAtelierProjectCreateIntent({
      goal: 'build',
      intentPreset: 'work',
      model: 'openrouter-3o',
      runKind: 'agents',
      flowId: 'expert-hierarchy',
      pending: true,
    })).toEqual({ status: 'blocked' });
  });

  it('rejects non-generated presets, run kinds, models, and flow ids', () => {
    const base = {
      goal: 'build',
      intentPreset: 'work',
      model: 'openrouter-3o',
      runKind: 'agents',
      flowId: 'expert-hierarchy',
      pending: false,
    };
    expect(buildAtelierProjectCreateIntent({ ...base, intentPreset: 'shell' })).toEqual({ status: 'invalid' });
    expect(buildAtelierProjectCreateIntent({ ...base, runKind: 'execute' })).toEqual({ status: 'invalid' });
    expect(buildAtelierProjectCreateIntent({ ...base, model: 'local-shell' })).toEqual({ status: 'invalid' });
    expect(buildAtelierProjectCreateIntent({ ...base, flowId: 'run-file' })).toEqual({ status: 'invalid' });
  });

  it('rejects execution-shaped project create payload actions', () => {
    expect(ATELIER_PROJECT_CREATE_FORBIDDEN_ACTIONS).toEqual(['invoke', 'execute', 'run', 'shell', 'file']);
    expect(containsForbiddenAtelierProjectCreatePayloadActions({ shell: 'pnpm test' })).toBe(true);
    expect(buildAtelierProjectCreateIntent({
      goal: 'build',
      intentPreset: 'work',
      model: 'openrouter-3o',
      runKind: 'model',
      flowId: 'expert-hierarchy',
      pending: false,
      extraPayload: { execute: true },
    })).toEqual({ status: 'invalid' });
  });

  it('omits flowId from DirectRun model project create intent', () => {
    expect(buildAtelierProjectCreateIntent({
      goal: 'ask one model',
      intentPreset: 'work',
      model: 'gpt-5',
      runKind: 'model',
      flowId: 'expert-hierarchy',
      pending: false,
    })).toEqual({
      status: 'ready',
      intent: {
        goal: 'ask one model',
        intentPreset: 'work',
        model: 'gpt-5',
        runKind: 'model',
      },
      submitKey: JSON.stringify({
        goal: 'ask one model',
        intentPreset: 'work',
        model: 'gpt-5',
        runKind: 'model',
      }),
    });
  });

  it('ignores flow ids for DirectRun model project create intent', () => {
    expect(buildAtelierProjectCreateIntent({
      goal: 'ask one model',
      intentPreset: 'work',
      model: 'gpt-5',
      runKind: 'model',
      flowId: 'run-file',
      pending: false,
    })).toEqual({
      status: 'ready',
      intent: {
        goal: 'ask one model',
        intentPreset: 'work',
        model: 'gpt-5',
        runKind: 'model',
      },
      submitKey: JSON.stringify({
        goal: 'ask one model',
        intentPreset: 'work',
        model: 'gpt-5',
        runKind: 'model',
      }),
    });
  });
});
