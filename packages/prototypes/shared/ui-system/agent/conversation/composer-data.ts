/**
 * Deterministic composer catalogs: workspace grants and the provider/model
 * directory. Local prototype data mirroring the production
 * WorkspaceSelector + model picker vocabulary without Station calls.
 */

export interface WorkspaceChoice {
  id: string;
  label: string;
  detail: string;
  kind: 'local' | 'sandbox';
}

export const WORKSPACE_CHOICES: readonly WorkspaceChoice[] = [
  {
    id: 'workspace-local',
    label: '本机 · agent-task-workbench-20261102',
    detail: '/home/shuxian/peers-some/worktrees/agent-task-workbench-20261102',
    kind: 'local',
  },
  {
    id: 'workspace-sandbox',
    label: '远端沙箱 · Station /workspace',
    detail: '隔离网络，无本地 shell 授权',
    kind: 'sandbox',
  },
];

export interface ModelChoice {
  id: string;
  label: string;
  provider: string;
  kind: 'direct' | 'cli';
  usable: boolean;
}

export interface ProviderGroup {
  id: string;
  label: string;
  models: ModelChoice[];
}

export const PROVIDER_GROUPS: readonly ProviderGroup[] = [
  {
    id: 'provider-direct',
    label: 'Direct Providers',
    models: [
      { id: 'seed21-pro', label: 'Seed2.1-Pro', provider: 'OpenAI-compatible', kind: 'direct', usable: true },
      { id: 'seed21-lite', label: 'Seed2.1-Lite', provider: 'OpenAI-compatible', kind: 'direct', usable: true },
      { id: 'embedding-v3', label: 'text-embedding-3', provider: 'OpenAI-compatible', kind: 'direct', usable: false },
    ],
  },
  {
    id: 'provider-cli',
    label: 'CLI Adapters',
    models: [
      { id: 'codex-default', label: 'codex · default', provider: 'Codex CLI', kind: 'cli', usable: true },
    ],
  },
];

export const DEFAULT_MODEL_ID = 'seed21-pro';

/** Local capabilities relaxed by an explicit Full Access grant. */
export const FULL_ACCESS_CAPABILITIES: readonly string[] = [
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.edit',
  'shell.execute',
  'shell.allowlist',
];
