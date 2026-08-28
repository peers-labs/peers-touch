const MOCK_I18N_RESOURCES = {
  languages: [
    { code: 'en', name: 'English', native_name: 'English', namespaces: ['common', 'chat', 'settings', 'agent', 'search'] },
  ],
  resources: {
    en: {
      common: {
        'desktop.errorBoundary.title': 'Something went wrong',
      },
      chat: {
        'chat.input.placeholder': 'Type a message…',
        'chat.input.disabledStreaming': 'Wait for the current response to finish',
        'chat.input.disabledUploading': 'Attachments are still uploading',
        'chat.input.disabledEmpty': 'Type a message or attach a file',
        'chat.input.attachmentFallbackName': 'File',
        'chat.input.attachmentRemove': 'Remove',
        'chat.welcome.defaultDescription': 'Your intelligent assistant',
        'chat.welcome.fallbackText': 'How can I help you today?',
        'chat.welcome.status.toolsEnabled': 'Tools enabled',
        'chat.welcome.status.toolsReady': 'Tools ready',
        'chat.welcome.status.memoryEnabled': 'Memory on',
        'chat.welcome.status.memoryDisabled': 'Memory off',
        'chat.agentHeader.fallbackDescription': 'AI Assistant',
        'chat.agentHeader.providerFallback': 'Default',
        'chat.agentHeader.runtimeCli': 'CLI Runtime',
        'chat.agentHeader.openProfile': 'Open Profile',
        'chat.agentHeader.online': 'Online',
        'chat.agentHeader.offline': 'Offline',
        'chat.message.thinking.done': 'Thought complete',
        'chat.message.thinking.thinking': 'Thinking…',
        'chat.message.diagnostics.title': 'Diagnostics',
        'chat.message.diagnostics.thinking': 'Thinking',
        'chat.message.diagnostics.error': 'Error',
        'chat.message.diagnostics.provider': 'Provider',
        'chat.message.diagnostics.model': 'Model',
        'chat.message.diagnostics.tools': 'Tools',
        'chat.message.diagnostics.knowledge': 'Knowledge',
        'chat.message.diagnostics.delegation': 'Delegation',
        'chat.message.diagnostics.unknown': 'Unknown',
        'chat.message.diagnostics.none': 'None',
        'chat.message.diagnostics.duration': '{{seconds}}s',
        'chat.message.diagnostics.toolSummary': '{{total}} total, {{pending}} pending, {{failed}} failed',
        'chat.message.diagnostics.knowledgeSummary': '{{count}} chunks',
        'chat.message.diagnostics.delegationSummary': '{{total}} tasks, {{failed}} failed',
        'chat.message.errorTitle': 'Could not complete',
        'chat.message.collapsed': 'Message collapsed. Click to expand.',
        'chat.message.edit.cancel': 'Cancel',
        'chat.message.edit.save': 'Save',
        'chat.artifact.panel.title': 'Artifact',
        'chat.artifact.panel.source': 'From message {{id}}',
        'chat.artifact.panel.copy': 'Copy',
        'chat.artifact.panel.export': 'Export',
        'chat.artifact.panel.sourceAction': 'Scroll to source',
        'chat.artifact.panel.close': 'Close',
      },
      agent: {
        'agent.sidebar.searchAgents': 'Search agents…',
        'agent.sidebar.noAgentsYet': 'No agents yet',
        'agent.sidebar.startNewTopic': 'Start New Topic',
        'agent.sidebar.agentProfile': 'Agent Profile',
        'agent.sidebar.search': 'Search',
        'agent.sidebar.searchTopics': 'Search topics…',
        'agent.sidebar.topic': 'Topics',
        'agent.sidebar.topicSyncing': 'Syncing…',
        'agent.sidebar.newTopic': 'New Topic',
        'agent.sidebar.searchingMessages': 'Searching…',
        'agent.sidebar.noMessageResults': 'No results',
        'agent.sidebar.dateGroup.today': 'Today',
        'agent.sidebar.dateGroup.yesterday': 'Yesterday',
        'agent.sidebar.dateGroup.thisWeek': 'This Week',
        'agent.sidebar.dateGroup.thisMonth': 'This Month',
        'agent.sidebar.toast.agentExported': 'Agent exported',
        'agent.sidebar.toast.agentExportFailed': 'Export failed',
        'agent.sidebar.toast.agentImported': '{{name}} imported',
        'agent.sidebar.toast.agentImportFailed': 'Import failed',
        'agent.sidebar.toast.agentCloned': '{{name}} cloned',
        'agent.sidebar.toast.agentCloneFailed': 'Clone failed',
        'agent.sidebar.toast.defaultAgentUpdated': '{{name}} set as default',
        'agent.sidebar.toast.defaultAgentUpdateFailed': 'Failed to set default',
        'agent.sidebar.toast.agentPinned': '{{name}} pinned',
        'agent.sidebar.toast.agentUnpinned': '{{name}} unpinned',
        'agent.sidebar.toast.agentPinUpdateFailed': 'Pin update failed',
        'agent.sidebar.toast.agentFavorited': '{{name}} favorited',
        'agent.sidebar.toast.agentUnfavorited': '{{name}} unfavorited',
        'agent.sidebar.toast.agentFavoriteUpdateFailed': 'Favorite update failed',
      },
      search: {
        'search.tab.all': 'All',
        'search.tab.aiAnswer': 'AI Answer',
        'search.placeholder': 'Search…',
      },
      settings: {},
    },
  },
};

