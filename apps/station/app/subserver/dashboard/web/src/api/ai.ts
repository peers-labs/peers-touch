import { controlPlanePost } from './client';
import { t } from '../i18n';

// Agent's protobuf JSON contract uses snake_case and string int64 revisions.
export type Revision = string | number;
export interface RuntimeConfig {
  default_model: string;
  startup_args: string[];
  environment: Record<string, string>;
  timeout_seconds: number;
}
export interface Provider {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
  protocol: string;
  runtime_kind: string;
  base_url: string;
  credential_status: string;
  version: Revision;
  models: ModelInfo[];
  runtime_config?: RuntimeConfig;
  adapter_capabilities?: {
    model_discovery: boolean;
    startup_args: boolean;
    environment: boolean;
    configurable_timeout: boolean;
  };
  install_state: string;
  install_supported: boolean;
  manual_install_url: string;
  show_api_key: boolean;
  api_key_url: string;
  home_url: string;
}
export interface ModelInfo {
  id: string;
  display_name: string;
  type: string;
  enabled: boolean;
  context_window: number;
  capabilities?: { flags: Record<string, boolean> };
}
export interface ModelRecord {
  model_id: string;
  display_name: string;
  version: Revision;
  enabled: boolean;
  context_window: number;
  capabilities?: { flags: Record<string, boolean> };
}
export interface Grant {
  all_actors: boolean;
  actor_ptid: string;
  all_models: boolean;
  model_id: string;
}
export interface Access { provider_id: string; revision: Revision; grants: Grant[] }
export interface AIUserAccess { all_actors: boolean; actor_ptids: string[] }
export interface Policy { personal_providers_enabled: boolean; revision: Revision; ai_user_access: AIUserAccess }
export interface Credential { configured: boolean; status: string; version: Revision }
export interface Install {
  install_state: string;
  job_id?: string;
  phase?: string;
  percent?: number;
  error?: string;
  install_supported: boolean;
  manual_install_url: string;
  installed_version?: string;
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  return controlPlanePost<T>(`/ai/${path}`, body);
}
export const ai = {
  list: () => post<{ providers: Provider[] }>('provider/list'),
  get: (provider_id: string) => post<{ provider: Provider }>('provider/get', { provider_id }),
  create: (body: { provider_id: string; display_name: string; base_url: string; protocol: string }) =>
    post<{ provider: Provider }>('provider/create', body),
  update: (provider_id: string, version: Revision, body: {
    display_name?: string; base_url?: string; enabled?: boolean; runtime_config?: RuntimeConfig;
  }) => post<{ provider: Provider }>('provider/update', { provider_id, version, ...body }),
  remove: (provider_id: string, version: Revision) => post('provider/delete', { provider_id, version }),
  models: (provider_id: string) => post<{ models: ModelRecord[] }>('model/list', { provider_id }),
  createModel: (provider_id: string, model: Omit<ModelInfo, 'id' | 'type'> & { model_id: string }) =>
    post('model/create', { provider_id, ...model }),
  updateModel: (provider_id: string, model_id: string, version: Revision, body: {
    display_name?: string; enabled?: boolean; context_window?: number; capabilities?: ModelInfo['capabilities'];
  }) => post('model/update', { provider_id, model_id, version, ...body }),
  discover: (provider_id: string) => post('model/discover', { provider_id }),
  verify: (provider_id: string, model_id: string, actor_ptid: string) =>
    post<{ response_received: boolean; observed_at: { seconds: string } }>('model/verify', { provider_id, model_id, actor_ptid }),
  credential: (provider_id: string) => post<{ status: Credential }>('credential/status', { provider_id }),
  setCredential: (provider_id: string, api_key: string) => post('credential/set', { provider_id, api_key }),
  deleteCredential: (provider_id: string, version: Revision) => post('credential/delete', { provider_id, version }),
  policy: () => post<{ policy: Policy }>('policy/get'),
  setPolicy: (policy: Policy) => post<{ policy: Policy }>('policy/set', policy),
  access: (provider_id: string) => post<{ access: Access }>('access/get', { provider_id }),
  setAccess: (access: Access) => post<{ access: Access }>('access/set', access),
  install: (provider_id: string) => post<Install>('install/start', { provider_id }),
  installStatus: (provider_id: string) => post<Install>('install/status', { provider_id }),
};

export function aiError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string; error?: string } } }).response;
  if (response?.status === 409) return t('error.conflict');
  if (response?.status === 403) return response.data?.message || response.data?.error || t('error.adminRequired');
  return response?.data?.message || response?.data?.error || t('error.retry');
}
