import type { ToolExecutor, ToolExecutionRequest, ToolExecutionResult } from './types';

class ToolExecutorRegistry {
  private executors = new Map<string, ToolExecutor>();

  register(executor: ToolExecutor): void {
    this.executors.set(executor.name, executor);
  }

  get(name: string): ToolExecutor | undefined {
    return this.executors.get(name);
  }

  has(name: string): boolean {
    return this.executors.has(name);
  }

  names(): string[] {
    return Array.from(this.executors.keys());
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const executor = this.executors.get(request.toolName);
    if (!executor) {
      return {
        turnId: request.turnId,
        callId: request.callId,
        content: `Tool '${request.toolName}' is not available`,
        isError: true,
      };
    }

    try {
      const args = JSON.parse(request.arguments) as Record<string, unknown>;
      return await executor.execute(args, request);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown execution error';
      return {
        turnId: request.turnId,
        callId: request.callId,
        content: message,
        isError: true,
      };
    }
  }
}

export const toolRegistry = new ToolExecutorRegistry();
