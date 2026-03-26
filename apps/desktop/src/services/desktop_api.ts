import { invoke } from '@tauri-apps/api/core';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const WEB_OAUTH_CONNECTIONS_KEY = 'pt.desktop.web.oauth.connections';
const WEB_ACCOUNT_STATE_KEY = 'pt.desktop.web.account.identity.state';

interface OAuthWebProviderConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  enabled: boolean;
  status: string;
  has_credentials: boolean;
  callback_url: string;
  environments: Array<{
    id: string;
    name: string;
    authorize_url: string;
    token_url: string;
    userinfo_url?: string;
    default: boolean;
  }>;
}

let oauthWebProviderConfigCache: OAuthWebProviderConfig[] | null = null;

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

function readWebAccountState(): AccountIdentityState {
  try {
    const raw = localStorage.getItem(WEB_ACCOUNT_STATE_KEY);
    if (!raw) return { accounts: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.accounts)) return { accounts: [] };
    return {
      active_account_id: typeof parsed.active_account_id === 'string' ? parsed.active_account_id : undefined,
      accounts: parsed.accounts as AccountIdentity[],
    };
  } catch {
    return { accounts: [] };
  }
}

function writeWebAccountState(state: AccountIdentityState) {
  try {
    localStorage.setItem(WEB_ACCOUNT_STATE_KEY, JSON.stringify(state));
  } catch {}
}

function upsertWebAccountFromOAuth(input: AccountUpsertOAuthInput): AccountIdentityState {
  const state = readWebAccountState();
  const accountId = `${input.provider}:${input.provider_user_id}`;
  const now = new Date().toISOString();
  const nextName = input.name || input.provider_user_id;
  const idx = state.accounts.findIndex((item) => item.id === accountId);
  const next: AccountIdentity = {
    id: accountId,
    provider: input.provider,
    provider_user_id: input.provider_user_id,
    name: nextName,
    email: input.email || '',
    avatar_url: input.avatar_url || '',
    profile_url: input.profile_url || '',
    last_login_at: now,
  };
  if (idx >= 0) {
    state.accounts[idx] = next;
  } else {
    state.accounts.push(next);
  }
  state.active_account_id = accountId;
  writeWebAccountState(state);
  return state;
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

async function invokeRustDataFromStatus<TInput, TOut>(
  command: string,
  input?: TInput,
): Promise<TOut> {
  const response = await invokeRustCommand<TInput, TauriStubPayload>(command, input);
  if (response.ok && response.data) {
    return parseJSONSafe(response.data.status) as TOut;
  }
  throw new Error(response.error?.message || `${command} failed`);
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function readWebOAuthConnections(): OAuth2Connection[] {
  try {
    const raw = localStorage.getItem(WEB_OAUTH_CONNECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as OAuth2Connection[];
  } catch {
    return [];
  }
}

function writeWebOAuthConnections(connections: OAuth2Connection[]) {
  try {
    localStorage.setItem(WEB_OAUTH_CONNECTIONS_KEY, JSON.stringify(connections));
  } catch {}
}

function upsertWebOAuthConnection(next: OAuth2Connection) {
  const list = readWebOAuthConnections();
  const idx = list.findIndex((item) => item.provider_id === next.provider_id);
  if (idx >= 0) {
    list[idx] = next;
  } else {
    list.push(next);
  }
  writeWebOAuthConnections(list);
}

function parseOAuthCallbackFromUrl(urlText: string): OAuthCallbackInput | null {
  const url = new URL(urlText);
  const provider = url.searchParams.get('provider') || '';
  const providerUserId = url.searchParams.get('provider_user_id') || '';
  if (!provider || !providerUserId) return null;
  return {
    provider,
    provider_user_id: providerUserId,
    username: url.searchParams.get('username') || undefined,
    display_name: url.searchParams.get('display_name') || undefined,
    email: url.searchParams.get('email') || undefined,
    avatar_url: url.searchParams.get('avatar_url') || undefined,
    profile_url: url.searchParams.get('profile_url') || undefined,
    expires_at: url.searchParams.get('expires_at') || undefined,
  };
}

function cleanOAuthCallbackParams(urlText: string): string {
  const cleanUrl = new URL(urlText);
  const keys = [
    'provider',
    'provider_user_id',
    'username',
    'display_name',
    'avatar_url',
    'email',
    'profile_url',
    'expires_at',
  ];
  keys.forEach((key) => cleanUrl.searchParams.delete(key));
  return cleanUrl.toString();
}

function consumeOAuthCallbackFromLocation() {
  if (typeof window === 'undefined') return;
  const payload = parseOAuthCallbackFromUrl(window.location.href);
  if (!payload) return;
  const provider = payload.provider;
  const providerUserId = payload.provider_user_id;
  const now = new Date().toISOString();
  upsertWebOAuthConnection({
    provider_id: provider,
    provider_name: provider.charAt(0).toUpperCase() + provider.slice(1),
    user_id: providerUserId,
    user_name: payload.username || payload.display_name || providerUserId,
    email: payload.email || '',
    avatar_url: payload.avatar_url || '',
    profile_url: payload.profile_url || '',
    connected_at: now,
    expires_at: payload.expires_at || new Date(Date.now() + 3600 * 1000).toISOString(),
    scopes: [],
    status: 'active',
  });
  upsertWebAccountFromOAuth({
    provider,
    provider_user_id: providerUserId,
    name: payload.username || payload.display_name || providerUserId,
    email: payload.email || undefined,
    avatar_url: payload.avatar_url || undefined,
    profile_url: payload.profile_url || undefined,
  });
  window.history.replaceState({}, '', cleanOAuthCallbackParams(window.location.href));
}

async function loadWebOAuthProviderConfigs(): Promise<OAuthWebProviderConfig[]> {
  if (oauthWebProviderConfigCache) return oauthWebProviderConfigCache;
  const res = await fetch(`${BASE_URL}/oauth/providers`, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`backend oauth providers api unavailable: ${res.status}`);
  }
  const payload = await res.json();
  const list = Array.isArray(payload) ? payload : payload.providers;
  if (!Array.isArray(list)) {
    throw new Error('backend oauth providers payload invalid');
  }
  oauthWebProviderConfigCache = list;
  return oauthWebProviderConfigCache;
}

function webOAuthProviderCatalog(
  providers: OAuthWebProviderConfig[],
  connections: OAuth2Connection[],
): OAuth2ProviderSummary[] {
  const isConnected = (providerId: string) =>
    connections.some((item) => item.provider_id === providerId && item.status === 'active');
  return providers
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      icon: item.icon,
      color: item.color,
      category: item.category,
      builtin: true,
      enabled: item.enabled,
      status: item.status,
      has_credentials: item.has_credentials,
      connected: isConnected(item.id),
      callback_url: item.callback_url,
      environments: item.environments,
    }));
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
  manifestVersion: 2;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  capabilities: string[];
  permissions: string[];
  load: {
    type: 'lynx';
    entry: string;
  };
  bridge: {
    version: 2;
    protocol: 'peers-touch.applet.bridge.v2';
  };
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

