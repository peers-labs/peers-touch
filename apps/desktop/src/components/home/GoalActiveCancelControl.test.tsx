import { create } from '@bufbuild/protobuf';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  AgentGoalStatus,
  AgentGoalSchema,
  type AgentGoal,
} from '../../gen/proto/domain/agent/goal_pb';
import {
  cancelActiveGoal,
  type GoalCancellationPort,
} from '../../services/goal-service';

const controlSource = readFileSync(
  fileURLToPath(new URL('./GoalActiveCancelControl.tsx', import.meta.url)),
  'utf8',
);
const progressSource = readFileSync(
  fileURLToPath(new URL('./GoalProgressPanel.tsx', import.meta.url)),
  'utf8',
);

function goal(status: AgentGoalStatus, revision = 7n): AgentGoal {
  return create(AgentGoalSchema, {
    goalId: 'goal-active',
    ownerPtid: 'ptid:actor-1',
    title: 'Stop active work',
    outcome: 'Preserve accepted evidence',
    status,
    revision,
  });
}

describe('GoalActiveCancelControl', () => {
  it('is mounted on active Goal progress and exposes the pending state', () => {
    expect(progressSource).toContain('<GoalActiveCancelControl');
    for (const status of ['RUNNING', 'NEEDS_USER', 'REPLANNING', 'RECOVERING']) {
      expect(controlSource).toContain(`AgentGoalStatus.${status}`);
    }
    expect(controlSource).toContain(
      'data-pt-home-goal-active-cancellation-state',
    );
    expect(controlSource).toContain("'CANCELLING'");
    expect(controlSource).toContain('data-pt-home-goal-active-cancel-error');
  });

  it('waits for authoritative cancelled readback', async () => {
    const running = goal(AgentGoalStatus.RUNNING);
    const acknowledgement = goal(AgentGoalStatus.CANCELLED, 8n);
    let resolveCommand!: (value: AgentGoal) => void;
    let resolveReadback!: (value: AgentGoal) => void;
    const port: GoalCancellationPort = {
      cancelAgentGoal: vi.fn(() => new Promise<AgentGoal>((resolve) => {
        resolveCommand = resolve;
      })),
      getAgentGoal: vi.fn(() => new Promise<AgentGoal>((resolve) => {
        resolveReadback = resolve;
      })),
    };

    const pending = cancelActiveGoal(
      running,
      'goal-active-cancel-key',
      port,
    );
    expect(port.cancelAgentGoal).toHaveBeenCalledWith({
      goalId: running.goalId,
      expectedRevision: 7n,
      idempotencyKey: 'goal-active-cancel-key',
    });
    expect(port.getAgentGoal).not.toHaveBeenCalled();

    resolveCommand(acknowledgement);
    await vi.waitFor(() => {
      expect(port.getAgentGoal).toHaveBeenCalledWith(running.goalId);
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveReadback(acknowledgement);
    await expect(pending).resolves.toBe(acknowledgement);
  });

  it('rejects non-cancelled or mismatched Station readback', async () => {
    const running = goal(AgentGoalStatus.RUNNING);
    const acknowledgement = goal(AgentGoalStatus.CANCELLED, 8n);
    const stale = goal(AgentGoalStatus.RUNNING, 7n);
    const port: GoalCancellationPort = {
      cancelAgentGoal: vi.fn().mockResolvedValue(acknowledgement),
      getAgentGoal: vi.fn().mockResolvedValue(stale),
    };

    await expect(cancelActiveGoal(
      running,
      'goal-active-cancel-key',
      port,
    )).rejects.toThrow('agent.home.goalCancelReadbackInvalid');
  });
});