const MOCK_AGENT = {
  name: 'assistant',
  title: 'Peers Touch',
  description: 'Your intelligent assistant for analysis, coding, and creative work.',
  avatar: '',
  openingMessage: 'Hello! I can help you with coding, analysis, writing, and more. What would you like to work on?',
  openingQuestions: JSON.stringify([
    'Help me write a function',
    'Analyze this data',
    'Explain a concept',
  ]),
  chatConfig: JSON.stringify({ memory: { enabled: true } }),
  systemPrompt: 'You are a helpful assistant.',
};

const MOCK_MODELS = [
  { id: 'gpt-4.1', display_name: 'GPT-4.1', provider_id: 'openai', provider_name: 'OpenAI', enabled: true },
  { id: 'claude-sonnet-4', display_name: 'Claude Sonnet 4', provider_id: 'anthropic', provider_name: 'Anthropic', enabled: true },
];

export function isMockGatewayMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('mock');
}

export function mockInvoke(cmd: string, _args?: Record<string, unknown>): unknown {
  switch (cmd) {
    case 'i18n_load_resources':
      return { ok: true, data: MOCK_I18N_RESOURCES };

    case 'auth_restore_session':
      return { ok: true, data: { command: cmd, status: '', actor_id: 'mock-user-1', name: 'Demo User', email: 'demo@peers.touch', login_method: 'password' } };
    case 'auth_validate_token':
    case 'ensure_station_session':
      return { ok: true, data: { command: cmd, status: '' } };

    case 'account_list_restorable':
      return { ok: true, data: { command: cmd, status: JSON.stringify({ accounts: [{ id: 'mock-user-1', name: 'Demo User', email: 'demo@peers.touch', provider: 'local', has_pin: false, has_session: true }] }) } };
    case 'account_get_active':
      return { ok: true, data: { command: cmd, status: JSON.stringify({ account: { id: 'mock-user-1', name: 'Demo User', email: 'demo@peers.touch', provider: 'local', has_pin: false, has_session: true } }) } };
    case 'applets_product_window_launch_context':
    case 'applets_readiness_probe_context':
      return { ok: true, data: { command: cmd, status: JSON.stringify({ enabled: false }) } };

    case 'sync_user_profile':
      return { ok: true, data: { command: cmd, status: JSON.stringify({ name: 'Demo User', email: 'demo@peers.touch', avatar_url: '' }) } };

    case 'agent_list':
      return { ok: true, data: [MOCK_AGENT] };
    case 'agent_get':
      return { ok: true, data: MOCK_AGENT };
    case 'agent_get_selected':
      return { ok: true, data: 'assistant' };
    case 'agent_set_selected':
      return { ok: true, data: null };
    case 'model_list_available':
      return { ok: true, data: MOCK_MODELS };

    case 'chat_list_sessions':
    case 'agent_topic_list':
      return { ok: true, data: [] };
    case 'chat_get_messages':
      return { ok: true, data: [] };
    case 'chat_create_session':
      return { ok: true, data: { key: `mock-session-${Date.now()}` } };

    case 'provider_list':
      return { ok: true, data: [{ id: 'openai', name: 'OpenAI', enabled: true, base_url: '' }] };
    case 'mcp_list_servers':
    case 'skill_list':
    case 'search_sources':
    case 'applet_list':
    case 'oauth2_list_connections':
    case 'notification_list':
    case 'federation_station_list':
      return { ok: true, data: [] };

    case 'context_snapshot_get':
    case 'context_action_dispatch':
    case 'preference_get':
    case 'preference_set':
    case 'realtime_stream_start':
    case 'realtime_stream_stop':
      return { ok: true, data: null };

    default:
      return { ok: true, data: null };
  }
}
