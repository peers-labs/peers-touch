import {
  AgentGoalStatus,
  type AgentGoal,
} from '../gen/proto/domain/agent/goal_pb';
import { api } from './desktop_api';

export interface GoalCancellationPort {
  cancelAgentGoal(input: {
    goalId: string;
    expectedRevision: bigint;
    idempotencyKey: string;
  }): Promise<AgentGoal>;
  getAgentGoal(goalId: string): Promise<AgentGoal>;
}

const activeGoalStatuses = new Set<AgentGoalStatus>([
  AgentGoalStatus.RUNNING,
  AgentGoalStatus.NEEDS_USER,
  AgentGoalStatus.REPLANNING,
  AgentGoalStatus.RECOVERING,
]);

export async function cancelActiveGoal(
  goal: AgentGoal,
  idempotencyKey: string,
  port: GoalCancellationPort = api,
): Promise<AgentGoal> {
  if (!activeGoalStatuses.has(goal.status)) {
    throw new Error('agent.home.goalNotCancellable');
  }
  if (!goal.goalId || goal.revision <= 0n || !idempotencyKey.trim()) {
    throw new Error('agent.home.goalContractMissing');
  }

  const acknowledgement = await port.cancelAgentGoal({
    goalId: goal.goalId,
    expectedRevision: goal.revision,
    idempotencyKey,
  });
  const readback = await port.getAgentGoal(goal.goalId);
  if (
    acknowledgement.status !== AgentGoalStatus.CANCELLED
    || readback.goalId !== goal.goalId
    || readback.status !== AgentGoalStatus.CANCELLED
    || readback.revision !== acknowledgement.revision
  ) {
    throw new Error('agent.home.goalCancelReadbackInvalid');
  }
  return readback;
}
