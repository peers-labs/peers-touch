import type {
  AgentCreate,
  AvailableModel,
} from '../../../services/desktop_api';

export interface AgentCreateFormValues {
  avatar: string;
  description?: string;
  effort: string;
  model?: string;
  name: string;
  openingMessage?: string;
  openingQuestions?: string;
  pinned: boolean;
  provider?: string;
  systemPrompt?: string;
  title?: string;
  visibility: 'private' | 'workspace';
}

export const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULT_AGENT_CREATE_VALUES: AgentCreateFormValues = {
  avatar: '🤖',
  effort: 'medium',
  name: '',
  pinned: false,
  visibility: 'private',
};

export const AGENT_AVATAR_OPTIONS = [
  '🤖',
  '🧠',
  '💻',
  '🎯',
  '🚀',
  '🔬',
  '📊',
  '🎨',
  '🛠️',
  '📝',
  '🌐',
  '💡',
].map((avatar) => ({ label: avatar, value: avatar }));

export function buildAgentCreateInput(
  values: AgentCreateFormValues,
  availableModels: AvailableModel[],
): AgentCreate {
  const name = values.name.trim();
  const openingQuestions = (values.openingQuestions ?? '')
    .split('\n')
    .map((question) => question.trim())
    .filter(Boolean);
  const selectedModel = availableModels.find(
    (model) => model.id === values.model,
  );
  return {
    name,
    title: values.title?.trim() || name,
    description: values.description?.trim() || '',
    avatar: values.avatar,
    systemPrompt: values.systemPrompt?.trim() || '',
    provider:
      values.provider?.trim()
      || selectedModel?.provider_id
      || '',
    model: values.model || '',
    effort: values.effort,
    visibility: values.visibility,
    pinned: values.pinned,
    openingMessage: values.openingMessage?.trim() || '',
    openingQuestions: JSON.stringify(openingQuestions),
    workspaceMode: 'agent',
  };
}
