import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

describe('PAOS-J01 Goal admission source journey', () => {
  it('admits the reviewed revision before starting the admitted revision', () => {
    const runtime = read('../../runtimes/homeRuntime.ts');
    const admitCall = runtime.indexOf('await api.admitAgentGoal');
    const startCall = runtime.indexOf('await api.startAgentGoal');

    expect(admitCall).toBeGreaterThan(-1);
    expect(startCall).toBeGreaterThan(admitCall);
    expect(runtime).toContain('expectedRevision: state.baseRevision');
    expect(runtime).toContain('AgentGoalStatus.REVIEWING');
    expect(runtime).toContain('AgentGoalStatus.READY');
  });

  it('renders assumptions, rejection, and running readback states', () => {
    const panel = read('../../components/home/GoalReviewPanel.tsx');

    expect(panel).toContain('data-pt-home-goal-assumption');
    expect(panel).toContain('data-pt-home-goal-admission-error');
    expect(panel).toContain('data-pt-home-goal-start');
    expect(panel).toContain('data-pt-home-goal-running');
    expect(panel).toContain('goal.revision.toString()');
  });

  it('keeps TaskRun creation outside Goal admission', () => {
    const admission = read(
      '../../../../station/app/subserver/agent/service/goal_admission_service.go',
    );

    expect(admission).toContain('AGENT_GOAL_STATUS_READY');
    expect(admission).toContain('AGENT_GOAL_STATUS_RUNNING');
    expect(admission).not.toContain('TaskRun');
  });
});
