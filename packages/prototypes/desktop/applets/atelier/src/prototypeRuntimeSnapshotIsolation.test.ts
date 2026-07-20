import { describe, expect, it } from 'vitest';

import { MOCK } from './mock';
import { createMockAtelierRuntime } from './runtime';

describe('prototype runtime snapshot isolation', () => {
  it('keeps getSnapshot state and status isolated from external mutations', () => {
    const runtime = createMockAtelierRuntime();
    const exposed = runtime.getSnapshot();
    const originalTaskTitle = exposed.state.tasks[0].title;
    const originalStatusKind = exposed.status?.kind;

    exposed.state.tasks[0].title = 'Externally mutated task title';
    if (exposed.status) {
      exposed.status.kind = 'auth-denied';
      exposed.status.title = 'Externally mutated';
      exposed.status.detail = 'External mutation should not leak back';
      exposed.status.retryable = false;
    }

    const next = runtime.getSnapshot();
    expect(next.state.tasks[0].title).toBe(originalTaskTitle);
    expect(next.status?.kind).toBe(originalStatusKind);
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
  });

  it('keeps runtime state isolated from seed mutations after construction', () => {
    const seed = JSON.parse(JSON.stringify(MOCK)) as typeof MOCK;
    const runtime = createMockAtelierRuntime(seed);
    const originalTaskTitle = runtime.getSnapshot().state.tasks[0].title;

    seed.tasks[0].title = 'Externally mutated seed task title';
    seed.tasks.push({ id: 'seed-mutated-task', project: 'atelier', title: 'Seed mutation', status: 'active' });
    seed.selectedTaskId = 'seed-mutated-task';

    const next = runtime.getSnapshot();
    expect(next.state.tasks[0].title).toBe(originalTaskTitle);
    expect(next.state.tasks.some((task) => task.id === 'seed-mutated-task')).toBe(false);
    expect(next.selectedTaskId).not.toBe('seed-mutated-task');
  });

  it('keeps async returned snapshots isolated from external mutations', async () => {
    const runtime = createMockAtelierRuntime();
    const returned = await runtime.setModel('claude-sonnet-4.5');

    returned.state.tasks[0].title = 'Externally mutated async return';
    if (returned.status) {
      returned.status.kind = 'error';
      returned.status.title = 'Externally mutated async status';
      returned.status.detail = 'Async return mutation should not leak back';
      returned.status.retryable = true;
    }

    const next = runtime.getSnapshot();
    expect(next.state.model).toBe('claude-sonnet-4.5');
    expect(next.state.tasks[0].title).not.toBe('Externally mutated async return');
    expect(next.status?.kind).toBe('ready');
  });

  it('keeps transition-owned state isolated from returned projection mutations', async () => {
    const runtime = createMockAtelierRuntime();
    const taskId = runtime.getSnapshot().selectedTaskId;
    const returned = await runtime.sendMessage({
      taskId,
      text: 'Draft a transition-owned projection update',
    });
    const returnedBlock = returned.state.stream[taskId].find((block) =>
      block.kind === 'user' && block.text === 'Draft a transition-owned projection update'
    );
    expect(returnedBlock).toBeDefined();

    returnedBlock!.text = 'Externally mutated transition return';
    returned.state.stream[taskId].push({
      kind: 'agent',
      id: 'external-transition-mutation',
      text: 'External mutation should not be runtime-owned',
      at: '00:00',
      done: true,
    });

    const next = runtime.getSnapshot();
    expect(next.state.stream[taskId].some((block) =>
      block.kind === 'user' && block.text === 'Draft a transition-owned projection update'
    )).toBe(true);
    expect(next.state.stream[taskId].some((block) => block.id === 'external-transition-mutation')).toBe(false);
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
  });
});
