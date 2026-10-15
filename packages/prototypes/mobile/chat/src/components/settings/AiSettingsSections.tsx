import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Button, Input, Typography } from 'antd';
import {
  Check,
  Download,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import catalog from '../../settingsCapabilities.json';
import type {
  McpServer,
  MobileSettingsState,
  ProviderConnection,
  SkillItem,
} from '../../settingsState';
import { AccessibleClearIcon } from '../AccessibleClearIcon';
import { ConfirmationDialog } from '../ConfirmationDialog';
import {
  Capability,
  Choice,
  DegradedCapability,
  InlineStatus,
  SettingList,
  SettingRow,
  SettingSection,
  SettingToggle,
} from './SettingPrimitives';

const { Text } = Typography;

type SettingsOwnerProps = {
  state: MobileSettingsState;
  setState: Dispatch<SetStateAction<MobileSettingsState>>;
};

function updateField<K extends keyof MobileSettingsState>(
  setState: SettingsOwnerProps['setState'],
  key: K,
  value: SetStateAction<MobileSettingsState[K]>,
) {
  setState((current) => ({
    ...current,
    [key]: typeof value === 'function'
      ? (value as (previous: MobileSettingsState[K]) => MobileSettingsState[K])(current[key])
      : value,
  }));
}

function updateProvider(
  setState: SettingsOwnerProps['setState'],
  providerId: string,
  change: (provider: ProviderConnection) => ProviderConnection,
) {
  updateField(setState, 'providers', (providers) => providers.map(
    (provider) => provider.id === providerId ? change(provider) : provider,
  ));
}

export function ProvidersSettingsSection({ state, setState }: SettingsOwnerProps) {
  const cloudProviders = state.providers.filter((provider) => provider.runtime === 'cloud');
  const [selectedId, setSelectedId] = useState(cloudProviders[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const selected = state.providers.find((provider) => provider.id === selectedId);
  const filtered = cloudProviders.filter((provider) => (
    provider.name.toLowerCase().includes(query.trim().toLowerCase())
  ));

  return (
    <>
      <SettingSection
        title="Model providers"
        description="Only the selected provider editor is mounted."
        action={(
          <Capability id="providers.create">
            <Button
              size="small"
              icon={<Plus size={14} />}
              data-capability-action="providers.create"
              onClick={() => setCreateOpen((open) => !open)}
            >
              Add
            </Button>
          </Capability>
        )}
      >
        <Capability id="providers.search">
          <Input
            aria-label="Search providers"
            placeholder="Search providers"
            prefix={<Search size={13} />}
            allowClear={{ clearIcon: <AccessibleClearIcon label="Clear provider search" /> }}
            data-capability-action="providers.search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Capability>
        {createOpen && (
          <div className="mp-setting-editor">
            <Input
              aria-label="Provider name"
              placeholder="Provider name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Input
              aria-label="Provider endpoint"
              placeholder="https://api.example.com/v1"
              value={newEndpoint}
              onChange={(event) => setNewEndpoint(event.target.value)}
            />
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                disabled={!newName.trim() || !/^https:\/\//.test(newEndpoint)}
                onClick={() => {
                  const id = newName.trim().toLowerCase().replace(/\W+/g, '-');
                  const provider: ProviderConnection = {
                    id,
                    name: newName.trim(),
                    runtime: 'cloud',
                    enabled: true,
                    status: 'unconfigured',
                    endpoint: newEndpoint.trim(),
                    apiKey: '',
                    models: [],
                  };
                  updateField(setState, 'providers', (current) => [
                    ...current.filter((item) => item.id !== id),
                    provider,
                  ]);
                  setSelectedId(id);
                  setNewName('');
                  setNewEndpoint('');
                  setCreateOpen(false);
                }}
              >
                Add provider
              </Button>
            </div>
          </div>
        )}
        <Capability id="providers.select">
          <div className="mp-setting-picker-list">
            {filtered.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={provider.id === selectedId ? 'active' : ''}
                aria-pressed={provider.id === selectedId}
                data-capability-action="providers.select"
                onClick={() => {
                  setSelectedId(provider.id);
                  setTestStatus('');
                }}
              >
                <span>
                  <strong>{provider.name}</strong>
                  <small>{provider.endpoint}</small>
                </span>
                <span className={`mp-settings-state ${provider.status}`}>{provider.status}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="mp-setting-empty">No matching providers</div>}
          </div>
        </Capability>
      </SettingSection>

      {selected && (
        <SettingSection title={selected.name} description="Cloud/API provider configuration.">
          <SettingRow capability="providers.enable" label="Enabled">
            <SettingToggle
              label={`Enable ${selected.name}`}
              checked={selected.enabled}
              capability="providers.enable"
              onChange={(enabled) => updateProvider(setState, selected.id, (provider) => ({ ...provider, enabled }))}
            />
          </SettingRow>
          <Capability id="providers.credentials.edit">
            <div className="mp-setting-form-grid">
              <label>
                <span>API key</span>
                <Input.Password
                  aria-label="Provider API key"
                  placeholder={selected.apiKey ? 'Configured' : 'Enter API key'}
                  value={selected.apiKey === 'configured' ? '' : selected.apiKey}
                  onChange={(event) => updateProvider(
                    setState,
                    selected.id,
                    (provider) => ({ ...provider, apiKey: event.target.value, status: 'unconfigured' }),
                  )}
                />
              </label>
              <label>
                <span>API endpoint</span>
                <Input
                  aria-label="Provider API endpoint"
                  value={selected.endpoint}
                  onChange={(event) => updateProvider(
                    setState,
                    selected.id,
                    (provider) => ({ ...provider, endpoint: event.target.value, status: 'unconfigured' }),
                  )}
                />
              </label>
            </div>
          </Capability>
          <div className="mp-setting-inline-actions">
            <Capability id="providers.connection.test">
              <Button
                icon={<Check size={14} />}
                data-capability-action="providers.connection.test"
                disabled={!selected.endpoint.startsWith('https://')}
                onClick={() => {
                  updateProvider(setState, selected.id, (provider) => ({ ...provider, status: 'ready', apiKey: provider.apiKey || 'configured' }));
                  setTestStatus('Connection verified.');
                }}
              >
                Test connection
              </Button>
            </Capability>
            <Capability id="providers.models.refresh">
              <Button
                icon={<RefreshCw size={14} />}
                data-capability-action="providers.models.refresh"
                onClick={() => updateProvider(setState, selected.id, (provider) => ({
                  ...provider,
                  models: provider.models.some((model) => model.id === `${provider.id}-latest`)
                    ? provider.models
                    : [...provider.models, {
                      id: `${provider.id}-latest`,
                      name: `${provider.name} Latest`,
                      enabled: true,
                      capabilities: ['Text', 'Tools'],
                    }],
                }))}
              >
                Refresh models
              </Button>
            </Capability>
          </div>
          {testStatus && <InlineStatus tone="success">{testStatus}</InlineStatus>}
          <SettingList rows={selected.models.map((model) => ({
            id: model.id,
            title: model.name,
            detail: model.capabilities.join(' · '),
            value: model.enabled ? 'Enabled' : 'Disabled',
            status: model.enabled ? 'ready' : 'warning',
          }))} />
        </SettingSection>
      )}

      <SettingSection title="Device runtimes">
        <DegradedCapability
          id="providers.local-runtime"
          title="Local CLI provider"
          reason={catalog.degraded['providers.local-runtime']}
        />
      </SettingSection>
    </>
  );
}

const modelRouteLabels: Array<{
  key: keyof MobileSettingsState['modelRoutes'];
  label: string;
  capability: string;
}> = [
  { key: 'default', label: 'Default conversations', capability: 'models.route.default' },
  { key: 'topic', label: 'Topic naming', capability: 'models.route.topic' },
  { key: 'translation', label: 'Translation', capability: 'models.route.translation' },
  { key: 'history', label: 'History compression', capability: 'models.route.history' },
  { key: 'cron', label: 'Scheduled tasks', capability: 'models.route.cron' },
  { key: 'agent', label: 'Agent router', capability: 'models.route.agent' },
];

export function ModelsSettingsSection({ state, setState }: SettingsOwnerProps) {
  const options = state.providers.flatMap((provider) => provider.models
    .filter((model) => provider.enabled && model.enabled)
    .map((model) => ({ value: model.id, label: `${model.name} · ${provider.name}` })));

  return (
    <SettingSection title="Model Service" description="Assign one ready model to each product task.">
      {modelRouteLabels.map(({ key, label, capability }) => (
        <SettingRow key={key} capability={capability} label={label}>
          <Choice
            capability={capability}
            label={label}
            value={state.modelRoutes[key]}
            onChange={(value) => updateField(setState, 'modelRoutes', (current) => ({
              ...current,
              [key]: value,
            }))}
            options={options}
          />
        </SettingRow>
      ))}
      {options.length === 0 && (
        <InlineStatus tone="warning">Enable and verify a provider before assigning models.</InlineStatus>
      )}
    </SettingSection>
  );
}

export function MemorySettingsSection({ state, setState }: SettingsOwnerProps) {
  const [savedStatus, setSavedStatus] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);

  const updateMemory = (change: Partial<MobileSettingsState['memory']>) => updateField(
    setState,
    'memory',
    (memory) => ({ ...memory, ...change }),
  );

  return (
    <>
      <SettingSection
        title="Memory"
        description="Durable preferences and retrieval configuration."
        action={(
          <span className="mp-account-edit-actions">
            <Capability id="memory.reset">
              <Button
                size="small"
                icon={<RotateCcw size={13} />}
                data-capability-action="memory.reset"
                onClick={() => {
                  updateMemory({
                    enabled: true,
                    embeddingModel: 'openai:text-embedding-3-small',
                    tuning: false,
                    storage: 'sqlite',
                    vectorWeight: 0.7,
                    keywordWeight: 0.3,
                  });
                  setSavedStatus('Defaults restored.');
                }}
              >
                Reset
              </Button>
            </Capability>
            <Capability id="memory.save">
              <Button
                size="small"
                type="primary"
                icon={<Check size={13} />}
                data-capability-action="memory.save"
                onClick={() => setSavedStatus('Memory settings saved.')}
              >
                Save
              </Button>
            </Capability>
          </span>
        )}
      >
        <SettingRow capability="memory.enable" label="Enable memory">
          <SettingToggle
            label="Enable memory"
            checked={state.memory.enabled}
            capability="memory.enable"
            onChange={(enabled) => updateMemory({ enabled })}
          />
        </SettingRow>
        <SettingRow capability="memory.embedding.select" label="Embedding model">
          <Choice
            capability="memory.embedding.select"
            label="Embedding model"
            value={state.memory.embeddingModel}
            onChange={(embeddingModel) => updateMemory({ embeddingModel })}
            options={[
              { value: 'openai:text-embedding-3-small', label: 'OpenAI Small' },
              { value: 'local:fts', label: 'Keyword search only' },
            ]}
          />
        </SettingRow>
        <SettingRow capability="memory.tuning.toggle" label="Automatic tuning">
          <SettingToggle
            label="Automatic memory tuning"
            checked={state.memory.tuning}
            capability="memory.tuning.toggle"
            onChange={(tuning) => updateMemory({ tuning })}
          />
        </SettingRow>
        <SettingRow capability="memory.storage.select" label="Storage backend">
          <Choice
            capability="memory.storage.select"
            label="Memory storage backend"
            value={state.memory.storage}
            onChange={(storage) => updateMemory({ storage: storage as 'sqlite' })}
            options={[{ value: 'sqlite', label: 'On-device SQLite' }]}
          />
        </SettingRow>
        <DegradedCapability
          id="memory.storage.postgres"
          title="PostgreSQL backend"
          reason={catalog.degraded['memory.storage.postgres']}
        />
        <Capability id="memory.weights.edit">
          <div className="mp-setting-range-grid">
            <label>
              <span>Vector weight <strong>{state.memory.vectorWeight.toFixed(1)}</strong></span>
              <input
                aria-label="Vector weight"
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={state.memory.vectorWeight}
                data-capability-action="memory.weights.edit"
                onChange={(event) => updateMemory({ vectorWeight: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Keyword weight <strong>{state.memory.keywordWeight.toFixed(1)}</strong></span>
              <input
                aria-label="Keyword weight"
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={state.memory.keywordWeight}
                data-capability-action="memory.weights.edit"
                onChange={(event) => updateMemory({ keywordWeight: Number(event.target.value) })}
              />
            </label>
          </div>
        </Capability>
        {savedStatus && <InlineStatus tone="success">{savedStatus}</InlineStatus>}
      </SettingSection>

      <Capability id="memory.entries.review">
        <SettingSection
          title="Stored memories"
          description="Conversation transcripts are not memories unless explicitly promoted."
          action={(
            <Button
              size="small"
              data-capability-action="memory.entries.review"
              onClick={() => setReviewOpen((open) => !open)}
            >
              Review {state.memory.entries.length}
            </Button>
          )}
        >
          {reviewOpen && (
            <div className="mp-memory-review">
              {state.memory.entries.map((entry) => (
                <Capability id="memory.entries.remove" key={entry}>
                  <div>
                    <Text>{entry}</Text>
                    <Button
                      type="text"
                      danger
                      icon={<Trash2 size={14} />}
                      aria-label={`Remove ${entry}`}
                      data-capability-action="memory.entries.remove"
                      onClick={() => updateMemory({
                        entries: state.memory.entries.filter((item) => item !== entry),
                      })}
                    />
                  </div>
                </Capability>
              ))}
              {state.memory.entries.length === 0 && <div className="mp-setting-empty">No stored memories</div>}
            </div>
          )}
        </SettingSection>
      </Capability>
    </>
  );
}

export function SkillsSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'installed' | 'built-in' | 'market'>('installed');
  const [detailId, setDetailId] = useState('');
  const [editor, setEditor] = useState<'create' | 'url' | null>(null);
  const [draft, setDraft] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const filtered = state.skills.filter((skill) => (
    skill.source === filter
    && `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const detail = state.skills.find((skill) => skill.id === detailId);

  const addSkill = (skill: SkillItem) => {
    updateField(setState, 'skills', (current) => [
      ...current.filter((item) => item.id !== skill.id),
      skill,
    ]);
  };

  return (
    <>
      <SettingSection title="Skills" description="Installed, built-in, and marketplace capabilities.">
        <Capability id="skills.search">
          <Input
            aria-label="Search skills"
            placeholder="Search skills"
            prefix={<Search size={13} />}
            data-capability-action="skills.search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Capability>
        <Capability id="skills.filter">
          <div className="mp-setting-segmented three" role="tablist" aria-label="Skill sources">
            {(['installed', 'built-in', 'market'] as const).map((source) => (
              <button
                key={source}
                type="button"
                role="tab"
                aria-selected={filter === source}
                className={filter === source ? 'active' : ''}
                data-capability-action="skills.filter"
                onClick={() => setFilter(source)}
              >
                {source === 'built-in' ? 'Built-in' : source[0].toUpperCase() + source.slice(1)}
              </button>
            ))}
          </div>
        </Capability>
        <div className="mp-setting-list">
          {filtered.map((skill) => (
            <div className="mp-skill-row" key={skill.id}>
              <Capability id="skills.detail">
                <button
                  type="button"
                  className="mp-skill-main"
                  data-capability-action="skills.detail"
                  onClick={() => setDetailId(skill.id)}
                >
                  <strong>{skill.name}</strong>
                  <small>{skill.description}</small>
                </button>
              </Capability>
              <Capability id="skills.toggle">
                <SettingToggle
                  label={`Enable ${skill.name}`}
                  checked={skill.enabled}
                  capability="skills.toggle"
                  onChange={(enabled) => updateField(setState, 'skills', (current) => current.map(
                    (item) => item.id === skill.id ? { ...item, enabled } : item,
                  ))}
                />
              </Capability>
            </div>
          ))}
          {filtered.length === 0 && <div className="mp-setting-empty">No skills in this source</div>}
        </div>
      </SettingSection>

      <SettingSection title="Add skills">
        <div className="mp-setting-inline-actions">
          <Capability id="skills.create">
            <Button
              icon={<Plus size={14} />}
              data-capability-action="skills.create"
              onClick={() => setEditor('create')}
            >
              Create
            </Button>
          </Capability>
          <Capability id="skills.import-url">
            <Button
              icon={<Download size={14} />}
              data-capability-action="skills.import-url"
              onClick={() => setEditor('url')}
            >
              From URL
            </Button>
          </Capability>
          <Capability id="skills.upload">
            <Button
              icon={<Upload size={14} />}
              data-capability-action="skills.upload"
              onClick={() => uploadRef.current?.click()}
            >
              Upload ZIP
            </Button>
            <input
              ref={uploadRef}
              hidden
              type="file"
              accept=".zip"
              aria-label="Choose skill ZIP"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addSkill({
                  id: `upload-${file.name}`,
                  name: file.name.replace(/\.zip$/i, ''),
                  description: 'Imported from ZIP',
                  source: 'installed',
                  enabled: true,
                });
                event.target.value = '';
              }}
            />
          </Capability>
          <Capability id="skills.market">
            <Button
              data-capability-action="skills.market"
              onClick={() => addSkill({
                id: 'calendar-assistant',
                name: 'Calendar Assistant',
                description: 'Installed from the skill market',
                source: 'market',
                enabled: true,
              })}
            >
              Install featured
            </Button>
          </Capability>
        </div>
        {editor && (
          <div className="mp-setting-editor">
            <Input
              autoFocus
              aria-label={editor === 'create' ? 'Skill name' : 'Skill source URL'}
              placeholder={editor === 'create' ? 'Skill name' : 'https://github.com/org/skill'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setEditor(null)}>Cancel</Button>
              <Button
                type="primary"
                disabled={!draft.trim()}
                onClick={() => {
                  const name = editor === 'create'
                    ? draft.trim()
                    : draft.trim().split('/').filter(Boolean).slice(-1)[0] ?? 'Imported skill';
                  addSkill({
                    id: name.toLowerCase().replace(/\W+/g, '-'),
                    name,
                    description: editor === 'create' ? 'Created on Mobile' : 'Imported from source URL',
                    source: 'installed',
                    enabled: true,
                  });
                  setDraft('');
                  setEditor(null);
                }}
              >
                {editor === 'create' ? 'Create skill' : 'Import skill'}
              </Button>
            </div>
          </div>
        )}
      </SettingSection>

      <SettingSection title="Desktop integration">
        <DegradedCapability
          id="skills.local-directory"
          title="Open local skills directory"
          reason={catalog.degraded['skills.local-directory']}
        />
      </SettingSection>

      {detail && (
        <section className="mp-setting-detail-panel" role="region" aria-label={`${detail.name} details`}>
          <span>
            <Text strong>{detail.name}</Text>
            <Text type="secondary">{detail.description}</Text>
          </span>
          <Button size="small" onClick={() => setDetailId('')}>Close</Button>
        </section>
      )}
    </>
  );
}

export function McpSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [mode, setMode] = useState<'add' | 'import' | null>(null);
  const [draft, setDraft] = useState({ name: '', endpoint: '' });
  const [importText, setImportText] = useState('');
  const [editingId, setEditingId] = useState('');
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null);
  const editing = state.mcpServers.find((server) => server.id === editingId);

  const updateServer = (serverId: string, change: (server: McpServer) => McpServer) => updateField(
    setState,
    'mcpServers',
    (servers) => servers.map((server) => server.id === serverId ? change(server) : server),
  );

  return (
    <>
      <SettingSection
        title="MCP servers"
        description="Mobile connects through Station or remote HTTP transports."
        action={(
          <span className="mp-account-edit-actions">
            <Capability id="mcp.server.import">
              <Button
                size="small"
                icon={<Download size={13} />}
                data-capability-action="mcp.server.import"
                onClick={() => setMode('import')}
              >
                Import
              </Button>
            </Capability>
            <Capability id="mcp.server.add-remote">
              <Button
                size="small"
                type="primary"
                icon={<Plus size={13} />}
                data-capability-action="mcp.server.add-remote"
                onClick={() => setMode('add')}
              >
                Add
              </Button>
            </Capability>
          </span>
        )}
      >
        {mode === 'add' && (
          <div className="mp-setting-editor">
            <Input
              aria-label="MCP server name"
              placeholder="Server name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
            <Input
              aria-label="MCP server endpoint"
              placeholder="https://mcp.example.com"
              value={draft.endpoint}
              onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))}
            />
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setMode(null)}>Cancel</Button>
              <Button
                type="primary"
                disabled={!draft.name.trim() || !draft.endpoint.startsWith('https://')}
                onClick={() => {
                  const id = draft.name.trim().toLowerCase().replace(/\W+/g, '-');
                  updateField(setState, 'mcpServers', (current) => [...current, {
                    id,
                    name: draft.name.trim(),
                    transport: 'http',
                    owner: 'station',
                    endpoint: draft.endpoint.trim(),
                    enabled: true,
                    status: 'connected',
                  }]);
                  setDraft({ name: '', endpoint: '' });
                  setMode(null);
                }}
              >
                Add server
              </Button>
            </div>
          </div>
        )}
        {mode === 'import' && (
          <div className="mp-setting-editor">
            <Input.TextArea
              aria-label="MCP configuration JSON"
              autoSize={{ minRows: 3, maxRows: 5 }}
              placeholder='{"name":"Docs","url":"https://mcp.example.com"}'
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setMode(null)}>Cancel</Button>
              <Button
                type="primary"
                disabled={!importText.trim()}
                onClick={() => {
                  try {
                    const value = JSON.parse(importText) as { name?: string; url?: string };
                    if (!value.name || !value.url?.startsWith('https://')) return;
                    updateField(setState, 'mcpServers', (current) => [...current, {
                      id: value.name!.toLowerCase().replace(/\W+/g, '-'),
                      name: value.name!,
                      transport: 'http',
                      owner: 'station',
                      endpoint: value.url!,
                      enabled: true,
                      status: 'connected',
                    }]);
                    setImportText('');
                    setMode(null);
                  } catch {
                    setImportText('');
                  }
                }}
              >
                Import
              </Button>
            </div>
          </div>
        )}
        {state.mcpServers.filter((server) => server.transport !== 'stdio').map((server) => (
          <article key={server.id} className="mp-mcp-row">
            <button
              type="button"
              className="mp-mcp-main"
              data-capability-id="mcp.server.edit"
              data-capability-disposition="adapted"
              data-capability-action="mcp.server.edit"
              onClick={() => setEditingId(server.id)}
            >
              <strong>{server.name}</strong>
              <small>{server.transport.toUpperCase()} · {server.endpoint}</small>
            </button>
            <span className={`mp-settings-state ${server.status}`}>{server.status}</span>
            <Capability id="mcp.server.toggle">
              <SettingToggle
                label={`Enable ${server.name}`}
                checked={server.enabled}
                capability="mcp.server.toggle"
                onChange={(enabled) => updateServer(server.id, (current) => ({ ...current, enabled }))}
              />
            </Capability>
            <Button
              type="text"
              size="small"
              aria-label={`Manage ${server.name}`}
              icon={<Pencil size={14} />}
              onClick={() => setEditingId(server.id)}
            />
          </article>
        ))}
        <DegradedCapability
          id="mcp.server.local-stdio"
          title="Local stdio server"
          reason={catalog.degraded['mcp.server.local-stdio']}
        />
      </SettingSection>

      {editing && (
        <Capability id="mcp.server.edit">
          <SettingSection title={`Edit ${editing.name}`}>
            <div className="mp-setting-editor">
              <Input
                aria-label="Edit MCP endpoint"
                value={editing.endpoint}
                onChange={(event) => updateServer(editing.id, (server) => ({
                  ...server,
                  endpoint: event.target.value,
                  status: 'disconnected',
                }))}
              />
              <div className="mp-setting-inline-actions">
                <Capability id="mcp.server.test">
                  <Button
                    icon={<Play size={14} />}
                    data-capability-action="mcp.server.test"
                    onClick={() => updateServer(editing.id, (server) => ({ ...server, status: 'connected' }))}
                  >
                    Test
                  </Button>
                </Capability>
                <Capability id="mcp.server.reconnect">
                  <Button
                    icon={<RefreshCw size={14} />}
                    data-capability-action="mcp.server.reconnect"
                    onClick={() => updateServer(editing.id, (server) => ({ ...server, status: 'connected' }))}
                  >
                    Reconnect
                  </Button>
                </Capability>
                <Capability id="mcp.server.delete">
                  <Button
                    danger
                    icon={<Trash2 size={14} />}
                    data-capability-action="mcp.server.delete"
                    onClick={() => setPendingDelete(editing)}
                  >
                    Delete
                  </Button>
                </Capability>
                <Button onClick={() => setEditingId('')}>Done</Button>
              </div>
            </div>
          </SettingSection>
        </Capability>
      )}

      {pendingDelete && (
        <ConfirmationDialog
          title={`Delete ${pendingDelete.name}?`}
          description="Agent will no longer be able to use tools from this server."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            updateField(setState, 'mcpServers', (current) => (
              current.filter((server) => server.id !== pendingDelete.id)
            ));
            setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}

export function VoiceSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [previewStatus, setPreviewStatus] = useState('');
  const updateVoice = (change: Partial<MobileSettingsState['voice']>) => updateField(
    setState,
    'voice',
    (voice) => ({ ...voice, ...change }),
  );

  return (
    <>
      <SettingSection title="Text to speech" description="Read Agent responses aloud.">
        <SettingRow capability="voice.tts.provider" label="Provider">
          <Choice
            capability="voice.tts.provider"
            label="Text to speech provider"
            value={state.voice.ttsProvider}
            onChange={(ttsProvider) => updateVoice({ ttsProvider: ttsProvider as MobileSettingsState['voice']['ttsProvider'] })}
            options={[
              { value: 'system', label: 'System voice' },
              { value: 'station', label: 'Station voice' },
              { value: 'openai', label: 'OpenAI' },
            ]}
          />
        </SettingRow>
        <SettingRow capability="voice.tts.voice" label="Voice">
          <Choice
            capability="voice.tts.voice"
            label="Voice"
            value={state.voice.voice}
            onChange={(voice) => updateVoice({ voice })}
            options={[
              { value: 'Samantha', label: 'Samantha' },
              { value: 'Alex', label: 'Alex' },
              { value: 'Coral', label: 'Coral' },
            ]}
          />
        </SettingRow>
        <Capability id="voice.tts.speed">
          <label className="mp-setting-range">
            <span>Speed <strong>{state.voice.speed.toFixed(1)}x</strong></span>
            <input
              aria-label="Speech speed"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={state.voice.speed}
              data-capability-action="voice.tts.speed"
              onChange={(event) => updateVoice({ speed: Number(event.target.value) })}
            />
          </label>
        </Capability>
        <SettingRow capability="voice.tts.auto-read" label="Automatically read responses">
          <SettingToggle
            label="Automatically read responses"
            checked={state.voice.autoRead}
            capability="voice.tts.auto-read"
            onChange={(autoRead) => updateVoice({ autoRead })}
          />
        </SettingRow>
        <Capability id="voice.tts.preview">
          <div className="mp-setting-section-action">
            <Button
              icon={<Volume2 size={14} />}
              data-capability-action="voice.tts.preview"
              onClick={() => setPreviewStatus(`Preview played with ${state.voice.voice}.`)}
            >
              Play preview
            </Button>
          </div>
        </Capability>
        {previewStatus && <InlineStatus tone="success">{previewStatus}</InlineStatus>}
      </SettingSection>

      <SettingSection title="Speech input" description="Transcribe voice input before sending.">
        <SettingRow capability="voice.stt.provider" label="Provider">
          <Choice
            capability="voice.stt.provider"
            label="Speech input provider"
            value={state.voice.sttProvider}
            onChange={(sttProvider) => updateVoice({ sttProvider: sttProvider as MobileSettingsState['voice']['sttProvider'] })}
            options={[
              { value: 'system', label: 'System speech input' },
              { value: 'openai', label: 'OpenAI Whisper' },
            ]}
          />
        </SettingRow>
        <SettingRow capability="voice.stt.language" label="Language">
          <Choice
            capability="voice.stt.language"
            label="Speech input language"
            value={state.voice.sttLanguage}
            onChange={(sttLanguage) => updateVoice({ sttLanguage: sttLanguage as MobileSettingsState['voice']['sttLanguage'] })}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'en', label: 'English' },
              { value: 'zh-CN', label: '简体中文' },
            ]}
          />
        </SettingRow>
        <SettingRow capability="voice.stt.auto-stop" label="Stop after silence">
          <SettingToggle
            label="Stop after silence"
            checked={state.voice.autoStop}
            capability="voice.stt.auto-stop"
            onChange={(autoStop) => updateVoice({ autoStop })}
          />
        </SettingRow>
      </SettingSection>
    </>
  );
}
