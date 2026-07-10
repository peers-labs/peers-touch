import {
  ATELIER_AGENT_FLOW_IDS,
  ATELIER_DEFAULT_AGENT_FLOW_ID,
  ATELIER_DEFAULT_DIRECT_RUN_MODEL,
  ATELIER_DEFAULT_RUN_TARGET_KIND,
  ATELIER_DEFAULT_TASK_INTENT_PRESET,
  ATELIER_DIRECT_RUN_MODELS,
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_RUN_TARGET_KINDS,
  ATELIER_TASK_INTENT_PRESETS,
  type AtelierAgentFlowId,
  type AtelierDirectRunModel,
  type AtelierRunTargetKind,
} from '../domain/projection.contract.generated';

const PROJECT_CREATE_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'];

export const ATELIER_PROJECT_CREATE_REQUIRED_FIELDS = PROJECT_CREATE_PAYLOAD.requiredFields;
export const ATELIER_PROJECT_CREATE_OPTIONAL_FIELDS = PROJECT_CREATE_PAYLOAD.optionalFields;
export const ATELIER_PROJECT_CREATE_FORBIDDEN_ACTIONS = PROJECT_CREATE_PAYLOAD.directRunIntent.forbiddenActions;

interface BaseAtelierProjectCreateIntent {
  goal: string;
  intentPreset: typeof ATELIER_TASK_INTENT_PRESETS[number];
  model: AtelierDirectRunModel;
  runKind: AtelierRunTargetKind;
  project?: string;
}

export type AtelierProjectCreateIntent =
  | (BaseAtelierProjectCreateIntent & { runKind: 'agents'; flowId: AtelierAgentFlowId })
  | (BaseAtelierProjectCreateIntent & { runKind: 'model' });

export type AtelierProjectCreateIntentResult =
  | { status: 'ready'; intent: AtelierProjectCreateIntent; submitKey: string }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierProjectCreateIntent(input: {
  goal: string;
  intentPreset: string;
  model: string;
  runKind: string;
  flowId: string;
  project?: string;
  pending: boolean;
  extraPayload?: Record<string, unknown>;
}): AtelierProjectCreateIntentResult {
  const goal = input.goal.trim();
  if (!goal || input.pending) return { status: 'blocked' };
  if (containsForbiddenAtelierProjectCreatePayloadActions(input.extraPayload)) return { status: 'invalid' };

  const intentPreset = input.intentPreset.trim() || ATELIER_DEFAULT_TASK_INTENT_PRESET;
  const runKind = input.runKind.trim() || ATELIER_DEFAULT_RUN_TARGET_KIND;
  const model = input.model.trim() || ATELIER_DEFAULT_DIRECT_RUN_MODEL;
  const flowId = input.flowId.trim() || ATELIER_DEFAULT_AGENT_FLOW_ID;
  const project = input.project?.trim();
  if (
    !isAtelierTaskIntentPreset(intentPreset) ||
    !isAtelierRunTargetKind(runKind) ||
    !isAtelierDirectRunModel(model)
  ) {
    return { status: 'invalid' };
  }
  const agentFlowId: AtelierAgentFlowId | undefined = runKind === 'model'
    ? undefined
    : isAtelierAgentFlowId(flowId)
      ? flowId
      : undefined;
  if (runKind === 'model') {
    const intent: AtelierProjectCreateIntent = {
      goal,
      intentPreset,
      model,
      runKind,
      ...(project ? { project } : {}),
    };
    return {
      status: 'ready',
      intent,
      submitKey: JSON.stringify(intent),
    };
  }
  if (!agentFlowId) {
    return { status: 'invalid' };
  }
  const intent: AtelierProjectCreateIntent = {
    goal,
    intentPreset,
    model,
    runKind,
    flowId: agentFlowId,
    ...(project ? { project } : {}),
  };
  return {
    status: 'ready',
    intent,
    submitKey: JSON.stringify(intent),
  };
}

export function containsForbiddenAtelierProjectCreatePayloadActions(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  const forbidden = new Set<string>(ATELIER_PROJECT_CREATE_FORBIDDEN_ACTIONS);
  return Object.keys(payload).some((field) => forbidden.has(field));
}

export function isAtelierTaskIntentPreset(value: string): value is typeof ATELIER_TASK_INTENT_PRESETS[number] {
  return (ATELIER_TASK_INTENT_PRESETS as readonly string[]).includes(value);
}

export function isAtelierRunTargetKind(value: string): value is AtelierRunTargetKind {
  return (ATELIER_RUN_TARGET_KINDS as readonly string[]).includes(value);
}

export function isAtelierDirectRunModel(value: string): value is AtelierDirectRunModel {
  return (ATELIER_DIRECT_RUN_MODELS as readonly string[]).includes(value);
}

export function isAtelierAgentFlowId(value: string): value is AtelierAgentFlowId {
  return (ATELIER_AGENT_FLOW_IDS as readonly string[]).includes(value);
}