export interface AccountIdentity {
  id: string;
  provider: string;
  provider_user_id: string;
  name: string;
  email: string;
  avatar_url: string;
  profile_url: string;
  last_login_at: string;
}

interface AccountIdentityState {
  active_account_id?: string;
  accounts: AccountIdentity[];
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

export const DESKTOP_TAURI_CONTRACT_VERSION = '2026-03-24.desktop-tauri-rust.v1';

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

export interface ChatConversationInput {
  conversation_id: string;
}

export interface ChatRenameConversationInput {
  conversation_id: string;
  title: string;
}

export interface ChatSetConversationModelInput {
  conversation_id: string;
  model: string;
}

export interface ChatMessageInput {
  message_id: string;
}

export interface ChatUpdateMessageInput {
  message_id: string;
  content: string;
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

export interface ProviderIdInput {
  id: string;
}

export interface ProviderUpdateInput {
  id: string;
  enabled: boolean;
  key_vaults?: string;
  config_json?: string;
}

export interface ProviderCheckInput {
  id: string;
  key_vaults?: string;
  config_json?: string;
}

export interface ProviderCreateInput {
  name: string;
  description: string;
  logo: string;
  key_vaults: string;
  config_json: string;
}

export interface ProviderModelAddInput {
  provider_id: string;
  data: Record<string, any>;
}

export interface ProviderModelUpdateInput {
  provider_id: string;
  model_id: string;
  data: Record<string, any>;
}

export interface ProviderModelDeleteInput {
  provider_id: string;
  model_id: string;
}

export interface ProviderModelFetchInput {
  provider_id: string;
  data?: Record<string, any>;
}

export interface ProviderModelToggleInput {
  provider_id: string;
  model_id: string;
  enabled: boolean;
}

export interface ProviderModelToggleAllInput {
  provider_id: string;
  enabled: boolean;
}

export interface ChatCompletionInput {
  session_id: string;
  model?: string;
  message: string;
}

export interface SkillsListInput {
  source?: string;
}

export interface SkillsSearchInput {
  q: string;
  limit?: number;
}

export interface SkillIdInput {
  id: string;
}

export interface BuiltinSkillIdInput {
  identifier: string;
}

export interface SkillCreateInput {
  name: string;
  content: string;
}

export interface SkillUpdateInput {
  id: string;
  name?: string;
  description?: string;
  content?: string;
  enabled?: boolean;
}

export interface SkillToggleInput {
  id: string;
  enabled: boolean;
}

export interface McpNameInput {
  name: string;
}

export interface McpCreateInput {
  data: Partial<MCPServerRecord>;
}

export interface McpUpdateInput {
  name: string;
  data: Partial<MCPServerRecord>;
}

export interface McpToggleInput {
  name: string;
  enabled: boolean;
}

export interface CronIdInput {
  id: string;
}

export interface CronCreateInput {
  data: CronJobCreate;
}

export interface CronUpdateInput {
  id: string;
  data: Partial<CronJobCreate>;
}

export interface CronToggleInput {
  id: string;
  enabled: boolean;
}

export interface CronRunsInput {
  job_id: string;
}

export interface CronParseScheduleInput {
  text: string;
}

export interface ModelConfigKeyInput {
  key: string;
}

export interface ModelConfigSetInput {
  key: string;
  ref: ModelRef | null;
}

export interface ProviderIdInputV2 {
  provider_id: string;
}

export interface ChannelIdInput {
  id: string;
}

export interface ChannelCreateInput {
  name: string;
  type: string;
  config: string;
  enabled?: boolean;
}

export interface ChannelUpdateInput {
  id: string;
  name?: string;
  type?: string;
  config?: string;
  enabled?: boolean;
}

export interface ChannelSendMessageInput {
  id: string;
  text: string;
  title?: string;
  target_id?: string;
  target_type?: string;
}

export interface ChannelEventsInput {
  id: string;
  limit?: number;
  offset?: number;
}

export interface OAuthIdInput {
  id: string;
}

export interface OAuthSetCredentialsInput {
  id: string;
  client_id: string;
  client_secret: string;
}

export interface OAuthAuthorizeInput {
  id: string;
  environment?: string;
  return_to?: string;
}

export interface OAuthCallbackInput {
  provider: string;
  provider_user_id: string;
  username?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
  profile_url?: string;
  expires_at?: string;
}

export interface AccountUpsertOAuthInput {
  provider: string;
  provider_user_id: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  profile_url?: string;
}

interface AccountIdInput {
  id: string;
}

export interface OAuthResourceInput {
  id: string;
  resource: string;
  params?: Record<string, string>;
}

export interface MemoryIdInput {
  id: string;
}

export interface MemoryListInput {
  params?: Record<string, any>;
}

export interface MemorySearchInput {
  query: string;
  layers?: string[];
  limit?: number;
  agent_id?: string;
  since?: string;
  until?: string;
  period?: string;
}

export interface MemoryEventsInput {
  params?: Record<string, any>;
}

export interface MemoryExportInput {
  params?: Record<string, any>;
}

export interface MemoryImportInput {
  data: ExportData;
  skip_duplicates?: boolean;
}

export interface MemoryPersonaInput {
  agent_id?: string;
}

export interface TtsInput {
  text: string;
  voice?: string;
  speed?: number;
}

export interface TopicIdInput {
  topic_id: string;
}

export interface NotebookIdInput {
  id: string;
}

export interface NotebookCreateInput {
  topic_id: string;
  title: string;
  content: string;
  type?: string;
}

export interface NotebookUpdateInput {
  id: string;
  title: string;
  content: string;
}

export interface AppletIdInput {
  id: string;
}

export interface AppletConfigSetInput {
  id: string;
  config: Record<string, any>;
}

export interface AppletActionInput {
  id: string;
  action: string;
  params?: Record<string, any>;
}

export interface AppletInvokeInput {
  id: string;
  capability: string;
  action?: string;
  params?: Record<string, any>;
}

export interface SkillImportAddressInput {
  address: string;
  oauth_provider?: string;
}

export interface SkillImportGitHubInput {
  owner: string;
  repo: string;
  branch?: string;
  file_path?: string;
}

export interface SkillMarketIdInput {
  id: string;
}

export interface SkillMarketAddInput {
  url: string;
  name?: string;
  branch?: string;
}

export interface SkillMarketSyncInput {
  market_id: string;
}

export interface SkillMarketListInput {
  market_id: string;
  q?: string;
}

export interface SkillMarketDetailInput {
  market_id: string;
  file_path: string;
}

export interface AgentIdInput {
  id: string;
}

export interface AgentCreateInput {
  data: AgentCreate;
}

export interface AgentUpdateInput {
  id: string;
  data: Partial<AgentCreate>;
}

export interface AgentDuplicateInput {
  id: string;
  name: string;
}

export interface AgentSearchInput {
  q: string;
}

export interface SearchPrimaryInput {
  provider: string;
}

export interface SearchQueryInput {
  query: string;
  source?: string;
  limit?: number;
}

export interface AiSearchInput {
  query: string;
  web?: boolean;
}

export interface OnboardingSetInput {
  data: Partial<OnboardingState>;
}

export interface WizardStepInput {
  step_id: string;
  data: Record<string, any>;
}

export interface WizardExecuteApiInput {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface PreferencesSetInput {
  prefs: Partial<UserPreferences>;
}

export interface ShareSessionInput {
  session_key: string;
}

export interface ShareIdInput {
  share_id: string;
}

export interface LogsTailInput {
  cursor: number;
  limit?: number;
  max_bytes?: number;
}

export interface OAuthSimulateStartInput {
  create_bot?: boolean;
  app_name?: string;
}

export interface OAuthSessionInput {
  session_id: string;
}

export interface OAuthCreateBotSessionInput {
  app_name?: string;
}

export interface ConfigSectionInput {
  section: string;
}

export interface ConfigSectionSetInput {
  section: string;
  values: Record<string, any>;
}

export interface ConfigFieldResetInput {
  section: string;
  field: string;
}

export interface ConfigPostgresTestInput {
  dsn: string;
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

