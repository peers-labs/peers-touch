import { demoAvatarUrls } from './data';

export type Federation = {
  id: string;
  name: string;
  endpoint: string;
  role: 'Operator' | 'Member';
  stations: number;
};

export type AuthorizedDevice = {
  id: string;
  name: string;
  detail: string;
  current: boolean;
};

export type ProviderModel = {
  id: string;
  name: string;
  enabled: boolean;
  capabilities: string[];
};

export type ProviderConnection = {
  id: string;
  name: string;
  runtime: 'cloud' | 'local';
  enabled: boolean;
  status: 'ready' | 'checking' | 'invalid' | 'unconfigured';
  endpoint: string;
  apiKey: string;
  models: ProviderModel[];
};

export type SkillItem = {
  id: string;
  name: string;
  description: string;
  source: 'installed' | 'built-in' | 'market';
  enabled: boolean;
};

export type McpServer = {
  id: string;
  name: string;
  transport: 'http' | 'sse' | 'stdio';
  owner: 'station' | 'client';
  endpoint: string;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'checking';
};

export type CronTask = {
  id: string;
  title: string;
  schedule: string;
  enabled: boolean;
  lastRun: string;
  lastResult: 'Succeeded' | 'Failed' | 'Never';
};

export type Channel = {
  id: string;
  name: string;
  type: 'email' | 'webhook' | 'lark';
  endpoint: string;
  enabled: boolean;
  status: 'ready' | 'unconfigured' | 'error';
};

export type Applet = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  hasSettings: boolean;
};

export type StorageConversation = {
  id: string;
  name: string;
  kind: 'Direct' | 'Group';
  messageMb: number;
  mediaMb: number;
  reclaimableMb: number;
  lastActivity: string;
  failOnce?: boolean;
};

export type StoredFile = {
  id: string;
  name: string;
  bucket: string;
  mime: string;
  sizeMb: number;
  visibility: 'private' | 'chat' | 'public';
  deleted: boolean;
};

export type LogEntry = {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  subsystem: string;
  message: string;
  time: string;
};

export type MobileSettingsState = {
  profile: {
    displayName: string;
    bio: string;
    region: string;
    timezone: string;
    avatarSrc?: string;
    coverSrc?: string;
  };
  toggles: Record<string, boolean>;
  language: 'en' | 'zh-CN';
  reach: 'anyone' | 'federations' | 'nobody';
  federationVisibility: 'public' | 'federations' | 'by-handle';
  defaultVisibility: 'public' | 'followers';
  defaultProvider: string;
  defaultModel: string;
  defaultEffort: 'low' | 'medium' | 'high';
  modelRoutes: Record<'default' | 'topic' | 'translation' | 'history' | 'cron' | 'agent', string>;
  federations: Federation[];
  blockedUsers: string[];
  devices: AuthorizedDevice[];
  providers: ProviderConnection[];
  memory: {
    enabled: boolean;
    embeddingModel: string;
    tuning: boolean;
    storage: 'sqlite' | 'postgres';
    vectorWeight: number;
    keywordWeight: number;
    entries: string[];
  };
  skills: SkillItem[];
  mcpServers: McpServer[];
  voice: {
    ttsProvider: 'system' | 'station' | 'openai';
    voice: string;
    speed: number;
    autoRead: boolean;
    sttProvider: 'system' | 'openai';
    sttLanguage: 'auto' | 'en' | 'zh-CN';
    autoStop: boolean;
  };
  cronTasks: CronTask[];
  primarySearchProvider: string;
  channels: Channel[];
  applets: Applet[];
  storage: {
    status: 'ready' | 'measuring' | 'error';
    stale: boolean;
    measuredAt: string;
    messagesMb: number;
    mediaMb: number;
    cacheMb: number;
    systemMb: number;
    retention: 'forever' | '365' | '90' | '30';
    conversations: StorageConversation[];
  };
  files: StoredFile[];
  logs: LogEntry[];
};

