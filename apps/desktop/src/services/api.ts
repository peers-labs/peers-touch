import { invoke } from '@tauri-apps/api/core';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export type RustErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface RustCommandError {
  code: RustErrorCode;
  message: string;
  details?: Record<string, any>;
}

export interface RustCommandResult<T = Record<string, any>> {
  ok: boolean;
  data?: T;
  error?: RustCommandError;
}

async function invokeRustCommand<TInput, TData>(
  command: string,
  input?: TInput,
): Promise<RustCommandResult<TData>> {
  try {
    const payload = input === undefined ? undefined : { input };
    const result = await invoke<RustCommandResult<TData>>(command, payload);
    return result;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export class AuthCommandException extends Error {
  code: RustErrorCode;
  details?: Record<string, any>;

  constructor(error: RustCommandError) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
    this.name = 'AuthCommandException';
  }
}

async function invokeAuthCommand<TInput>(
  command: string,
  input?: TInput,
): Promise<TauriStubPayload> {
  const response = await invokeRustCommand<TInput, TauriStubPayload>(command, input);
  if (!response.ok || !response.data) {
    throw new AuthCommandException(
      response.error ?? {
        code: 'INTERNAL_ERROR',
        message: 'auth command failed',
      },
    );
  }
  return response.data;
}

export interface Session {
  id: string;
  key: string;
  agent_name: string;
  title: string;
  message_count: number;
  model_override?: string;
  created_at: string;
  updated_at: string;
}

export interface MessageAttachment {
  type: string;
  url: string;
  mime_type: string;
  filename?: string;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  content_type?: 'text' | 'card';
  attachments?: MessageAttachment[];
  model?: string;
  created_at: string;
  tool_calls?: string;
}

export interface AgentParams {
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
}

export interface AgentMemoryConfig {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high';
}

export interface AgentChatConfig {
  historyCount?: number;
  enableHistoryCount?: boolean;
  enableAutoCreateTopic?: boolean;
  autoCreateTopicThreshold?: number;
  enableMaxTokens?: boolean;
  enableStreaming?: boolean;
  enableContextCompression?: boolean;
  compressionModelId?: string;
  searchMode?: 'off' | 'auto' | 'on';
  useModelBuiltinSearch?: boolean;
  memory?: AgentMemoryConfig;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  description: string;
  avatar: string;
  backgroundColor: string;
  systemPrompt: string;
  model: string;
  provider: string;
  tags: string;
  toolsProfile: string;
  toolsAllow: string;
  toolsDeny: string;
  pinned: boolean;
  openingMessage: string;
  openingQuestions: string;
  chatConfig: string;
  params: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCreate {
  name: string;
  title?: string;
  description?: string;
  avatar?: string;
  backgroundColor?: string;
  systemPrompt?: string;
  model?: string;
  provider?: string;
  tags?: string;
  toolsProfile?: string;
  pinned?: boolean;
  openingMessage?: string;
  openingQuestions?: string;
  chatConfig?: string;
  params?: string;
}

export function parseAgentChatConfig(agent: Agent): AgentChatConfig {
  if (!agent.chatConfig) return {};
  try { return JSON.parse(agent.chatConfig); } catch { return {}; }
}

export function parseAgentParams(agent: Agent): AgentParams {
  if (!agent.params) return {};
  try { return JSON.parse(agent.params); } catch { return {}; }
}

export interface ToolInfo {
  name: string;
  category: string;
  needs_approval: boolean;
}

export interface AvailableModel {
  id: string;
  display_name: string;
  provider_id: string;
  provider_name: string;
  type: string;
  context_window: number;
  enabled: boolean;
  function_call?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}

export interface ProviderListItem {
  id: string;
  name: string;
  description: string;
  logo?: string;
  enabled: boolean;
  builtin: boolean;
  has_api_key: boolean;
}

export interface ModelItem {
  id: string;
  display_name: string;
  type: string;
  enabled: boolean;
  context_window: number;
  function_call?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  search?: boolean;
  image_output?: boolean;
  video?: boolean;
}

export interface ProviderDetail extends ProviderListItem {
  home_url: string;
  api_key_url: string;
  api_key: string;
  base_url: string;
  default_base_url: string;
  show_checker: boolean;
  check_model?: string;
  models: ModelItem[];
}

export interface HelpItem {
  id: string;
  category: string;
  title: string;
  description: string;
  usage?: string;
  icon?: string;
  source: string;
  applet_id?: string;
}

export interface HelpCategoryMeta {
  id: string;
  title: string;
  icon?: string;
  description?: string;
}

export interface HelpCategoryGroup {
  category: HelpCategoryMeta;
  items: HelpItem[];
}

export interface OnboardingState {
  completed: boolean;
  language: string;
  interests: string[];
}

// Setup Wizard types
export type WizardStepType = 'welcome' | 'oauth_login' | 'provider_select' | 'form' | 'action' | 'complete';

export interface WizardFieldOption {
  value: string;
  label: string;
  icon?: string;
  desc?: string;
}

export interface WizardField {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: WizardFieldOption[];
  default?: string;
  hint?: string;
  placeholder?: string;
}

export interface WizardAPI {
  api: string;
  body?: Record<string, any>;
  optional?: boolean;
}

export interface WizardFeature {
  icon: string;
  title: string;
  desc: string;
}

export interface WizardStep {
  id: string;
  type: WizardStepType;
  title: string;
  desc?: string;
  required: boolean;
  config?: Record<string, any>;
  fields?: WizardField[];
  on_submit?: WizardAPI[];
  actions?: WizardAPI[];
  summary?: string[];
  features?: WizardFeature[];
}

export interface WizardConfig {
  id: string;
  name: string;
  version: string;
  branding: {
    title: string;
    subtitle: string;
    logo?: string;
    primary_color?: string;
  };
  steps: WizardStep[];
}

export interface WizardResponse {
  available: boolean;
  config?: WizardConfig;
}

export interface WizardState {
  wizard_id: string;
  current_step: string;
  completed: boolean;
  context: Record<string, any>;
  started_at?: string;
  completed_at?: string;
}

export interface AppletManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  capabilities: string[];
  permissions: string[];
  config_schema?: Record<string, any>;
}

export interface AppletInfo {
  manifest: AppletManifest;
  status: 'installed' | 'active' | 'stopped' | 'error';
  error?: string;
}

export interface StatisticsRankItem {
  name: string;
  count: number;
}

export interface StatisticsActivityDay {
  date: string;
  count: number;
}

export interface StatisticsData {
  summary: {
    sessions: number;
    messages: number;
    total_words: number;
    agents: number;
    days_with_us: number;
    first_date: string;
  };
  activity: StatisticsActivityDay[];
  model_rank: StatisticsRankItem[] | null;
  agent_rank: StatisticsRankItem[] | null;
  topic_rank: StatisticsRankItem[] | null;
}

export interface SearchSource {
  id: string;
  name: string;
  icon: string;
  description?: string;
  builtin: boolean;
  applet_id?: string;
}

export interface SearchResultItem {
  id: string;
  source: string;
  title: string;
  snippet: string;
  url?: string;
  icon?: string;
  metadata?: Record<string, string>;
}

export interface SearchSourceGroup {
  source: SearchSource;
  items: SearchResultItem[];
  total: number;
}

export interface AISearchResponse {
  query: string;
  answer: string;
  web: boolean;
  sources: Array<{ title: string; source: string; url: string }>;
}

export interface TTSVoice {
  id: string;
  name: string;
  provider: string;
  language: string;
  gender: string;
}

// ── Skill types ──

export interface BuiltinSkillInfo {
  identifier: string;
  name: string;
  description: string;
  keywords: string[];
  avatar: string;
  useCount: number;
  lastUsedAt?: string;
}

export interface BuiltinSkillRecord extends BuiltinSkillInfo {
  content: string;
}

export interface SkillListItem {
  id: string;
  identifier: string;
  name: string;
  description: string;
  version: string;
  authorName: string;
  metaAvatar: string;
  metaTitle: string;
  metaTags: string[];
  source: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  useCount: number;
  lastUsedAt?: string;
}

export interface SkillRecord extends SkillListItem {
  authorUrl: string;
  license: string;
  repository: string;
  sourceUrl: string;
  permissions: string[];
  content: string;
  metaDescription: string;
  metaBackgroundColor: string;
  keywords: string[];
  globs: string[];
  agentOnly: string[];
  sourceUri: string;
  zipFileHash: string;
}

export interface SkillImportResult {
  id: string;
  identifier: string;
  name: string;
  isNew: boolean;
}

export interface SkillImportBatchResult {
  kind: 'url' | 'git';
  imported: SkillImportResult[];
  total: number;
}

export interface SkillZipValidation {
  valid: boolean;
  skillPath: string;
  skillName: string;
  skillCount: number;
  error?: string;
}

// ── Skill Market types ──

export interface MarketSource {
  id: string;
  name: string;
  url: string;
  branch?: string;
}

export interface MarketSummary extends MarketSource {
  skillCount: number;
  lastSynced?: string;
  synced: boolean;
  error?: string;
}

export interface MarketSkillEntry {
  identifier: string;
  name: string;
  description: string;
  filePath: string;
  installed: boolean;
}

export interface MarketSkillDetail extends MarketSkillEntry {
  content: string;
  version: string;
  author: string;
  authorUrl: string;
  license: string;
  keywords: string[];
  avatar: string;
  tags: string[];
}

// ── MCP Server types ──

export interface MCPServerItem {
  name: string;
  title: string;
  description: string;
  type: string;
  source: string;
  enabled: boolean;
  metaAvatar: string;
  metaTags: string[];
  toolCount: number;
}

export interface MCPServerRecord {
  name: string;
  title: string;
  description: string;
  version: string;
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  authType: string;
  authToken: string;
  authAccessToken: string;
  configSchema: any;
  settings: Record<string, string>;
  metaAvatar: string;
  metaTags: string[];
  source: string;
  homepage: string;
  repository: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookDocument {
  id: string;
  title: string;
  content: string;
  description: string;
  type: string;
  source: string;
  source_type: string;
  created_at: string;
  updated_at: string;
}

export interface NotebookDocumentWithTopic extends NotebookDocument {
  topic_id: string;
  topic_title: string;
  agent_id: string;
}

// ── Cron types ──

export interface CronJob {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: string; // 'cron' | 'interval' | 'once'
  cronExpr: string;
  intervalSec: number;
  runAt: string;
  timezone: string;
  execKind: string; // 'shell' | 'agent'
  shellCmd: string;
  agentPrompt: string;
  agentName: string;
  modelOverride: string;
  timeoutSec: number;
  deleteAfterRun: boolean;
  nextRunAt: string;
  lastRunAt: string;
  lastStatus: string;
  lastError: string;
  lastDurationMs: number;
  consecErrors: number;
  deliveryMode: string;
  deliveryChannelId: string;
  deliveryTargetId: string;
  deliveryTargetType: string;
  failureChannelId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobCreate {
  name: string;
  description?: string;
  scheduleKind: string;
  cronExpr?: string;
  intervalSec?: number;
  runAt?: string;
  timezone?: string;
  execKind: string;
  shellCmd?: string;
  agentPrompt?: string;
  agentName?: string;
  modelOverride?: string;
  timeoutSec?: number;
  deleteAfterRun?: boolean;
  deliveryMode?: string;
  deliveryChannelId?: string;
  deliveryTargetId?: string;
  deliveryTargetType?: string;
  failureChannelId?: string;
}

// ── Model Service types ──

export interface ModelRef {
  provider: string;
  model: string;
}

export interface ModelServiceConfig {
  default?: ModelRef;
  topicNaming?: ModelRef;
  translation?: ModelRef;
  historyCompress?: ModelRef;
  cronDefault?: ModelRef;
  agentRouter?: ModelRef;
}

export interface ModelServiceReference {
  slot: string;
  model: string;
}

// ── Channel types ──

export interface BotStatus {
  connected: boolean;
  botName?: string;
  error?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: 'telegram' | 'lark' | 'slack' | 'webhook' | 'discord';
  enabled: boolean;
  config: string;
  createdAt: string;
  updatedAt: string;
  botStatus?: BotStatus;
}

export interface ChatTarget {
  id: string;
  name: string;
  type: 'group' | 'p2p';
}

export interface ChannelEvent {
  id: string;
  channelId: string;
  direction: 'inbound' | 'outbound';
  phase: 'received' | 'processing' | 'replied' | 'delivered' | 'failed';
  timestamp: string;
  msgType?: string;
  msgText?: string;
  senderId?: string;
  senderName?: string;
  targetId?: string;
  targetType?: string;
  sessionId?: string;
  latencyMs?: number;
  error?: string;
  botType?: string;
}

export interface ChannelEventStats {
  totalInbound: number;
  totalOutbound: number;
  totalErrors: number;
  avgLatencyMs: number;
  todayInbound: number;
  todayOutbound: number;
}

export interface CronRun {
  id: number;
  jobId: string;
  startedAt: string;
  endedAt: string;
  status: string;
  error: string;
  output: string;
  durationMs: number;
}

export interface CronStatus {
  enabled: boolean;
  total: number;
  active: number;
  paused: number;
  nextRunAt: string;
  nextJobName: string;
}

export interface CronScheduleParsed {
  scheduleKind: string;
  cronExpr?: string;
  intervalSec?: number;
  runAt?: string;
  timezone?: string;
  name?: string;
  description?: string;
  agentPrompt?: string;
  execKind?: string;
}

export interface LogTailResponse {
  file: string;
  cursor: number;
  size: number;
  lines: string[];
  truncated: boolean;
  reset: boolean;
}

// --- User preferences ---

export interface UserPreferences {
  pinned_applets?: string[];
  wide_screen?: boolean;
  user_name?: string;
  user_avatar?: string;
  user_avatar_provider?: string;
  tts_provider?: 'browser' | 'edge' | 'openai';
  tts_voice?: string;
  tts_speed?: number;
  tts_auto_read?: boolean;
  stt_provider?: 'browser' | 'openai';
  stt_language?: string;
  stt_auto_stop?: boolean;
  web_search_enabled?: boolean;
}

export interface SearchProviderInfo {
  name: string;
  available: boolean;
  is_primary: boolean;
}

// --- OAuth2 types ---

export interface OAuth2Environment {
  id: string;
  name: string;
  authorize_url: string;
  token_url: string;
  userinfo_url?: string;
  default?: boolean;
}

export interface OAuth2ProviderSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  icon_url?: string;
  color: string;
  category: string;
  builtin: boolean;
  enabled: boolean;
  status: string;
  has_credentials: boolean;
  connected: boolean;
  callback_url: string;
  environments?: OAuth2Environment[];
  auth_hosts?: string[]; // hosts this provider can authenticate for (skill import)
}

export interface OAuth2ProviderDetail {
  id: string;
  name: string;
  description: string;
  icon: string;
  icon_url?: string;
  color: string;
  category: string;
  builtin: boolean;
  enabled: boolean;
  oauth2: {
    authorize_url: string;
    token_url: string;
    revoke_url?: string;
    userinfo_url?: string;
    scopes: string[];
    pkce: boolean;
    [key: string]: unknown;
  };
  resources?: Record<string, {
    name: string;
    description: string;
    endpoint: string;
    method: string;
  }>;
  page_template?: {
    title?: string;
    subtitle?: string;
    features?: Array<{ icon: string; title: string; description: string }>;
    disclaimer?: string;
  };
}

export interface OAuth2Connection {
  provider_id: string;
  provider_name: string;
  user_id: string;
  user_name: string;
  email: string;
  avatar_url: string;
  profile_url: string;
  connected_at: string;
  expires_at?: string;
  scopes: string[];
  status: 'active' | 'expired' | 'error';
}

export interface SimulateLoginStart {
  session_id: string;
  qr_value: string;
  expires_in: number;
}

export interface LarkBotCredentials {
  app_id: string;
  app_secret: string;
  app_name?: string;
  /** When true, user must publish the app in Lark console before WebSocket will work */
  publish_required?: boolean;
}

export interface SimulateLoginPoll {
  status: 'pending' | 'success' | 'expired' | 'error' | 'not_found';
  connection?: OAuth2Connection;
  bot?: LarkBotCredentials;
  /** Channel ID when bot was created and persisted */
  channel_id?: string;
  error?: string;
}

// ── Memory types ──

export interface Memory {
  id: string;
  layer: 'identity' | 'context' | 'experience' | 'preference' | 'activity';
  agent_id: string;
  session_id: string;
  source: 'extraction' | 'agent_tool';
  content: Record<string, any>;
  summary: string;
  relevance: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Persona {
  tagline: string;
  narrative: string;
  updated_at: string;
}

export interface MemoryStats {
  total: number;
  by_layer: Record<string, number>;
  storage_bytes: number;
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
  explain?: {
    vector_score: number;
    keyword_score: number;
    weighted_score: number;
    decay_factor?: number;
    after_decay?: number;
    after_rerank?: number;
    final_score: number;
  };
}

export interface MemoryTimeFilter {
  since?: string;
  until?: string;
  period?: '24h' | '7d' | '30d' | '90d';
}

export interface MemoryEvent {
  id: string;
  type: string;
  memory_id: string;
  session_id: string;
  agent_id: string;
  layer: string;
  detail: Record<string, any>;
  latency_ms: number;
  timestamp: string;
}

export interface ExportData {
  version: string;
  exported_at: string;
  memories: Memory[];
  persona?: Persona;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  total: number;
}

export interface TauriStubPayload {
  command: string;
  status: string;
}

export interface AuthLoginInput {
  account: string;
  password: string;
  base_url?: string;
}

export interface AuthValidateTokenInput {
  token?: string;
}

export interface SettingsGetInput {
  key: string;
}

export interface SettingsSetInput {
  key: string;
  value: any;
}

export interface ChatListMessagesInput {
  conversation_id: string;
  cursor?: string;
  limit?: number;
}

export interface ChatSendMessageInput {
  conversation_id: string;
  content: string;
  client_message_id?: string;
}

export interface ChatMarkReadInput {
  conversation_id: string;
  message_id: string;
}

export interface TimelineListInput {
  cursor?: string;
  limit?: number;
}

export interface TimelineActionInput {
  post_id: string;
  content?: string;
}

export interface ProfileUpdateInput {
  display_name?: string;
  bio?: string;
  location?: string;
}

export interface ProfilePrivacyInput {
  visibility: string;
  allow_direct_message: boolean;
}

export interface FileUploadInput {
  file_path: string;
}

export interface AdminNetworkProbeInput {
  target: string;
}

export interface AdminExecuteActionInput {
  action: string;
  payload?: Record<string, any>;
}

export const api = {
  authLogin: (input: AuthLoginInput) =>
    invokeAuthCommand<AuthLoginInput>('auth_login', input),

  authLogout: () =>
    invokeAuthCommand<void>('auth_logout'),

  authRestoreSession: () =>
    invokeAuthCommand<void>('auth_restore_session'),

  authValidateToken: (input: AuthValidateTokenInput) =>
    invokeAuthCommand<AuthValidateTokenInput>('auth_validate_token', input),

  settingsGet: (input: SettingsGetInput) =>
    invokeRustCommand<SettingsGetInput, TauriStubPayload>('settings_get', input),

  settingsSet: (input: SettingsSetInput) =>
    invokeRustCommand<SettingsSetInput, TauriStubPayload>('settings_set', input),

  settingsReset: () =>
    invokeRustCommand<void, TauriStubPayload>('settings_reset'),

  chatListConversations: () =>
    invokeRustCommand<void, TauriStubPayload>('chat_list_conversations'),

  chatListMessages: (input: ChatListMessagesInput) =>
    invokeRustCommand<ChatListMessagesInput, TauriStubPayload>('chat_list_messages', input),

  chatSendMessage: (input: ChatSendMessageInput) =>
    invokeRustCommand<ChatSendMessageInput, TauriStubPayload>('chat_send_message', input),

  chatMarkRead: (input: ChatMarkReadInput) =>
    invokeRustCommand<ChatMarkReadInput, TauriStubPayload>('chat_mark_read', input),

  timelineList: (input: TimelineListInput) =>
    invokeRustCommand<TimelineListInput, TauriStubPayload>('timeline_list', input),

  timelineLike: (input: TimelineActionInput) =>
    invokeRustCommand<TimelineActionInput, TauriStubPayload>('timeline_like', input),

  timelineComment: (input: TimelineActionInput) =>
    invokeRustCommand<TimelineActionInput, TauriStubPayload>('timeline_comment', input),

  timelineRepost: (input: TimelineActionInput) =>
    invokeRustCommand<TimelineActionInput, TauriStubPayload>('timeline_repost', input),

  profileGet: () =>
    invokeRustCommand<void, TauriStubPayload>('profile_get'),

  profileUpdate: (input: ProfileUpdateInput) =>
    invokeRustCommand<ProfileUpdateInput, TauriStubPayload>('profile_update', input),

  profileUploadAvatar: (input: FileUploadInput) =>
    invokeRustCommand<FileUploadInput, TauriStubPayload>('profile_upload_avatar', input),

  profileUploadHeader: (input: FileUploadInput) =>
    invokeRustCommand<FileUploadInput, TauriStubPayload>('profile_upload_header', input),

  profileUpdatePrivacy: (input: ProfilePrivacyInput) =>
    invokeRustCommand<ProfilePrivacyInput, TauriStubPayload>('profile_update_privacy', input),

  adminHealth: () =>
    invokeRustCommand<void, TauriStubPayload>('admin_health'),

  adminNetworkProbe: (input: AdminNetworkProbeInput) =>
    invokeRustCommand<AdminNetworkProbeInput, TauriStubPayload>('admin_network_probe', input),

  adminExecuteAction: (input: AdminExecuteActionInput) =>
    invokeRustCommand<AdminExecuteActionInput, TauriStubPayload>('admin_execute_action', input),

  health: () => request<{ status: string }>('/health'),

  listSessions: () =>
    request<{ sessions: any[] }>('/ai-chat/sessions').then((r) => (r.sessions || []).map(mapAIChatSessionToSession)),

  deleteSession: (key: string) =>
    request<void>('/ai-chat/session/delete', { method: 'POST', body: JSON.stringify({ session_id: key }) }),

  renameSession: (key: string, title: string) =>
    request<{ ok: boolean; title: string }>(`/sessions/${encodeURIComponent(key)}/title`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    }),

  duplicateSession: (key: string) =>
    request<{ ok: boolean; key: string; id: string }>(`/sessions/${encodeURIComponent(key)}/duplicate`, {
      method: 'POST',
    }),

  smartRenameSession: (key: string) =>
    request<{ ok: boolean; title: string }>(`/sessions/${encodeURIComponent(key)}/smart-rename`, {
      method: 'POST',
    }),

  setSessionModel: (key: string, model: string) =>
    request<{ ok: boolean; model: string }>(`/sessions/${encodeURIComponent(key)}/model`, {
      method: 'PUT',
      body: JSON.stringify({ model }),
    }),

  getMessages: (key: string) =>
    request<{ messages: any[] }>(`/ai-chat/messages?session_id=${encodeURIComponent(key)}`).then((r) =>
      (r.messages || []).map(mapAIChatMessageToMessage),
    ),

  deleteMessage: (id: string) =>
    request<{ ok: boolean }>('/ai-chat/message/delete', { method: 'POST', body: JSON.stringify({ message_id: id }) }),

  stopChat: (sessionKey: string) =>
    request<{ ok: boolean; stopped: boolean }>('/chat/stop', {
      method: 'POST',
      body: JSON.stringify({ session_key: sessionKey }),
    }),

  updateMessage: (id: string, content: string) =>
    request<{ ok: boolean }>(`/messages/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  listAgents: () =>
    request<{ agents: Agent[] }>('/agents').then((r) => r.agents),

  getAgent: (id: string) => request<Agent>(`/agents/${id}`),

  createAgent: (data: AgentCreate) =>
    request<Agent>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAgent: (id: string, data: Partial<AgentCreate>) =>
    request<Agent>(`/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteAgent: (id: string) =>
    request<{ ok: boolean }>(`/agents/${id}`, { method: 'DELETE' }),

  duplicateAgent: (id: string, name: string) =>
    request<Agent>(`/agents/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  searchAgents: (q: string) =>
    request<{ agents: Agent[] }>(`/agents/search?q=${encodeURIComponent(q)}`).then((r) => r.agents),

  listAgentSessions: (id: string) =>
    request<{ sessions: (Session & { agent_id?: string })[] }>(`/agents/${id}/sessions`).then((r) =>
      r.sessions.map((s) => ({ ...s, agent_name: s.agent_name ?? s.agent_id ?? '' })),
    ),

  listTools: () =>
    request<{ tools: ToolInfo[] }>('/tools').then((r) => r.tools),

  listSearchProviders: () =>
    request<{ providers: SearchProviderInfo[]; primary: string }>('/tools/search-providers'),

  setSearchPrimary: (provider: string) =>
    request<{ ok: boolean; primary: string }>('/tools/search-providers/primary', {
      method: 'PUT',
      body: JSON.stringify({ provider }),
    }),

  listAvailableModels: async () => {
    const r = await request<{ providers: any[] }>('/ai-chat/providers?page_number=1&page_size=100');
    const models: AvailableModel[] = (r.providers || []).map((p) => {
      const cfg = parseJSONSafe(p.config_json);
      const id = p.check_model || cfg.default_model || `${p.id}:default`;
      return {
        id,
        display_name: id,
        provider_id: p.id,
        provider_name: p.name || p.id,
        type: 'chat',
        context_window: 0,
        enabled: Boolean(p.enabled),
      };
    });
    return { models, default: models[0]?.id || '' };
  },

  listProviders: () =>
    request<{ providers: any[] }>('/ai-chat/providers?page_number=1&page_size=100').then((r) =>
      (r.providers || []).map(mapAIChatProviderToListItem),
    ),

  getProvider: (id: string) =>
    request<{ provider: any }>(`/ai-chat/provider/get?id=${encodeURIComponent(id)}`).then((r) =>
      mapAIChatProviderToDetail(r.provider || {}),
    ),

  updateProvider: (id: string, data: { api_key: string; base_url: string; enabled: boolean }) =>
    request<{ provider: any }>('/ai-chat/provider/update', {
      method: 'POST',
      body: JSON.stringify({
        id,
        enabled: data.enabled,
        key_vaults: JSON.stringify({ api_key: data.api_key || '' }),
        config_json: JSON.stringify({ base_url: data.base_url || '' }),
      }),
    }),

  checkProvider: (id: string, data: { api_key?: string; base_url?: string; model?: string }) =>
    request<{ ok: boolean; message?: string; error?: string }>('/ai-chat/provider/test', {
      method: 'POST',
      body: JSON.stringify({
        id,
        key_vaults: data.api_key ? JSON.stringify({ api_key: data.api_key }) : undefined,
        config_json: data.base_url ? JSON.stringify({ base_url: data.base_url, model: data.model || '' }) : undefined,
      }),
    }),

  applyPreset: (id: string) =>
    request<{ ok: boolean; provider_id: string }>(`/providers/${id}/apply-preset`, {
      method: 'POST',
    }),

  createProvider: (data: { id: string; name: string; description?: string; logo?: string; base_url: string; api_key?: string }) =>
    request<{ provider: any }>('/ai-chat/provider/new', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        description: data.description || '',
        logo: data.logo || '',
        key_vaults: JSON.stringify({ api_key: data.api_key || '' }),
        config_json: JSON.stringify({ base_url: data.base_url || '' }),
      }),
    }),

  deleteProvider: (id: string) =>
    request<{ success: boolean }>('/ai-chat/provider/delete', { method: 'POST', body: JSON.stringify({ id }) }),

  addModel: (_providerId: string, _data: { id: string; display_name?: string; type?: string; context_window?: number; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean; enabled?: boolean }) =>
    Promise.resolve({ ok: true }),

  updateModel: (_providerId: string, _modelId: string, _data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) =>
    Promise.resolve({ ok: true }),

  deleteModel: (_providerId: string, _modelId: string) =>
    Promise.resolve({ ok: true }),

  fetchRemoteModels: (_providerId: string, _data?: { api_key?: string; base_url?: string }) =>
    Promise.resolve({ ok: true, models: [] as string[] }),

  toggleModel: (_providerId: string, _modelId: string, _enabled: boolean) =>
    Promise.resolve({ ok: true }),

  toggleAllModels: (_providerId: string, _enabled: boolean) =>
    Promise.resolve({ ok: true }),

  getHelp: () =>
    request<{ categories: HelpCategoryGroup[] }>('/help').then((r) => r.categories),

  searchSources: () =>
    request<{ sources: SearchSource[] }>('/search/sources').then((r) => r.sources),

  search: (query: string, source = 'all', limit = 20) =>
    request<{ query: string; source: string; groups?: SearchSourceGroup[]; results?: SearchResultItem[]; count?: number }>(
      `/search?q=${encodeURIComponent(query)}&source=${source}&limit=${limit}`,
    ),

  aiSearch: (query: string, web = false) =>
    request<AISearchResponse>('/search/ai', {
      method: 'POST',
      body: JSON.stringify({ query, web }),
    }),

  getOnboarding: () =>
    request<OnboardingState>('/onboarding'),

  setOnboarding: (data: Partial<OnboardingState>) =>
    request<{ ok: boolean }>('/onboarding', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  resetOnboarding: () =>
    request<{ ok: boolean }>('/onboarding/reset', { method: 'POST' }),

  // Setup Wizard
  getWizard: () =>
    request<WizardResponse>('/setup/wizard'),

  getWizardState: () =>
    request<WizardState>('/setup/wizard/state'),

  saveWizardStep: (stepId: string, data: Record<string, any>) =>
    request<WizardState>('/setup/wizard/step', {
      method: 'POST',
      body: JSON.stringify({ step_id: stepId, data }),
    }),

  completeWizard: () =>
    request<WizardState>('/setup/wizard/complete', { method: 'POST' }),

  getStatistics: () =>
    request<StatisticsData>('/statistics'),

  getPreferences: () =>
    request<UserPreferences>('/preferences'),

  setPreferences: (prefs: Partial<UserPreferences>) =>
    request<{ ok: boolean }>('/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }),

  // Notebook / Documents
  listDocuments: (topicId: string) =>
    request<{ documents: NotebookDocument[] }>(`/notebooks?topic_id=${encodeURIComponent(topicId)}`).then(r => r.documents),

  getDocument: (id: string) =>
    request<NotebookDocument>(`/notebooks/${id}`),

  createDocument: (topicId: string, title: string, content: string, type?: string) =>
    request<NotebookDocument>('/notebooks', {
      method: 'POST',
      body: JSON.stringify({ topic_id: topicId, title, content, type: type || 'note' }),
    }),

  updateDocument: (id: string, title: string, content: string) =>
    request<{ ok: boolean }>(`/notebooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content }),
    }),

  deleteDocument: (id: string) =>
    request<{ ok: boolean }>(`/notebooks/${id}`, { method: 'DELETE' }),

  listAllDocuments: () =>
    request<{ documents: NotebookDocumentWithTopic[] }>('/documents').then(r => r.documents),

  // Share
  createShare: (sessionKey: string) =>
    request<{ share_id: string; session_key: string; title: string; visibility: string }>(`/sessions/${sessionKey}/share`, { method: 'POST' }),

  deleteShare: (sessionKey: string) =>
    request<{ ok: boolean }>(`/sessions/${sessionKey}/share`, { method: 'DELETE' }),

  getSharedSession: (shareId: string) =>
    request<{ share_id: string; title: string; messages: Message[] }>(`/share/${shareId}`),

  listApplets: () =>
    request<{ applets: AppletInfo[] }>('/applets').then((r) => r.applets),

  getApplet: (id: string) =>
    request<AppletInfo>(`/applets/${id}`),

  activateApplet: (id: string) =>
    request<{ ok: boolean }>(`/applets/${id}/activate`, { method: 'POST' }),

  deactivateApplet: (id: string) =>
    request<{ ok: boolean }>(`/applets/${id}/deactivate`, { method: 'POST' }),

  getAppletConfig: (id: string) =>
    request<{ config: Record<string, any> }>(`/applets/${id}/config`).then((r) => r.config),

  setAppletConfig: (id: string, config: Record<string, any>) =>
    request<{ ok: boolean }>(`/applets/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  appletAction: <T = any>(id: string, action: string, params?: Record<string, any>) =>
    request<T>(`/applets/${id}/action/${action}`, {
      method: 'POST',
      body: params ? JSON.stringify(params) : undefined,
    }),

  // ── Skills API ──

  listSkills: (source?: string) =>
    request<{ skills: SkillListItem[]; builtin: BuiltinSkillInfo[] }>(
      `/skills${source ? `?source=${source}` : ''}`,
    ),

  // Backend BM25 full-text search on skills (name + description + content + keywords).
  // Frontend calls this for deep/content-level search; for instant UI filtering,
  // use client-side fuzzy match on the already-loaded list.
  searchSkills: (q: string, limit?: number) =>
    request<{ skills: SkillListItem[] }>(
      `/skills/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`,
    ),

  getSkill: (id: string) => request<SkillRecord>(`/skills/${id}`),
  getBuiltinSkill: (identifier: string) =>
    request<BuiltinSkillRecord>(`/skills/builtin/${encodeURIComponent(identifier)}`),

  createSkill: (name: string, content: string) =>
    request<SkillImportResult>('/skills', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    }),

  updateSkill: (id: string, data: Partial<SkillRecord>) =>
    request<{ ok: boolean }>(`/skills/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteSkill: (id: string) =>
    request<{ ok: boolean }>(`/skills/${id}`, { method: 'DELETE' }),

  toggleSkill: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/skills/${id}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  importSkillFromAddress: (address: string, oauthProvider?: string) =>
    request<SkillImportBatchResult>('/skills/import/url', {
      method: 'POST',
      body: JSON.stringify({ address, oauth_provider: oauthProvider }),
    }),

  importSkillFromGitHub: (owner: string, repo: string, branch?: string, filePath?: string) =>
    request<SkillImportResult>('/skills/import/github', {
      method: 'POST',
      body: JSON.stringify({ owner, repo, branch, filePath }),
    }),

  importSkillFromZIP: async (file: File): Promise<SkillImportResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/skills/import/zip`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  validateSkillZIP: async (file: File): Promise<SkillZipValidation> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/skills/import/zip/validate`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  // ── Skill Market API ──

  getSkillsDir: () =>
    request<{ path: string }>('/skills/dir'),

  openSkillsDir: () =>
    request<{ ok: boolean; path: string }>('/skills/dir/open', { method: 'POST' }),

  listSkillMarkets: () =>
    request<{ markets: MarketSummary[] }>('/skills/market').then(r => r.markets),

  addSkillMarketSource: (url: string, name?: string, branch?: string) =>
    request<{ ok: boolean }>('/skills/market', {
      method: 'POST',
      body: JSON.stringify({ url, name, branch }),
    }),

  removeSkillMarketSource: (id: string) =>
    request<{ ok: boolean }>(`/skills/market/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  syncSkillMarket: (marketId: string) =>
    request<{ skills: MarketSkillEntry[]; total: number }>(
      `/skills/market/${encodeURIComponent(marketId)}/sync`, { method: 'POST' }),

  listMarketSkills: (marketId: string, q?: string) => {
    const params = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<{ skills: MarketSkillEntry[]; total: number }>(
      `/skills/market/${encodeURIComponent(marketId)}/skills${params}`);
  },

  getMarketSkillDetail: (marketId: string, filePath: string) =>
    request<MarketSkillDetail>(`/skills/market/${encodeURIComponent(marketId)}/detail`, {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    }),

  installMarketSkill: (marketId: string, filePath: string) =>
    request<SkillImportResult>('/skills/market/install', {
      method: 'POST',
      body: JSON.stringify({ market_id: marketId, file_path: filePath }),
    }),

  // ── MCP Servers API ──

  listMCPServers: () =>
    request<{ servers: MCPServerItem[] }>('/mcp/servers').then((r) => r.servers),

  getMCPServer: (name: string) =>
    request<MCPServerRecord>(`/mcp/servers/${name}`),

  createMCPServer: (data: Partial<MCPServerRecord>) =>
    request<{ ok: boolean; name: string }>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateMCPServer: (name: string, data: Partial<MCPServerRecord>) =>
    request<{ ok: boolean }>(`/mcp/servers/${name}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteMCPServer: (name: string) =>
    request<{ ok: boolean }>(`/mcp/servers/${name}`, { method: 'DELETE' }),

  toggleMCPServer: (name: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/mcp/servers/${name}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  testMCPServer: (name: string) =>
    request<{ ok: boolean; error?: string; tools?: string[] }>(`/mcp/servers/${name}/test`, {
      method: 'POST',
    }),

  // ── Cron Jobs API ──

  cronStatus: () =>
    request<CronStatus>('/cron/status'),

  listCronJobs: () =>
    request<{ jobs: CronJob[] }>('/cron/jobs').then((r) => r.jobs),

  createCronJob: (data: CronJobCreate) =>
    request<CronJob>('/cron/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCronJob: (id: string, data: Partial<CronJobCreate>) =>
    request<CronJob>(`/cron/jobs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCronJob: (id: string) =>
    request<{ ok: boolean }>(`/cron/jobs/${id}`, { method: 'DELETE' }),

  toggleCronJob: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/cron/jobs/${id}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  runCronJob: (id: string) =>
    request<{ ok: boolean }>(`/cron/jobs/${id}/run`, { method: 'POST' }),

  listCronRuns: (jobId: string) =>
    request<{ runs: CronRun[] }>(`/cron/jobs/${jobId}/runs`).then((r) => r.runs),

  parseCronSchedule: (text: string) =>
    request<CronScheduleParsed>('/cron/parse-schedule', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // ── Model Service ──

  // Model config registry (key-based)
  listModelConfig: () =>
    request<{ config: Record<string, ModelRef> }>('/model-config').then((r) => r.config),

  getModelConfig: (key: string) =>
    request<{ key: string; ref: ModelRef | null; resolved: ModelRef | null }>(
      `/model-config/${encodeURIComponent(key)}`,
    ),

  setModelConfig: (key: string, ref: ModelRef | null) =>
    request<{ key: string; ref: ModelRef | null }>(`/model-config/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(ref ?? { provider: '', model: '' }),
    }),

  deleteModelConfig: (key: string) =>
    request<{ ok: boolean }>(`/model-config/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),

  getProviderReferences: (providerId: string) =>
    request<{ references: ModelServiceReference[] }>(`/providers/${providerId}/references`).then((r) => r.references),

  // ── Channels (Bot/Webhook) ──

  listChannels: () =>
    request<{ channels: Channel[] }>('/channels').then((r) => r.channels),

  getChannel: (id: string) =>
    request<Channel>(`/channels/${id}`),

  createChannel: (data: { name: string; type: string; config: string; enabled?: boolean }) =>
    request<Channel>('/channels', { method: 'POST', body: JSON.stringify(data) }),

  updateChannel: (id: string, data: Partial<{ name: string; type: string; config: string; enabled: boolean }>) =>
    request<Channel>(`/channels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteChannel: (id: string) =>
    request<{ ok: boolean }>(`/channels/${id}`, { method: 'DELETE' }),

  testChannel: (id: string) =>
    request<{ ok: boolean }>(`/channels/${id}/test`, { method: 'POST' }),

  sendChannelMessage: (id: string, text: string, title?: string, targetId?: string, targetType?: string) =>
    request<{ ok: boolean }>(`/channels/${id}/send`, {
      method: 'POST',
      body: JSON.stringify({ text, title, markdown: true, targetId, targetType }),
    }),

  listChannelChats: (id: string) =>
    request<{ chats: ChatTarget[] }>(`/channels/${id}/chats`),

  startBot: (id: string) =>
    request<{ ok: boolean }>(`/channels/${id}/bot/start`, { method: 'POST' }),

  stopBot: (id: string) =>
    request<{ ok: boolean }>(`/channels/${id}/bot/stop`, { method: 'POST' }),

  getBotStatus: (id: string) =>
    request<BotStatus>(`/channels/${id}/bot/status`),

  listChannelEvents: (id: string, limit = 50, offset = 0) =>
    request<{ events: ChannelEvent[]; total: number }>(`/channels/${id}/events?limit=${limit}&offset=${offset}`),

  getChannelStats: (id: string) =>
    request<ChannelEventStats>(`/channels/${id}/stats`),

  tailLogs: (cursor: number, limit: number = 1000, maxBytes: number = 102400) =>
    request<LogTailResponse>(`/logs?cursor=${cursor}&limit=${limit}&maxBytes=${maxBytes}`),

  uploadFile: async (file: File): Promise<UploadResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  // OAuth2
  oauth2ListProviders: () =>
    request<OAuth2ProviderSummary[]>('/oauth2/providers'),

  oauth2GetProvider: (id: string) =>
    request<OAuth2ProviderDetail>(`/oauth2/providers/${id}`),

  oauth2GetCredentialInfo: (id: string) =>
    request<{ client_id: string; secret_masked: string; source: string; yaml_has_conf: boolean }>(
      `/oauth2/providers/${id}/credentials`,
    ),

  oauth2SetCredentials: (id: string, clientId: string, clientSecret: string) =>
    request<{ status: string }>(`/oauth2/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    }),

  oauth2Authorize: (id: string, environment?: string) =>
    request<{ auth_url: string }>(`/oauth2/authorize/${id}${environment ? `?environment=${environment}` : ''}`),

  oauth2ListConnections: () =>
    request<OAuth2Connection[]>('/oauth2/connections'),

  oauth2GetConnection: (id: string) =>
    request<OAuth2Connection>(`/oauth2/connections/${id}`),

  oauth2Disconnect: (id: string) =>
    request<{ status: string }>(`/oauth2/connections/${id}`, { method: 'DELETE' }),

  oauth2RefreshToken: (id: string) =>
    request<{ status: string }>(`/oauth2/connections/${id}/refresh`, { method: 'POST' }),

  oauth2CallResource: (id: string, resource: string, params?: Record<string, string>) =>
    request<unknown>(`/oauth2/resources/${id}/${resource}`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    }),

  oauth2Reload: () =>
    request<{ status: string }>('/oauth2/reload', { method: 'POST' }),

  oauth2GetPage: (id: string) =>
    request<{ provider: OAuth2ProviderDetail; has_credentials: boolean }>(`/oauth2/page/${id}`),

  oauthSimulateLarkStart: (opts?: { create_bot?: boolean; app_name?: string }) =>
    request<SimulateLoginStart>('/oauth/simulate/lark/start', {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    }),

  oauthSimulateLarkPoll: (sessionId: string) =>
    request<SimulateLoginPoll>(`/oauth/simulate/lark/poll/${sessionId}`),

  oauthSimulateLarkCreateBotSession: (appName?: string) =>
    request<{ status: string; bot: LarkBotCredentials; channel_id?: string; error?: string }>(
      '/oauth/simulate/lark/create-bot-session',
      { method: 'POST', body: JSON.stringify({ app_name: appName || 'Lark Bot' }) },
    ),

  // ── Memory API ──

  listMemories: (params?: { layer?: string; page?: number; page_size?: number; order_by?: string; agent_id?: string; since?: string; until?: string; period?: '24h' | '7d' | '30d' | '90d' }) =>
    request<{ memories: Memory[]; total: number }>(
      `/memories${params ? `?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>).toString()}` : ''}`,
    ),

  getMemory: (id: string) => request<Memory>(`/memories/${id}`),

  deleteMemory: (id: string) => request<{ ok: boolean }>(`/memories/${id}`, { method: 'DELETE' }),

  searchMemories: (
    query: string,
    layers?: string[],
    limit?: number,
    agentId?: string,
    timeFilter?: MemoryTimeFilter,
  ) =>
    request<{ results: ScoredMemory[] }>('/memories/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        layers,
        limit,
        agent_id: agentId || undefined,
        since: timeFilter?.since,
        until: timeFilter?.until,
        period: timeFilter?.period,
      }),
    }),

  getPersona: (agentId?: string) =>
    request<{ persona: Persona | null }>(`/memories/persona${agentId ? `?agent_id=${agentId}` : ''}`),

  getMemoryStats: () => request<MemoryStats>('/memories/stats'),

  getMemoryEvents: (params?: { type?: string; limit?: number; offset?: number; agent_id?: string; since?: string; until?: string; period?: '24h' | '7d' | '30d' | '90d' }) =>
    request<{ events: MemoryEvent[] }>(
      `/memories/events${params ? `?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>).toString()}` : ''}`,
    ),

  exportMemories: (params?: { layer?: string; agent_id?: string }) =>
    request<ExportData>(`/memories/export${params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : ''}`),

  importMemories: (data: ExportData, skipDuplicates?: boolean) =>
    request<ImportResult>(`/memories/import?skip_duplicates=${skipDuplicates !== false}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getEmbeddingStatus: () =>
    request<{ provider: string; model: string; dimensions: number; vector_count: number }>('/memories/embedding-status'),

  reEmbed: () =>
    request<{ ok: boolean; reembedded_count: number }>('/memories/reembed', {
      method: 'POST',
    }),

  tts: (text: string, voice?: string, speed?: number) =>
    request<{ url: string }>('/tts', {
      method: 'POST',
      body: JSON.stringify({ text, voice, speed }),
    }),

  ttsVoices: () =>
    request<{ voices: TTSVoice[] }>('/tts/voices'),

  stt: async (file: Blob, language?: string): Promise<{ text: string }> => {
    const formData = new FormData();
    formData.append('file', file, 'recording.webm');
    if (language) formData.append('language', language);
    const res = await fetch(`${BASE_URL}/stt`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  // ── Config Sections (override mechanism) ──

  getConfigSection: (section: string) =>
    request<Record<string, ConfigFieldMeta>>(`/config/sections/${section}`),

  setConfigSection: (section: string, values: Record<string, any>) =>
    request<{ ok: boolean }>(`/config/sections/${section}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    }),

  resetConfigField: (section: string, field: string) =>
    request<{ ok: boolean }>(`/config/sections/${section}/${field}`, {
      method: 'DELETE',
    }),

  testPostgresConnection: (dsn: string) =>
    request<{ ok: boolean; has_pgvector?: boolean; error?: string; warning?: string }>('/config/test-postgres', {
      method: 'POST',
      body: JSON.stringify({ dsn }),
    }),

  listEmbeddingModels: () =>
    request<{
      models: EmbeddingModelInfo[];
      resolved: { provider_id: string; provider_name: string; model: string };
      configured: { provider: string; model: string };
    }>('/embedding-models'),

  // Visitor / online count
  visitorHeartbeat: () =>
    request<{ online: number; ip: string }>('/visitor/heartbeat', { method: 'POST' }),

  getOnlineCount: () =>
    request<{ online: number }>('/visitor/online'),
};

export interface ConfigFieldMeta {
  value: any;
  default: any;
  source: 'default' | 'custom';
}

export interface EmbeddingModelInfo {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
}

export interface UploadResult {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  data_url: string;
  url: string;
}

export interface StreamEvent {
  event: string;
  data: Record<string, string>;
}

export interface ChatImageInput {
  url?: string;
  data_url?: string;
  mime_type?: string;
  filename?: string;
}

function millisToISO(millis?: number): string {
  if (!millis) return new Date().toISOString();
  return new Date(millis).toISOString();
}

function mapAIChatSessionToSession(item: any): Session {
  return {
    id: item.id,
    key: item.id,
    agent_name: item.agent_id || 'assistant',
    title: item.title || 'New Chat',
    message_count: item.message_count || 0,
    model_override: item.model_name || undefined,
    created_at: millisToISO(item.created_at),
    updated_at: millisToISO(item.updated_at),
  };
}

function mapAIChatMessageToMessage(item: any): Message {
  return {
    id: item.id,
    role: String(item.role || '').replace('CHAT_ROLE_', '').toLowerCase() || 'assistant',
    content: item.content || '',
    model: item.model_name || undefined,
    created_at: millisToISO(item.created_at),
    tool_calls: item.tool_calls_json || undefined,
  };
}

function parseJSONSafe(input?: string): Record<string, any> {
  if (!input) return {};
  try { return JSON.parse(input); } catch { return {}; }
}

function mapAIChatProviderToListItem(item: any): ProviderListItem {
  const keyVaults = parseJSONSafe(item.key_vaults);
  return {
    id: item.id,
    name: item.name || '',
    description: item.description || '',
    logo: item.logo || undefined,
    enabled: Boolean(item.enabled),
    builtin: item.id === 'ollama-default',
    has_api_key: Boolean(keyVaults.api_key || keyVaults.key || ''),
  };
}

function mapAIChatProviderToDetail(item: any): ProviderDetail {
  const cfg = parseJSONSafe(item.config_json);
  const keyVaults = parseJSONSafe(item.key_vaults);
  const checkModel = item.check_model || cfg.default_model || 'default';
  return {
    ...mapAIChatProviderToListItem(item),
    home_url: cfg.home_url || '',
    api_key_url: cfg.api_key_url || '',
    api_key: keyVaults.api_key || '',
    base_url: cfg.base_url || '',
    default_base_url: cfg.default_base_url || cfg.base_url || '',
    show_checker: true,
    check_model: checkModel,
    models: [{
      id: checkModel,
      display_name: checkModel,
      type: 'chat',
      enabled: true,
      context_window: 0,
    }],
  };
}

export function streamChat(
  message: string,
  sessionKey: string,
  _agentName: string,
  onEvent: (event: StreamEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  _images?: ChatImageInput[],
  model?: string,
): AbortController {
  const controller = new AbortController();
  (async () => {
    try {
      const response = await fetch(`${BASE_URL}/ai-chat/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionKey,
          topic_id: '',
          model: model || '',
          messages: [
            {
              role: 'CHAT_ROLE_USER',
              content: message,
            },
          ],
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content || '';
      if (text) {
        onEvent({ event: 'text', data: { content: text } });
      }
      onEvent({ event: 'done', data: { model: model || '' } });
      onDone();
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return controller;
}