  getContractVersion: () =>
    invokeRustDataFromStatus<void, { version: string }>('meta_contract_version'),

  health: () => invokeRustDataFromStatus<void, { status: string }>('system_health'),

  listSessions: () =>
    invokeRustDataFromStatus<void, { conversations?: any[] }>(
      'chat_list_conversations',
      undefined,
    ).then((r): Session[] =>
      (r.conversations || []).map(mapAIChatSessionToSession),
    ),

  deleteSession: (key: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean }>(
      'chat_delete_conversation',
      { conversation_id: key },
    ),

  renameSession: (key: string, title: string) =>
    invokeRustDataFromStatus<ChatRenameConversationInput, { ok: boolean; title: string }>(
      'chat_rename_conversation',
      { conversation_id: key, title },
    ),

  duplicateSession: (key: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean; conversationId: string }>(
      'chat_duplicate_conversation',
      { conversation_id: key },
    ),

  smartRenameSession: (key: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean; title: string }>(
      'chat_smart_rename_conversation',
      { conversation_id: key },
    ),

  setSessionModel: (key: string, model: string) =>
    invokeRustDataFromStatus<ChatSetConversationModelInput, { ok: boolean; model: string }>(
      'chat_set_conversation_model',
      { conversation_id: key, model },
    ),

  getMessages: (key: string) =>
    invokeRustDataFromStatus<ChatListMessagesInput, { messages?: any[] }>(
      'chat_list_messages',
      { conversation_id: key },
    ).then((r) =>
      (r.messages || []).map(mapAIChatMessageToMessage),
    ),

  deleteMessage: (id: string) =>
    invokeRustDataFromStatus<ChatMessageInput, { ok: boolean }>(
      'chat_delete_message',
      { message_id: id },
    ),

  stopChat: (sessionKey: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean; stopped: boolean }>('chat_stop', {
      conversation_id: sessionKey,
    }),

  updateMessage: (id: string, content: string) =>
    invokeRustDataFromStatus<ChatUpdateMessageInput, { ok: boolean }>('chat_update_message', {
      message_id: id,
      content,
    }),

  listAgents: () =>
    invokeRustDataFromStatus<void, { agents: Agent[] }>('agents_list').then((r) => r.agents),

  getAgent: (id: string) => invokeRustDataFromStatus<AgentIdInput, Agent>('agents_get', { id }),

  createAgent: (data: AgentCreate) =>
    invokeRustDataFromStatus<AgentCreateInput, Agent>('agents_create', { data }),

  updateAgent: (id: string, data: Partial<AgentCreate>) =>
    invokeRustDataFromStatus<AgentUpdateInput, Agent>('agents_update', { id, data }),

  deleteAgent: (id: string) =>
    invokeRustDataFromStatus<AgentIdInput, { ok: boolean }>('agents_delete', { id }),

  duplicateAgent: (id: string, name: string) =>
    invokeRustDataFromStatus<AgentDuplicateInput, Agent>('agents_duplicate', { id, name }),

  searchAgents: (q: string) =>
    invokeRustDataFromStatus<AgentSearchInput, { agents: Agent[] }>('agents_search', { q }).then((r) => r.agents),

  listAgentSessions: (id: string) =>
    invokeRustDataFromStatus<AgentIdInput, { sessions: (Session & { agent_id?: string })[] }>(
      'agents_list_sessions',
      { id },
    ).then((r) =>
      r.sessions.map((s) => ({ ...s, agent_name: s.agent_name ?? s.agent_id ?? '' })),
    ),

  listTools: () =>
    invokeRustDataFromStatus<void, { tools: ToolInfo[] }>('tools_list').then((r) => r.tools),

  listSearchProviders: () =>
    invokeRustDataFromStatus<void, { providers: SearchProviderInfo[]; primary: string }>('tools_search_providers'),

  setSearchPrimary: (provider: string) =>
    invokeRustDataFromStatus<SearchPrimaryInput, { ok: boolean; primary: string }>('tools_set_search_primary', {
      provider,
    }),