export function createInitialMobileSettingsState(): MobileSettingsState {
  return {
    profile: {
      displayName: 'Alice Chen',
      bio: 'Building decentralized social networks.',
      region: 'Asia East',
      timezone: 'Asia/Shanghai',
      avatarSrc: demoAvatarUrls.alice,
    },
    toggles: {
      mentions: true,
      invites: true,
      friendRequests: true,
      reactions: false,
      networkEvents: true,
      inApp: true,
      sound: false,
      pinLock: true,
      discoverable: true,
      peersFederation: true,
      labFederation: false,
      eastFederation: true,
      diagnostics: false,
      logAutoFollow: true,
    },
    language: 'en',
    reach: 'federations',
    federationVisibility: 'federations',
    defaultVisibility: 'followers',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet',
    defaultEffort: 'medium',
    modelRoutes: {
      default: 'claude-sonnet',
      topic: 'gpt-5',
      translation: 'claude-sonnet',
      history: 'gpt-5',
      cron: 'claude-sonnet',
      agent: 'gpt-5',
    },
    federations: [
      {
        id: 'peers',
        name: 'Peers Social Network',
        endpoint: 'federation.peers.social',
        role: 'Operator',
        stations: 12,
      },
      {
        id: 'lab',
        name: 'Lab Federation',
        endpoint: 'fed.lab.internal',
        role: 'Member',
        stations: 3,
      },
      {
        id: 'east',
        name: 'East Asia Network',
        endpoint: 'east.peers.network',
        role: 'Member',
        stations: 7,
      },
    ],
    blockedUsers: ['Bob Lin', 'Carol Wu'],
    devices: [
      { id: 'this', name: 'This iPhone', detail: 'iOS · current session', current: true },
      { id: 'mac', name: 'MacBook Pro', detail: 'macOS · last seen 2h ago', current: false },
    ],
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        runtime: 'cloud',
        enabled: true,
        status: 'ready',
        endpoint: 'https://api.anthropic.com',
        apiKey: 'configured',
        models: [
          { id: 'claude-sonnet', name: 'Claude Sonnet', enabled: true, capabilities: ['Text', 'Vision', 'Tools'] },
        ],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        runtime: 'cloud',
        enabled: true,
        status: 'ready',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'configured',
        models: [
          { id: 'gpt-5', name: 'GPT-5', enabled: true, capabilities: ['Text', 'Vision', 'Tools'] },
        ],
      },
      {
        id: 'local-runtime',
        name: 'Local runtime',
        runtime: 'local',
        enabled: false,
        status: 'unconfigured',
        endpoint: '',
        apiKey: '',
        models: [],
      },
    ],
    memory: {
      enabled: true,
      embeddingModel: 'openai:text-embedding-3-small',
      tuning: false,
      storage: 'sqlite',
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      entries: [
        'Prefers concise answers',
        'Project: Peers Touch',
        'Timezone: Asia/Shanghai',
      ],
    },
    skills: [
      { id: 'code-review', name: 'Code Review', description: 'Project review workflow', source: 'installed', enabled: true },
      { id: 'browser-testing', name: 'Browser Testing', description: 'Operate and inspect web applications', source: 'installed', enabled: true },
      { id: 'research', name: 'Research', description: 'Evidence-backed research', source: 'built-in', enabled: true },
      { id: 'prototype-design', name: 'Prototype Design', description: 'Peers Touch prototype workflow', source: 'market', enabled: true },
    ],
    mcpServers: [
      { id: 'github', name: 'GitHub', transport: 'http', owner: 'station', endpoint: 'https://mcp.github.example', enabled: true, status: 'connected' },
      { id: 'postgres', name: 'PostgreSQL', transport: 'sse', owner: 'station', endpoint: 'https://mcp.db.example/sse', enabled: true, status: 'connected' },
      { id: 'local-browser', name: 'Local Browser', transport: 'stdio', owner: 'client', endpoint: '', enabled: false, status: 'disconnected' },
    ],
    voice: {
      ttsProvider: 'system',
      voice: 'Samantha',
      speed: 1,
      autoRead: false,
      sttProvider: 'system',
      sttLanguage: 'auto',
      autoStop: true,
    },
    cronTasks: [
      { id: 'daily-brief', title: 'Daily project brief', schedule: 'Weekdays · 09:00', enabled: true, lastRun: 'Today · 09:00', lastResult: 'Succeeded' },
      { id: 'dependency-review', title: 'Weekly dependency review', schedule: 'Monday · 10:00', enabled: true, lastRun: 'Monday · 10:00', lastResult: 'Succeeded' },
    ],
    primarySearchProvider: 'brave',
    channels: [
      { id: 'email', name: 'Email', type: 'email', endpoint: 'alice@peers.social', enabled: true, status: 'ready' },
      { id: 'webhook', name: 'Webhook', type: 'webhook', endpoint: '', enabled: false, status: 'unconfigured' },
    ],
    applets: [
      { id: 'notes', name: 'Notes', version: '1.4.0', description: 'Private notes and shared documents', enabled: true, hasSettings: true },
      { id: 'tasks', name: 'Tasks', version: '1.2.1', description: 'Personal and group task tracking', enabled: true, hasSettings: true },
      { id: 'atelier', name: 'Atelier', version: '0.9.0', description: 'Agent workbench', enabled: true, hasSettings: false },
      { id: 'rss', name: 'RSS Reader', version: '0.5.0', description: 'Follow external feeds', enabled: false, hasSettings: true },
    ],
    storage: {
      status: 'ready',
      stale: false,
      measuredAt: 'Just now',
      messagesMb: 1228,
      mediaMb: 1434,
      cacheMb: 204,
      systemMb: 86,
      retention: 'forever',
      conversations: [
        { id: 'release-room', name: 'Release Room', kind: 'Group', messageMb: 324, mediaMb: 486, reclaimableMb: 604, lastActivity: 'Today · 14:32' },
        { id: 'alice', name: 'Alice Chen', kind: 'Direct', messageMb: 182, mediaMb: 96, reclaimableMb: 190, lastActivity: 'Today · 11:08', failOnce: true },
        { id: 'design', name: 'Product Design', kind: 'Group', messageMb: 126, mediaMb: 242, reclaimableMb: 278, lastActivity: 'Yesterday' },
        { id: 'bob', name: 'Bob Lin', kind: 'Direct', messageMb: 84, mediaMb: 36, reclaimableMb: 75, lastActivity: 'Monday' },
      ],
    },
    files: [
      { id: 'roadmap', name: 'roadmap.pdf', bucket: 'attachments', mime: 'application/pdf', sizeMb: 4.8, visibility: 'chat', deleted: false },
      { id: 'avatar', name: 'profile-photo.png', bucket: 'profiles', mime: 'image/png', sizeMb: 1.2, visibility: 'public', deleted: false },
      { id: 'archive', name: 'archive.zip', bucket: 'exports', mime: 'application/zip', sizeMb: 18.4, visibility: 'private', deleted: true },
    ],
    logs: [
      { id: 'log-1', level: 'info', subsystem: 'station', message: 'Station connection healthy', time: '14:42:18' },
      { id: 'log-2', level: 'debug', subsystem: 'messaging', message: 'Projection reconciled in 12 ms', time: '14:42:16' },
      { id: 'log-3', level: 'warn', subsystem: 'storage', message: 'Storage measurement is nearing refresh interval', time: '14:40:02' },
    ],
  };
}
