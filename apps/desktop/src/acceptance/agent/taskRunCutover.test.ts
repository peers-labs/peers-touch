import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  CollaborationTaskStatus,
  CreateTaskRunRequestSchema,
  TaskSurface,
} from '../../gen/proto/domain/agent/orchestration_pb';

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

describe('PAOS-13 TaskRun writer cutover', () => {
  it('generates one typed canonical writer contract', () => {
    const request = create(CreateTaskRunRequestSchema, {
      title: 'Prepare the launch brief',
      description: 'Prepare the launch brief',
      agentId: 'agent-1',
      surface: TaskSurface.DIRECT_RUN,
      initialStatus: CollaborationTaskStatus.RUNNING,
      clientIdempotencyKey: 'home-task-1',
      commandPayloadHash: 'payload-1',
      sourceRef: 'topic-1',
      meta: { entrypoint: 'home' },
    });

    expect(request.surface).toBe(TaskSurface.DIRECT_RUN);
    expect(request.initialStatus).toBe(CollaborationTaskStatus.RUNNING);
    expect(request.clientIdempotencyKey).toBe('home-task-1');
  });

  it('routes Home and Chat promotion through the same TaskRun writer', () => {
    const home = read(
      '../../../../station/app/subserver/agent/service/home_command_service.go',
    );
    const handler = read(
      '../../../../station/app/subserver/agent/handler/agent_task_handler.go',
    );
    const wiring = read(
      '../../../../station/app/subserver/agent/agent.go',
    );

    expect(home).toContain('s.tasks.Create(');
    expect(home).toContain('model.CreateTaskRunRequest');
    expect(home).toContain('TASK_SURFACE_DIRECT_RUN');
    expect(handler).toContain('h.writer.Create(');
    expect(handler).toContain('TASK_SURFACE_API');
    expect(handler).toContain('entrypoint = "chat_promotion"');
    expect(wiring).toContain('taskRunCommandSvc := service.NewTaskRunCommandService');
    expect(wiring).toContain('agentTaskSvc,');
    expect(wiring).toContain('taskRunCommandSvc,');
  });

  it('removes every production AgentTask create method', () => {
    const legacyService = read(
      '../../../../station/app/subserver/agent/service/agent_task_service.go',
    );
    const handler = read(
      '../../../../station/app/subserver/agent/handler/agent_task_handler.go',
    );

    expect(legacyService).not.toContain('CreateAndStartTask(');
    expect(legacyService).not.toContain('func (s *AgentTaskService) CreateTask(');
    expect(handler).not.toContain('h.svc.CreateTask(');
  });
});