  listAvailableModels: async () => {
    const r = await invokeRustDataFromStatus<void, { providers?: any[] }>('provider_list_available_models');
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
    invokeRustDataFromStatus<void, { providers?: any[] }>('provider_list').then((r) =>
      (r.providers || []).map(mapAIChatProviderToListItem),
    ),

  getProvider: (id: string) =>
    invokeRustDataFromStatus<ProviderIdInput, { provider?: any }>('provider_get', { id }).then((r) =>
      mapAIChatProviderToDetail(r.provider || {}),
    ),

  updateProvider: (id: string, data: { api_key: string; base_url: string; enabled: boolean }) =>
    invokeRustDataFromStatus<ProviderUpdateInput, { provider: any }>('provider_update', {
        id,
        enabled: data.enabled,
        key_vaults: JSON.stringify({ api_key: data.api_key || '' }),
        config_json: JSON.stringify({ base_url: data.base_url || '' }),
    }),

  checkProvider: (id: string, data: { api_key?: string; base_url?: string; model?: string }) =>
    invokeRustDataFromStatus<ProviderCheckInput, { ok: boolean; message?: string; error?: string }>('provider_check', {
        id,
        key_vaults: data.api_key ? JSON.stringify({ api_key: data.api_key }) : undefined,
        config_json: data.base_url ? JSON.stringify({ base_url: data.base_url, model: data.model || '' }) : undefined,
    }),

  applyPreset: (id: string) =>
    invokeRustDataFromStatus<ProviderIdInput, { ok: boolean; provider_id: string }>('provider_apply_preset', { id }),

  createProvider: (data: { id: string; name: string; description?: string; logo?: string; base_url: string; api_key?: string }) =>
    invokeRustDataFromStatus<ProviderCreateInput, { provider: any }>('provider_create', {
        name: data.name,
        description: data.description || '',
        logo: data.logo || '',
        key_vaults: JSON.stringify({ api_key: data.api_key || '' }),
        config_json: JSON.stringify({ base_url: data.base_url || '' }),
    }),

  deleteProvider: (id: string) =>
    invokeRustDataFromStatus<ProviderIdInput, { success: boolean }>('provider_delete', { id }),

  addModel: (providerId: string, data: { id: string; display_name?: string; type?: string; context_window?: number; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean; enabled?: boolean }) =>
    invokeRustDataFromStatus<ProviderModelAddInput, { ok: boolean }>('model_add', {
      provider_id: providerId,
      data,
    }),

  updateModel: (providerId: string, modelId: string, data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) =>
    invokeRustDataFromStatus<ProviderModelUpdateInput, { ok: boolean }>('model_update', {
      provider_id: providerId,
      model_id: modelId,
      data,
    }),

  deleteModel: (providerId: string, modelId: string) =>
    invokeRustDataFromStatus<ProviderModelDeleteInput, { ok: boolean }>('model_delete', {
      provider_id: providerId,
      model_id: modelId,
    }),

  fetchRemoteModels: (providerId: string, data?: { api_key?: string; base_url?: string }) =>
    invokeRustDataFromStatus<ProviderModelFetchInput, { ok: boolean; models: string[] }>('model_fetch_remote', {
      provider_id: providerId,
      data,
    }),

  toggleModel: (providerId: string, modelId: string, enabled: boolean) =>
    invokeRustDataFromStatus<ProviderModelToggleInput, { ok: boolean }>('model_toggle', {
      provider_id: providerId,
      model_id: modelId,
      enabled,
    }),

  toggleAllModels: (providerId: string, enabled: boolean) =>
    invokeRustDataFromStatus<ProviderModelToggleAllInput, { ok: boolean }>('model_toggle_all', {
      provider_id: providerId,
      enabled,
    }),

  getHelp: () =>
    invokeRustDataFromStatus<void, { categories: HelpCategoryGroup[] }>('help_get').then((r) => r.categories),

  searchSources: () =>
    invokeRustDataFromStatus<void, { sources: SearchSource[] }>('search_sources').then((r) => r.sources),

  search: (query: string, source = 'all', limit = 20) =>
    invokeRustDataFromStatus<SearchQueryInput, { query: string; source: string; groups?: SearchSourceGroup[]; results?: SearchResultItem[]; count?: number }>(
      'search_query',
      { query, source, limit },
    ),

  aiSearch: (query: string, web = false) =>
    invokeRustDataFromStatus<AiSearchInput, AISearchResponse>('search_ai', { query, web }),

  getOnboarding: () =>
    invokeRustDataFromStatus<void, OnboardingState>('onboarding_get'),

  setOnboarding: (data: Partial<OnboardingState>) =>
    invokeRustDataFromStatus<OnboardingSetInput, { ok: boolean }>('onboarding_set', { data }),

  resetOnboarding: () =>
    invokeRustDataFromStatus<void, { ok: boolean }>('onboarding_reset'),

  // Setup Wizard
  getWizard: () =>
    invokeRustDataFromStatus<void, WizardResponse>('wizard_get'),

  getWizardState: () =>
    invokeRustDataFromStatus<void, WizardState>('wizard_state_get'),

  saveWizardStep: (stepId: string, data: Record<string, any>) =>
    invokeRustDataFromStatus<WizardStepInput, WizardState>('wizard_step_save', { step_id: stepId, data }),

  completeWizard: () =>
    invokeRustDataFromStatus<void, WizardState>('wizard_complete'),

  executeWizardApi: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => {
    const normalizedPath = path.startsWith('/api') ? path.replace(/^\/api/, '') : path;
    return invokeRustDataFromStatus<WizardExecuteApiInput, unknown>('wizard_api_execute', {
      method,
      path: normalizedPath,
      body,
    });
  },

  getStatistics: () =>
    invokeRustDataFromStatus<void, StatisticsData>('statistics_get'),

  getPreferences: () =>
    invokeRustDataFromStatus<void, UserPreferences>('preferences_get'),

  setPreferences: (prefs: Partial<UserPreferences>) =>
    invokeRustDataFromStatus<PreferencesSetInput, { ok: boolean }>('preferences_set', { prefs }),

  accountList: () =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<void, { accounts: AccountIdentity[]; active_account_id?: string }>('account_list')
      : Promise.resolve(readWebAccountState()),

  accountGetActive: () =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<void, { account: AccountIdentity | null }>('account_get_active').then((r) => r.account)
      : Promise.resolve((() => {
          const state = readWebAccountState();
          return state.accounts.find((item) => item.id === state.active_account_id) || null;
        })()),

  accountSwitch: (id: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<AccountIdInput, { ok: boolean }>('account_switch', { id })
      : (async () => {
          const state = readWebAccountState();
          if (!state.accounts.some((item) => item.id === id)) {
            throw new Error('account not found');
          }
          state.active_account_id = id;
          writeWebAccountState(state);
          return { ok: true };
        })(),

  accountUpsertOAuth: (input: AccountUpsertOAuthInput) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<AccountUpsertOAuthInput, { ok: boolean; active_account_id: string }>('account_upsert_oauth', input)
      : Promise.resolve((() => {
          const state = upsertWebAccountFromOAuth(input);
          return { ok: true, active_account_id: state.active_account_id || '' };
        })()),

  // Notebook / Documents
  listDocuments: (topicId: string) =>
    invokeRustDataFromStatus<TopicIdInput, { documents: NotebookDocument[] }>('notebook_list_documents', { topic_id: topicId }).then(r => r.documents),

  getDocument: (id: string) =>
    invokeRustDataFromStatus<NotebookIdInput, NotebookDocument>('notebook_get_document', { id }),

  createDocument: (topicId: string, title: string, content: string, type?: string) =>
    invokeRustDataFromStatus<NotebookCreateInput, NotebookDocument>('notebook_create_document', {
      topic_id: topicId,
      title,
      content,
      type: type || 'note',
    }),

  updateDocument: (id: string, title: string, content: string) =>
    invokeRustDataFromStatus<NotebookUpdateInput, { ok: boolean }>('notebook_update_document', { id, title, content }),

  deleteDocument: (id: string) =>
    invokeRustDataFromStatus<NotebookIdInput, { ok: boolean }>('notebook_delete_document', { id }),

  listAllDocuments: () =>
    invokeRustDataFromStatus<void, { documents: NotebookDocumentWithTopic[] }>('notebook_list_all_documents').then(r => r.documents),

  // Share
  createShare: (sessionKey: string) =>
    invokeRustDataFromStatus<ShareSessionInput, { share_id: string; session_key: string; title: string; visibility: string }>(
      'share_create',
      { session_key: sessionKey },
    ),

  deleteShare: (sessionKey: string) =>
    invokeRustDataFromStatus<ShareSessionInput, { ok: boolean }>('share_delete', { session_key: sessionKey }),

  getSharedSession: (shareId: string) =>
    invokeRustDataFromStatus<ShareIdInput, { share_id: string; title: string; messages: Message[] }>('share_get', { share_id: shareId }),

  listApplets: () =>
    invokeRustDataFromStatus<void, { applets: AppletInfo[] }>('applets_list').then((r) => r.applets),

  getApplet: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, AppletInfo>('applets_get', { id }),

  activateApplet: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, { ok: boolean }>('applets_activate', { id }),

  deactivateApplet: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, { ok: boolean }>('applets_deactivate', { id }),

  getAppletConfig: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, { config: Record<string, any> }>('applets_get_config', { id }).then((r) => r.config),

  setAppletConfig: (id: string, config: Record<string, any>) =>
    invokeRustDataFromStatus<AppletConfigSetInput, { ok: boolean }>('applets_set_config', { id, config }),

  appletAction: <T = any>(id: string, action: string, params?: Record<string, any>) =>
    invokeRustDataFromStatus<AppletActionInput, T>('applets_action', { id, action, params }),

  appletInvoke: <T = any>(id: string, capability: string, action?: string, params?: Record<string, any>) =>
    invokeRustDataFromStatus<AppletInvokeInput, T>('applets_invoke', { id, capability, action, params }),

  // ── Skills API ──

  listSkills: (source?: string) =>
    invokeRustDataFromStatus<SkillsListInput, { skills: SkillListItem[]; builtin: BuiltinSkillInfo[] }>(
      'skills_list',
      { source },
    ),

  // Backend BM25 full-text search on skills (name + description + content + keywords).
  // Frontend calls this for deep/content-level search; for instant UI filtering,
  // use client-side fuzzy match on the already-loaded list.
  searchSkills: (q: string, limit?: number) =>
    invokeRustDataFromStatus<SkillsSearchInput, { skills: SkillListItem[] }>('skills_search', { q, limit }),

  getSkill: (id: string) => invokeRustDataFromStatus<SkillIdInput, SkillRecord>('skills_get', { id }),
  getBuiltinSkill: (identifier: string) =>
    invokeRustDataFromStatus<BuiltinSkillIdInput, BuiltinSkillRecord>('skills_get_builtin', { identifier }),

  createSkill: (name: string, content: string) =>
    invokeRustDataFromStatus<SkillCreateInput, SkillImportResult>('skills_create', { name, content }),

  updateSkill: (id: string, data: Partial<SkillRecord>) =>
    invokeRustDataFromStatus<SkillUpdateInput, { ok: boolean }>('skills_update', {
      id,
      name: data.name,
      description: data.description,
      content: data.content,
      enabled: data.enabled,
    }),

  deleteSkill: (id: string) =>
    invokeRustDataFromStatus<SkillIdInput, { ok: boolean }>('skills_delete', { id }),

  toggleSkill: (id: string, enabled: boolean) =>
    invokeRustDataFromStatus<SkillToggleInput, { ok: boolean }>('skills_toggle', { id, enabled }),

  importSkillFromAddress: (address: string, oauthProvider?: string) =>
    invokeRustDataFromStatus<SkillImportAddressInput, SkillImportBatchResult>('skills_import_url', {
      address,
      oauth_provider: oauthProvider,
    }),

  importSkillFromGitHub: (owner: string, repo: string, branch?: string, filePath?: string) =>
    invokeRustDataFromStatus<SkillImportGitHubInput, SkillImportResult>('skills_import_github', {
      owner,
      repo,
      branch,
      file_path: filePath,
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
    invokeRustDataFromStatus<void, { path: string }>('skills_market_dir'),

  openSkillsDir: () =>
    invokeRustDataFromStatus<void, { ok: boolean; path: string }>('skills_market_open_dir'),

  listSkillMarkets: () =>
    invokeRustDataFromStatus<void, { markets: MarketSummary[] }>('skills_market_list').then(r => r.markets),

  addSkillMarketSource: (url: string, name?: string, branch?: string) =>
    invokeRustDataFromStatus<SkillMarketAddInput, { ok: boolean }>('skills_market_add', { url, name, branch }),

  removeSkillMarketSource: (id: string) =>
    invokeRustDataFromStatus<SkillMarketIdInput, { ok: boolean }>('skills_market_remove', { id }),

  syncSkillMarket: (marketId: string) =>
    invokeRustDataFromStatus<SkillMarketSyncInput, { skills: MarketSkillEntry[]; total: number }>(
      'skills_market_sync',
      { market_id: marketId },
    ),

  listMarketSkills: (marketId: string, q?: string) => {
    return invokeRustDataFromStatus<SkillMarketListInput, { skills: MarketSkillEntry[]; total: number }>(
      'skills_market_list_skills',
      { market_id: marketId, q },
    );
  },

  getMarketSkillDetail: (marketId: string, filePath: string) =>
    invokeRustDataFromStatus<SkillMarketDetailInput, MarketSkillDetail>('skills_market_detail', {
      market_id: marketId,
      file_path: filePath,
    }),

  installMarketSkill: (marketId: string, filePath: string) =>
    invokeRustDataFromStatus<SkillMarketDetailInput, SkillImportResult>('skills_market_install', {
      market_id: marketId,
      file_path: filePath,
    }),

  // ── MCP Servers API ──

  listMCPServers: () =>
    invokeRustDataFromStatus<void, { servers: MCPServerItem[] }>('mcp_list_servers').then((r) => r.servers),

  getMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, MCPServerRecord>('mcp_get_server', { name }),

  createMCPServer: (data: Partial<MCPServerRecord>) =>
    invokeRustDataFromStatus<McpCreateInput, { ok: boolean; name: string }>('mcp_create_server', { data }),

  updateMCPServer: (name: string, data: Partial<MCPServerRecord>) =>
    invokeRustDataFromStatus<McpUpdateInput, { ok: boolean }>('mcp_update_server', { name, data }),

  deleteMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, { ok: boolean }>('mcp_delete_server', { name }),

  toggleMCPServer: (name: string, enabled: boolean) =>
    invokeRustDataFromStatus<McpToggleInput, { ok: boolean }>('mcp_toggle_server', { name, enabled }),

  testMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, { ok: boolean; error?: string; tools?: string[] }>('mcp_test_server', { name }),

  // ── Cron Jobs API ──

  cronStatus: () =>
    invokeRustDataFromStatus<void, CronStatus>('cron_status'),

  listCronJobs: () =>
    invokeRustDataFromStatus<void, { jobs: CronJob[] }>('cron_list_jobs').then((r) => r.jobs),

  createCronJob: (data: CronJobCreate) =>
    invokeRustDataFromStatus<CronCreateInput, { job: CronJob }>('cron_create_job', { data }).then((r) => r.job),

  updateCronJob: (id: string, data: Partial<CronJobCreate>) =>
    invokeRustDataFromStatus<CronUpdateInput, { job: CronJob }>('cron_update_job', { id, data }).then((r) => r.job),

  deleteCronJob: (id: string) =>
    invokeRustDataFromStatus<CronIdInput, { ok: boolean }>('cron_delete_job', { id }),

  toggleCronJob: (id: string, enabled: boolean) =>
    invokeRustDataFromStatus<CronToggleInput, { ok: boolean }>('cron_toggle_job', { id, enabled }),

  runCronJob: (id: string) =>
    invokeRustDataFromStatus<CronIdInput, { ok: boolean }>('cron_run_job', { id }),

  listCronRuns: (jobId: string) =>
    invokeRustDataFromStatus<CronRunsInput, { runs: CronRun[] }>('cron_list_runs', { job_id: jobId }).then((r) => r.runs),

  parseCronSchedule: (text: string) =>
    invokeRustDataFromStatus<CronParseScheduleInput, CronScheduleParsed>('cron_parse_schedule', { text }),

  // ── Model Service ──

  // Model config registry (key-based)
  listModelConfig: () =>
    invokeRustDataFromStatus<void, { config: Record<string, ModelRef> }>('model_config_list').then((r) => r.config),

  getModelConfig: (key: string) =>
    invokeRustDataFromStatus<ModelConfigKeyInput, { key: string; ref: ModelRef | null; resolved: ModelRef | null }>(
      'model_config_get',
      { key },
    ),

  setModelConfig: (key: string, ref: ModelRef | null) =>
    invokeRustDataFromStatus<ModelConfigSetInput, { key: string; ref: ModelRef | null }>('model_config_set', { key, ref }),

  deleteModelConfig: (key: string) =>
    invokeRustDataFromStatus<ModelConfigKeyInput, { ok: boolean }>('model_config_delete', { key }),

  getProviderReferences: (providerId: string) =>
    invokeRustDataFromStatus<ProviderIdInputV2, { references: ModelServiceReference[] }>(
      'model_config_provider_references',
      { provider_id: providerId },
    ).then((r) => r.references),

  // ── Channels (Bot/Webhook) ──

  listChannels: () =>
    invokeRustDataFromStatus<void, { channels: Channel[] }>('channels_list').then((r) => r.channels),

  getChannel: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, Channel>('channels_get', { id }),

  createChannel: (data: { name: string; type: string; config: string; enabled?: boolean }) =>
    invokeRustDataFromStatus<ChannelCreateInput, Channel>('channels_create', data),

  updateChannel: (id: string, data: Partial<{ name: string; type: string; config: string; enabled: boolean }>) =>
    invokeRustDataFromStatus<ChannelUpdateInput, Channel>('channels_update', { id, ...data }),

  deleteChannel: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_delete', { id }),

  testChannel: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_test', { id }),

  sendChannelMessage: (id: string, text: string, title?: string, targetId?: string, targetType?: string) =>
    invokeRustDataFromStatus<ChannelSendMessageInput, { ok: boolean }>('channels_send', {
      id,
      text,
      title,
      target_id: targetId,
      target_type: targetType,
    }),

  listChannelChats: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { chats: ChatTarget[] }>('channels_list_chats', { id }),

  startBot: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_start_bot', { id }),

  stopBot: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_stop_bot', { id }),

  getBotStatus: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, BotStatus>('channels_bot_status', { id }),

  listChannelEvents: (id: string, limit = 50, offset = 0) =>
    invokeRustDataFromStatus<ChannelEventsInput, { events: ChannelEvent[]; total: number }>('channels_list_events', {
      id,
      limit,
      offset,
    }),

  getChannelStats: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, ChannelEventStats>('channels_stats', { id }),

  tailLogs: (cursor: number, limit: number = 1000, maxBytes: number = 102400) =>
    invokeRustDataFromStatus<LogsTailInput, LogTailResponse>('logs_tail', {
      cursor,
      limit,
      max_bytes: maxBytes,
    }),

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
    isTauriRuntime()
      ? invokeRustDataFromStatus<void, OAuth2ProviderSummary[]>('oauth2_list_providers')
      : (async () => {
          consumeOAuthCallbackFromLocation();
          const providers = await loadWebOAuthProviderConfigs();
          const connections = readWebOAuthConnections();
          return webOAuthProviderCatalog(providers, connections);
        })(),

  oauth2GetProvider: (id: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthIdInput, OAuth2ProviderDetail>('oauth2_get_provider', { id })
      : (async () => {
          const providers = await loadWebOAuthProviderConfigs();
          const p = providers.find((item) => item.id === id);
          if (!p) throw new Error('provider not found');
          const env = p.environments?.find((item) => item.default) || p.environments?.[0];
          if (!env) throw new Error('provider environment not configured');
          return {
            id: p.id,
            name: p.name,
            description: p.description || `${p.name} OAuth2 provider`,
            icon: p.icon || '',
            color: p.color || '',
            category: p.category || 'other',
            builtin: true,
            enabled: p.enabled !== false,
            oauth2: {
              authorize_url: env.authorize_url,
              token_url: env.token_url,
              userinfo_url: env.userinfo_url,
              scopes: [],
              pkce: false,
            },
          } as OAuth2ProviderDetail;
        })(),

  oauth2GetCredentialInfo: (id: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthIdInput, { client_id: string; secret_masked: string; source: string; yaml_has_conf: boolean }>(
          'oauth2_get_credential_info',
          { id },
        )
      : Promise.resolve({ client_id: '', secret_masked: '****', source: 'web', yaml_has_conf: true }),

  oauth2SetCredentials: (id: string, clientId: string, clientSecret: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthSetCredentialsInput, { status: string }>('oauth2_set_credentials', {
          id,
          client_id: clientId,
          client_secret: clientSecret,
        })
      : Promise.resolve({ status: 'ok' }),

  oauth2Authorize: (id: string, environment?: string, returnTo?: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthAuthorizeInput, { auth_url: string }>('oauth2_authorize', { id, environment, return_to: returnTo })
      : (async () => {
          const providers = await loadWebOAuthProviderConfigs();
          const p = providers.find((item) => item.id === id);
          if (!p) throw new Error('provider not found');
          if ((p.status || 'active') === 'coming_soon') throw new Error('provider developing');
        const callbackUrl =
          p.callback_url ||
          (id === 'github' || id === 'google'
            ? `https://peers-touch.vercel.app/api/oauth/${id}/callback`
            : '');
        if (!callbackUrl) throw new Error('provider callback_url missing');
          const resolvedReturnTo = returnTo || (typeof window !== 'undefined' ? window.location.href : '');
        const startUrl = callbackUrl.replace(/\/callback(\?.*)?$/, '/start');
          const authUrl = `${startUrl}?site_id=default&return_to=${encodeURIComponent(resolvedReturnTo)}`;
          return { auth_url: authUrl };
        })(),

  oauth2HandleCallback: (input: OAuthCallbackInput) =>
    isTauriRuntime()
      ? (async () => {
          const result = await invokeRustDataFromStatus<OAuthCallbackInput, { status: string }>('oauth2_handle_callback', input);
          await api.accountUpsertOAuth({
            provider: input.provider,
            provider_user_id: input.provider_user_id,
            name: input.username || input.display_name || input.provider_user_id,
            email: input.email || undefined,
            avatar_url: input.avatar_url || undefined,
            profile_url: input.profile_url || undefined,
          });
          return result;
        })()
      : (async () => {
          const provider = input.provider;
          const providerUserId = input.provider_user_id;
          const now = new Date().toISOString();
          upsertWebOAuthConnection({
            provider_id: provider,
            provider_name: provider.charAt(0).toUpperCase() + provider.slice(1),
            user_id: providerUserId,
            user_name: input.username || input.display_name || providerUserId,
            email: input.email || '',
            avatar_url: input.avatar_url || '',
            profile_url: input.profile_url || '',
            connected_at: now,
            expires_at: input.expires_at || new Date(Date.now() + 3600 * 1000).toISOString(),
            scopes: [],
            status: 'active',
          });
          upsertWebAccountFromOAuth({
            provider,
            provider_user_id: providerUserId,
            name: input.username || input.display_name || providerUserId,
            email: input.email || undefined,
            avatar_url: input.avatar_url || undefined,
            profile_url: input.profile_url || undefined,
          });
          return { status: 'ok' };
        })(),

  oauth2ConsumeCallbackFromUrl: async (urlText: string) => {
    const payload = parseOAuthCallbackFromUrl(urlText);
    if (!payload) return false;
    await api.oauth2HandleCallback(payload);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('account-identity-changed'));
    }
    return true;
  },

  oauth2ListConnections: () =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<void, OAuth2Connection[]>('oauth2_list_connections')
      : (async () => {
          consumeOAuthCallbackFromLocation();
          return readWebOAuthConnections();
        })(),

  oauth2GetConnection: (id: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthIdInput, OAuth2Connection>('oauth2_get_connection', { id })
      : (async () => {
          const item = readWebOAuthConnections().find((conn) => conn.provider_id === id);
          if (!item) throw new Error('connection not found');
          return item;
        })(),

  oauth2Disconnect: (id: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthIdInput, { status: string }>('oauth2_disconnect', { id })
      : (async () => {
          const list = readWebOAuthConnections().filter((conn) => conn.provider_id !== id);
          writeWebOAuthConnections(list);
          return { status: 'ok' };
        })(),

  oauth2RefreshToken: (id: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthIdInput, { status: string }>('oauth2_refresh_token', { id })
      : (async () => {
          const list = readWebOAuthConnections();
          const idx = list.findIndex((conn) => conn.provider_id === id);
          if (idx < 0) throw new Error('connection not found');
          list[idx] = {
            ...list[idx],
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            status: 'active',
          };
          writeWebOAuthConnections(list);
          return { status: 'ok' };
        })(),

  oauth2CallResource: (id: string, resource: string, params?: Record<string, string>) =>
    invokeRustDataFromStatus<OAuthResourceInput, unknown>('oauth2_call_resource', { id, resource, params }),

  oauth2Reload: () =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<void, { status: string }>('oauth2_reload')
      : Promise.resolve({ status: 'ok' }),

  oauth2GetPage: (id: string) =>
    isTauriRuntime()
      ? invokeRustDataFromStatus<OAuthIdInput, { provider: OAuth2ProviderDetail; has_credentials: boolean }>('oauth2_get_page', { id })
      : (async () => {
          const provider = await api.oauth2GetProvider(id);
          return {
            provider,
            has_credentials: true,
          };
        })(),

  oauthSimulateLarkStart: (opts?: { create_bot?: boolean; app_name?: string }) =>
    invokeRustDataFromStatus<OAuthSimulateStartInput, SimulateLoginStart>('oauth_simulate_lark_start', opts || {}),

  oauthSimulateLarkPoll: (sessionId: string) =>
    invokeRustDataFromStatus<OAuthSessionInput, SimulateLoginPoll>('oauth_simulate_lark_poll', { session_id: sessionId }),

  oauthSimulateLarkCreateBotSession: (appName?: string) =>
    invokeRustDataFromStatus<OAuthCreateBotSessionInput, { status: string; bot: LarkBotCredentials; channel_id?: string; error?: string }>(
      'oauth_simulate_lark_create_bot_session',
      { app_name: appName || 'Lark Bot' },
    ),

  // ── Memory API ──

  listMemories: (params?: { layer?: string; page?: number; page_size?: number; order_by?: string; agent_id?: string; since?: string; until?: string; period?: '24h' | '7d' | '30d' | '90d' }) =>
    invokeRustDataFromStatus<MemoryListInput, { memories: Memory[]; total: number }>('memory_list', { params }),

  getMemory: (id: string) => invokeRustDataFromStatus<MemoryIdInput, Memory>('memory_get', { id }),

  deleteMemory: (id: string) => invokeRustDataFromStatus<MemoryIdInput, { ok: boolean }>('memory_delete', { id }),

  searchMemories: (
    query: string,
    layers?: string[],
    limit?: number,
    agentId?: string,
    timeFilter?: MemoryTimeFilter,
  ) =>
    invokeRustDataFromStatus<MemorySearchInput, { results: ScoredMemory[] }>('memory_search', {
        query,
        layers,
        limit,
        agent_id: agentId || undefined,
        since: timeFilter?.since,
        until: timeFilter?.until,
        period: timeFilter?.period,
    }),

  getPersona: (agentId?: string) =>
    invokeRustDataFromStatus<MemoryPersonaInput, { persona: Persona | null }>('memory_persona', {
      agent_id: agentId,
    }),

  getMemoryStats: () => invokeRustDataFromStatus<void, MemoryStats>('memory_stats'),

  getMemoryEvents: (params?: { type?: string; limit?: number; offset?: number; agent_id?: string; since?: string; until?: string; period?: '24h' | '7d' | '30d' | '90d' }) =>
    invokeRustDataFromStatus<MemoryEventsInput, { events: MemoryEvent[] }>('memory_events', { params }),

  exportMemories: (params?: { layer?: string; agent_id?: string }) =>
    invokeRustDataFromStatus<MemoryExportInput, ExportData>('memory_export', { params }),

  importMemories: (data: ExportData, skipDuplicates?: boolean) =>
    invokeRustDataFromStatus<MemoryImportInput, ImportResult>('memory_import', {
      data,
      skip_duplicates: skipDuplicates !== false,
    }),

  getEmbeddingStatus: () =>
    invokeRustDataFromStatus<void, { provider: string; model: string; dimensions: number; vector_count: number }>('memory_embedding_status'),

  reEmbed: () =>
    invokeRustDataFromStatus<void, { ok: boolean; reembedded_count: number }>('memory_reembed'),

  tts: (text: string, voice?: string, speed?: number) =>
    invokeRustDataFromStatus<TtsInput, { url: string }>('tts_synthesize', { text, voice, speed }),

  ttsVoices: () =>
    invokeRustDataFromStatus<void, { voices: TTSVoice[] }>('tts_voices'),

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
    invokeRustDataFromStatus<ConfigSectionInput, Record<string, ConfigFieldMeta>>('config_section_get', { section }),

  setConfigSection: (section: string, values: Record<string, any>) =>
    invokeRustDataFromStatus<ConfigSectionSetInput, { ok: boolean }>('config_section_set', { section, values }),

  resetConfigField: (section: string, field: string) =>
    invokeRustDataFromStatus<ConfigFieldResetInput, { ok: boolean }>('config_field_reset', { section, field }),

  testPostgresConnection: (dsn: string) =>
    invokeRustDataFromStatus<ConfigPostgresTestInput, { ok: boolean; has_pgvector?: boolean; error?: string; warning?: string }>(
      'config_test_postgres',
      { dsn },
    ),

  listEmbeddingModels: () =>
    invokeRustDataFromStatus<void, {
      models: EmbeddingModelInfo[];
      resolved: { provider_id: string; provider_name: string; model: string };
      configured: { provider: string; model: string };
    }>('embedding_models_list'),

  // Visitor / online count
  visitorHeartbeat: () =>
    invokeRustDataFromStatus<void, { online: number; ip: string }>('visitor_heartbeat'),

  getOnlineCount: () =>
    invokeRustDataFromStatus<void, { online: number }>('visitor_online'),
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
  const updatedMillis = Number(item.updated_at ?? item.lastTimestampMs ?? Date.now());
  const createdMillis = Number(item.created_at ?? item.lastTimestampMs ?? Date.now());
  return {
    id: item.id,
    key: item.id,
    agent_name: item.agent_id || 'assistant',
    title: item.title || 'New Chat',
    message_count: Number(item.message_count ?? item.messageCount ?? item.unreadCount ?? 0),
    model_override: item.model_name || item.modelName || undefined,
    created_at: millisToISO(createdMillis),
    updated_at: millisToISO(updatedMillis),
  };
}

function mapAIChatMessageToMessage(item: any): Message {
  return {
    id: item.id,
    role: String(item.role || '').replace('CHAT_ROLE_', '').toLowerCase() || 'assistant',
    content: item.content || '',
    model: item.model_name || item.modelName || undefined,
    created_at: millisToISO(Number(item.created_at ?? item.createdAt ?? Date.now())),
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
      const payload = await invokeRustDataFromStatus<ChatCompletionInput, { text: string; model?: string }>(
        'chat_completion_once',
        {
          session_id: sessionKey,
          model: model || '',
          message,
        },
      );
      if (controller.signal.aborted) {
        return;
      }
      const text = payload?.text || '';
      if (text) {
        onEvent({ event: 'text', data: { content: text } });
      }
      onEvent({ event: 'done', data: { model: payload?.model || model || '' } });
      onDone();
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return controller;
}
