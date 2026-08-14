import type { ToolApprovalPolicy, ToolExecutionRequest } from './types';
import { useAgentStore } from '../agent';

const DEFAULT_POLICIES: Record<string, ToolApprovalPolicy> = {
  file_read: 'auto',
  list_dir: 'auto',
  clipboard_read: 'ask',
  shell: 'ask',
  oauth_resource: 'auto',
};

export function getToolApprovalPolicy(toolName: string): ToolApprovalPolicy {
  const agentConfig = useAgentStore.getState();
  const tools = (agentConfig as unknown as { toolPolicies?: Record<string, ToolApprovalPolicy> }).toolPolicies;
  if (tools && tools[toolName]) {
    return tools[toolName];
  }
  return DEFAULT_POLICIES[toolName] || 'ask';
}

export function shouldAutoApprove(request: ToolExecutionRequest): boolean {
  return getToolApprovalPolicy(request.toolName) === 'auto';
}

export function shouldDeny(request: ToolExecutionRequest): boolean {
  return getToolApprovalPolicy(request.toolName) === 'deny';
}
