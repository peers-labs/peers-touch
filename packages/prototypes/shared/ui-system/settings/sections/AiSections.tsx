/**
 * AI-group sections (desktop Settings.tsx parity, compressed):
 * Providers, Models, Discover, Memory, Skills, MCP.
 *
 * Local prototype catalogs with real local state (enable/disable, keys,
 * install/uninstall, add server); reachability checks are deterministic
 * timers, and Station-owned surfaces render honestly disabled.
 */
import { useState } from 'react';
import {
  Activity, Brain, CheckCircle2, Command, Github,
  HardDrive, Loader2, Plug, Plus, ScrollText, Search, Server, Sliders,
  XCircle,
} from 'lucide-react';
import {
  Button, IconButton, Segmented, Select, Switch, Tag, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs, type Translate } from '../../prefs';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

function useT(): { t: Translate } {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

/* ── Providers ───────────────────────────────────────────────────────── */

type ModelRow = { id: string; name: string; kind: 'chat' | 'image' | 'embedding'; enabled: boolean };
type Provider = {
  id: string; name: string; kind: 'direct' | 'cli'; enabled: boolean;
  apiKey: string; baseUrl: string; models: ModelRow[];
};

const INITIAL_PROVIDERS: Provider[] = [
  { id: 'openai', name: 'OpenAI-compatible', kind: 'direct', enabled: true, apiKey: 'sk-proj-xxxxxxxxxxxxxxxx', baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4', kind: 'chat', enabled: true },
      { id: 'text-embedding-3', name: 'text-embedding-3', kind: 'embedding', enabled: true },
      { id: 'dall-e-4', name: 'dall-e-4', kind: 'image', enabled: false },
    ] },
  { id: 'anthropic', name: 'Anthropic', kind: 'direct', enabled: false, apiKey: 'sk-ant-xxxxxxxxxxxxxxxx', baseUrl: 'https://api.anthropic.com',
    models: [{ id: 'claude-sonnet-4', name: 'claude-sonnet-4', kind: 'chat', enabled: true }] },
  { id: 'ollama', name: 'Ollama (local)', kind: 'direct', enabled: false, apiKey: '', baseUrl: 'http://127.0.0.1:11434',
    models: [
      { id: 'deepseek-v3', name: 'deepseek-v3', kind: 'chat', enabled: false },
      { id: 'nomic-embed', name: 'nomic-embed-text', kind: 'embedding', enabled: true },
    ] },
  { id: 'codex-cli', name: 'Codex CLI', kind: 'cli', enabled: false, apiKey: '', baseUrl: 'codex --json exec',
    models: [{ id: 'default', name: 'default', kind: 'chat', enabled: true }] },
];

export function ProvidersSection() {
  const { t } = useT();
  const [providers, setProviders] = useState<Provider[]>(INITIAL_PROVIDERS);
  const [selId, setSelId] = useState('openai');
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>('idle');
  const sel = providers.find(p => p.id === selId) ?? providers[0];
  const patch = (id: string, p: Partial<Provider>) =>
    setProviders(list => list.map(item => item.id === id ? { ...item, ...p } : item));

  const runTest = () => {
    setTest('testing');
    window.setTimeout(() => {
      const ok = sel.kind === 'cli' ? sel.baseUrl.length > 0 : sel.baseUrl.startsWith('http');
      setTest(ok ? 'ok' : 'fail');
    }, 700);
  };
  const testLabel = test === 'testing' ? t('ai.providers.checking')
    : test === 'ok' ? t('ai.providers.ready')
      : test === 'fail' ? t('ai.providers.notReady') : t('ai.providers.check');
  const TestIcon = test === 'testing' ? Loader2 : test === 'ok' ? CheckCircle2 : test === 'fail' ? XCircle : Activity;

  return (
    <div className="sk-providers" data-providers>
      <div className="sk-provider-list">
        {providers.map(p => (
          <button type="button" key={p.id}
            className={`sk-provider-item${p.id === selId ? ' is-active' : ''}`}
            aria-pressed={p.id === selId}
            data-provider={p.id}
            onClick={() => { setSelId(p.id); setShowKey(false); setTest('idle'); }}>
            {p.kind === 'cli' ? <Command size={16} /> : <Server size={16} />}
            <span className="sk-provider-name">{p.name}</span>
            <Tag tone={p.kind === 'cli' ? 'warning' : 'info'}>
              {p.kind === 'cli' ? t('ai.providers.cli') : t('ai.providers.direct')}
            </Tag>
            <i className="sk-dot" data-on={p.enabled ? '1' : '0'} />
          </button>
        ))}
        <div style={{ marginTop: 8 }}>
          <Button actionId="provider.add" emphasis="quiet" density="compact" leading={<Plus size={13} />}
            label={t('ai.providers.add')}
            onActivate={() => {
              const id = `direct-${Date.now()}`;
              setProviders(list => [...list, {
                id, name: 'New provider', kind: 'direct', enabled: true, apiKey: '', baseUrl: 'https://', models: [],
              }]);
              setSelId(id);
            }} />
        </div>
      </div>

      <SettingsSection icon={sel.kind === 'cli' ? Command : Server} title={sel.name}
        extra={
          <Button actionId="provider.check" emphasis="secondary" density="compact"
            leading={<TestIcon size={14} className={test === 'testing' ? 'sk-spin' : ''} />}
            label={testLabel} onActivate={runTest} />
        }>
        <SettingsRow label={t('ai.providers.enabled')} description={t('ai.providers.enabledDesc')}>
          <Switch checked={sel.enabled} aria-label={t('ai.providers.enabled')}
            onCheckedChange={checked => patch(sel.id, { enabled: checked })} />
        </SettingsRow>
        {sel.kind === 'direct' ? (
          <>
            <SettingsRow label={t('ai.providers.apiKey')}>
              <div className="sk-key-row">
                <TextField aria-label={t('ai.providers.apiKey')}
                  type={showKey ? 'text' : 'password'} value={sel.apiKey} placeholder="sk-..."
                  onValueChange={value => patch(sel.id, { apiKey: value })} />
                <IconButton actionId="provider.toggle-key" iconId={showKey ? 'eye-off' : 'eye'} iconSize={14}
                  label={showKey ? 'Hide' : 'Show'}
                  onActivate={() => setShowKey(show => !show)} />
              </div>
            </SettingsRow>
            <SettingsRow label={t('ai.providers.baseUrl')}>
              <TextField aria-label={t('ai.providers.baseUrl')} value={sel.baseUrl}
                onValueChange={value => patch(sel.id, { baseUrl: value })} />
            </SettingsRow>
            <div className="sk-model-list">
              <div className="sk-model-head">
                <strong>{t('ai.providers.models')}</strong>
                <Button actionId={`provider.${sel.id}.add-model`} emphasis="quiet" density="compact"
                  leading={<Plus size={13} />} label={t('ai.providers.addModel')}
                  onActivate={() => patch(sel.id, {
                    models: [...sel.models, { id: `m-${Date.now()}`, name: 'new-model', kind: 'chat', enabled: true }],
                  })} />
              </div>
              {sel.models.map(model => (
                <div className="sk-model-row" key={model.id}>
                  <span className="sk-model-name">{model.name}</span>
                  <Tag tone={model.kind === 'chat' ? 'info' : model.kind === 'image' ? 'warning' : 'success'}>{model.kind}</Tag>
                  <Switch checked={model.enabled} aria-label={`${model.name} enabled`}
                    onCheckedChange={checked => patch(sel.id, {
                      models: sel.models.map(m => m.id === model.id ? { ...m, enabled: checked } : m),
                    })} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <SettingsRow label={t('ai.providers.baseUrl')}>
            <code className="sk-mono">{sel.baseUrl}</code>
          </SettingsRow>
        )}
      </SettingsSection>
    </div>
  );
}

/* ── Models ───────────────────────────────────────────────────────────── */

export function ModelsSection() {
  const { t } = useT();
  const enabledProviders = INITIAL_PROVIDERS.filter(p => p.enabled);
  const [defaultModel, setDefaultModel] = useState('gpt-5.4');
  return (
    <SettingsSection icon={Brain} title={t('ai.models.title')} subtitle={t('ai.models.subtitle')}>
      <SettingsRow label={t('ai.models.default')}>
        <Select aria-label={t('ai.models.default')} value={defaultModel}
          onValueChange={value => setDefaultModel((Array.isArray(value) ? value[0] : value) ?? 'gpt-5.4')}
          options={enabledProviders.flatMap(p => p.models.filter(m => m.enabled).map(m => ({
            value: m.id, label: `${p.name} · ${m.name}`,
          })))} />
      </SettingsRow>
    </SettingsSection>
  );
}

/* ── Discover ─────────────────────────────────────────────────────────── */

const DISCOVER_PACKAGES = [
  { id: 'research-partner', name: 'Research Partner', publisher: 'Peers', type: 'Agent', installed: false },
  { id: 'source-reader', name: 'Source Reader', publisher: 'Peers', type: 'Skill', installed: true },
  { id: 'browser-tools', name: 'Browser Tools', publisher: 'Peers', type: 'MCP', installed: false },
] as const;

export function DiscoverSection() {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState<Set<string>>(
    () => new Set(DISCOVER_PACKAGES.filter(item => item.installed).map(item => item.id)));
  const packages = DISCOVER_PACKAGES.filter(item => {
    const q = query.trim().toLowerCase();
    return !q || item.name.toLowerCase().includes(q) || item.publisher.toLowerCase().includes(q)
      || item.type.toLowerCase().includes(q);
  });
  return (
    <SettingsSection icon={Search} title={t('ai.discover.title')}>
      <div className="sk-discover-toolbar">
        <TextField aria-label={t('ai.discover.search')} placeholder={t('ai.discover.search')}
          leading={<Search size={14} />} value={query} onValueChange={setQuery} />
      </div>
      {packages.map(item => (
        <div className="sk-package-row" key={item.id} data-package={item.id}>
          <div className="sk-package-id">
            <strong>{item.name}</strong>
            <span>{item.publisher}</span>
          </div>
          <Tag tone="neutral">{item.type}</Tag>
          {installed.has(item.id) ? (
            <Button actionId={`discover.${item.id}.uninstall`} emphasis="quiet" density="compact" label={t('ai.discover.uninstall')}
              onActivate={() => setInstalled(current => {
                const next = new Set(current); next.delete(item.id); return next;
              })} />
          ) : (
            <Button actionId={`discover.${item.id}.install`} emphasis="secondary" density="compact" leading={<Plus size={13} />}
              label={t('ai.discover.install')}
              onActivate={() => setInstalled(current => new Set(current).add(item.id))} />
          )}
        </div>
      ))}
      {packages.length === 0 && <p className="sk-field-hint" style={{ textAlign: 'center', padding: 24 }}>{t('ai.discover.empty')}</p>}
    </SettingsSection>
  );
}

/* ── Memory ───────────────────────────────────────────────────────────── */

export function MemorySection() {
  const { t } = useT();
  const [enabled, setEnabled] = useState(true);
  const [backend, setBackend] = useState<'sqlite' | 'postgres'>('sqlite');
  const [dsnTest, setDsnTest] = useState<TestState>('idle');
  const [vectorWeight, setVectorWeight] = useState(70);
  return (
    <>
      <SettingsSection icon={Brain} title={t('ai.memory.title')} subtitle={t('ai.memory.subtitle')}>
        <SettingsRow label={t('ai.memory.enable')} description={t('ai.memory.enableDesc')}>
          <Switch checked={enabled} aria-label={t('ai.memory.enable')}
            data-memory="enabled" onCheckedChange={setEnabled} />
        </SettingsRow>
        <SettingsRow label={t('ai.memory.embedding')} description={t('ai.memory.embeddingDesc')}>
          <Select aria-label={t('ai.memory.embedding')} defaultValue="text-embedding-3"
            options={[
              { value: 'text-embedding-3', label: 'text-embedding-3' },
              { value: 'nomic-embed-text', label: 'nomic-embed-text' },
            ]} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection icon={HardDrive} title={t('ai.memory.backend')} subtitle={t('ai.memory.backendDesc')}>
        <SettingsRow label={t('ai.memory.backend')}>
          <Segmented2
            value={backend} onChange={setBackend}
            options={[
              { value: 'sqlite', label: 'SQLite' },
              { value: 'postgres', label: 'PostgreSQL' },
            ]} />
        </SettingsRow>
        {backend === 'postgres' && (
          <div className="sk-dsn-row">
            <TextField aria-label={t('ai.memory.dsn')}
              defaultValue="postgres://user:***@localhost:5432/peers_memory" />
            <Button actionId="memory.dsn-test" emphasis="secondary" density="compact"
              leading={dsnTest === 'testing' ? <Loader2 size={14} className="sk-spin" />
                : dsnTest === 'ok' ? <CheckCircle2 size={14} /> : <Activity size={14} />}
              label={dsnTest === 'testing' ? '…' : dsnTest === 'ok' ? t('ai.memory.reachable') : t('ai.memory.test')}
              onActivate={() => { setDsnTest('testing'); window.setTimeout(() => setDsnTest('ok'), 650); }} />
          </div>
        )}
      </SettingsSection>
      <SettingsSection icon={Sliders} title={t('ai.memory.weights')} subtitle={t('ai.memory.weightsDesc')}>
        <div className="sk-weights" data-weights>
          <label>
            <span>{t('ai.memory.vector')}<em>{vectorWeight}%</em></span>
            <input type="range" min={0} max={100} value={vectorWeight} data-weight="vector"
              onChange={event => setVectorWeight(Number(event.target.value))} />
          </label>
          <label>
            <span>{t('ai.memory.keyword')}<em>{100 - vectorWeight}%</em></span>
            <input type="range" min={0} max={100} value={100 - vectorWeight} data-weight="keyword" readOnly />
          </label>
        </div>
      </SettingsSection>
    </>
  );
}

/* ── Skills ───────────────────────────────────────────────────────────── */

type SkillItem = { id: string; name: string; desc: string; source: 'builtin' | 'peers' | 'user'; scan: 'passed' | 'warning'; enabled: boolean; installed: boolean };
const INITIAL_SKILLS: SkillItem[] = [
  { id: 'sk-meeting-digest', name: '会议纪要', desc: '自动生成会议纪要与行动项', source: 'peers', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-commit-helper', name: '提交助手', desc: '生成规范提交信息', source: 'peers', scan: 'warning', enabled: true, installed: true },
  { id: 'sk-builtin-search', name: '内置检索', desc: '工作区语义检索', source: 'builtin', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-code-reviewer', name: 'Code Reviewer', desc: '差异审查与风险提示', source: 'peers', scan: 'passed', enabled: false, installed: false },
];

export function SkillsSection() {
  const { t } = useT();
  const [tab, setTab] = useState<'installed' | 'builtin' | 'market'>('installed');
  const [skills, setSkills] = useState<SkillItem[]>(INITIAL_SKILLS);
  const [importOpen, setImportOpen] = useState(false);
  const [addr, setAddr] = useState('');
  const list = skills.filter(s =>
    tab === 'installed' ? s.installed && s.source !== 'builtin'
      : tab === 'builtin' ? s.source === 'builtin'
        : !s.installed);
  const patch = (id: string, p: Partial<SkillItem>) =>
    setSkills(prev => prev.map(s => s.id === id ? { ...s, ...p } : s));
  const doImport = () => {
    if (!addr.trim()) return;
    const name = addr.trim().split('/').pop()?.replace(/\.(zip|git)$/, '') || 'imported-skill';
    setSkills(prev => [{
      id: `sk-${Date.now()}`, name, desc: `Imported from ${addr}`, source: 'user',
      scan: 'warning', enabled: false, installed: true,
    }, ...prev]);
    setAddr(''); setImportOpen(false); setTab('installed');
  };
  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'installed', label: t('ai.skills.installed') },
    { id: 'builtin', label: t('ai.skills.builtin') },
    { id: 'market', label: t('ai.skills.market') },
  ];
  return (
    <SettingsSection icon={ScrollText} title={t('ai.skills.title')} subtitle={t('ai.skills.subtitle')}
      extra={<Button actionId="skill.import-open" emphasis="primary" density="compact" leading={<Plus size={13} />}
        label={t('ai.skills.import')} onActivate={() => setImportOpen(open => !open)} />}>
      {importOpen && (
        <div className="sk-skill-import" data-skill-import>
          <div className="sk-skill-import-kinds">
            <Github size={14} /> GitHub
          </div>
          <div className="sk-inline-actions" style={{ alignItems: 'center' }}>
            <TextField aria-label="owner/repo" placeholder="owner/repo" value={addr}
              onValueChange={setAddr} onEnter={event => { event.preventDefault(); doImport(); }} />
            <Button actionId="skill.import-confirm" emphasis="primary" density="compact"
              label={t('common.confirm')}
              availability={!addr.trim() ? { kind: 'disabled', reason: t('skill.importAddrReason') } : undefined}
              onActivate={doImport} />
          </div>
        </div>
      )}
      <div className="sk-subtabs" data-skill-tabs>
        {tabs.map(item => (
          <button type="button" key={item.id}
            className={`sk-subtab${tab === item.id ? ' is-active' : ''}`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>
      {list.length === 0
        ? <p className="sk-field-hint">{t('ai.skills.empty')}</p>
        : list.map(skill => (
          <div className="sk-skill-row" key={skill.id} data-skill={skill.id}>
            <ScrollText size={18} />
            <div className="sk-skill-id">
              <div>
                <strong>{skill.name}</strong>
                <Tag tone="neutral">{skill.source}</Tag>
                <span className={skill.scan === 'passed' ? 'sk-scan sk-scan-ok' : 'sk-scan sk-scan-warn'}>
                  {skill.scan === 'passed' ? t('ai.skills.scanned') : t('ai.skills.review')}
                </span>
              </div>
              <p>{skill.desc}</p>
            </div>
            {tab === 'market'
              ? <Button actionId={`skill.${skill.id}.install`} emphasis="primary" density="compact" label={t('ai.discover.install')}
                  onActivate={() => patch(skill.id, { installed: true, enabled: true })} />
              : <Switch checked={skill.enabled} aria-label={skill.name}
                  onCheckedChange={checked => patch(skill.id, { enabled: checked })} />}
          </div>
        ))}
    </SettingsSection>
  );
}

/* ── MCP ──────────────────────────────────────────────────────────────── */

type McpServer = { id: string; name: string; transport: 'stdio' | 'http' | 'sse'; endpoint: string; enabled: boolean; toolCount: number; tools: string[]; test: TestState };
const INITIAL_MCP: McpServer[] = [
  { id: 'mcp-fs', name: 'filesystem', transport: 'stdio', endpoint: 'npx -y @modelcontextprotocol/server-filesystem /docs', enabled: true, toolCount: 6, tools: ['read', 'write', 'list', 'move', 'search', 'delete'], test: 'ok' },
  { id: 'mcp-browser', name: 'integrated_browser', transport: 'http', endpoint: 'http://127.0.0.1:9222/mcp', enabled: true, toolCount: 3, tools: ['navigate', 'click', 'snapshot'], test: 'ok' },
  { id: 'mcp-github', name: 'github', transport: 'sse', endpoint: 'https://mcp.example.com/github/sse', enabled: false, toolCount: 0, tools: [], test: 'idle' },
];

export function McpSection() {
  const { t } = useT();
  const [servers, setServers] = useState<McpServer[]>(INITIAL_MCP);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const patch = (id: string, p: Partial<McpServer>) =>
    setServers(list => list.map(s => s.id === id ? { ...s, ...p } : s));
  const addServer = () => {
    if (!name.trim() || !endpoint.trim()) return;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setServers(list => [...list, {
      id: list.some(s => s.id === `mcp-${slug}`) ? `mcp-${slug}-${Date.now()}` : `mcp-${slug}`,
      name: name.trim(), transport: 'stdio', endpoint: endpoint.trim(),
      enabled: true, toolCount: 0, tools: [], test: 'idle',
    }]);
    setName(''); setEndpoint(''); setAddOpen(false);
  };
  return (
    <SettingsSection icon={Plug} title={t('ai.mcp.title')} subtitle={t('ai.mcp.subtitle')}
      extra={<Button actionId="mcp.add-open" emphasis="primary" density="compact" leading={<Plus size={13} />}
        label={t('ai.mcp.add')} onActivate={() => setAddOpen(open => !open)} />}>
      {addOpen && (
        <div className="sk-mcp-add" data-mcp-add>
          <div className="sk-inline-actions" style={{ alignItems: 'center' }}>
            <TextField aria-label={t('ai.mcp.name')} data-mcp-name placeholder={t('ai.mcp.name')} value={name} onValueChange={setName} />
          </div>
          <div className="sk-inline-actions" style={{ alignItems: 'center' }}>
            <TextField aria-label="endpoint" data-mcp-endpoint placeholder={t('ai.mcp.endpointPlaceholder')} value={endpoint}
              onValueChange={setEndpoint} onEnter={event => { event.preventDefault(); addServer(); }} />
            <Button actionId="mcp.add-confirm" emphasis="primary" density="compact"
              label={t('ai.mcp.addBtn')} onActivate={addServer} />
          </div>
        </div>
      )}
      {servers.map(server => (
        <div className="sk-mcp-row" key={server.id} data-mcp={server.id}>
          <Plug size={18} />
          <div className="sk-mcp-id">
            <div>
              <strong>{server.name}</strong>
              <Tag tone={server.transport === 'stdio' ? 'neutral' : 'info'}>{server.transport}</Tag>
              {server.toolCount > 0 && (
                <button type="button" className="sk-link-button"
                  onClick={() => setExpanded(expanded === server.id ? null : server.id)}>
                  {server.toolCount} {t('ai.mcp.tools')}
                </button>
              )}
            </div>
            <code className="sk-mono">{server.endpoint}</code>
          </div>
          <Button actionId={`mcp.${server.id}.test`} emphasis="quiet" density="compact"
            leading={server.test === 'testing' ? <Loader2 size={14} className="sk-spin" />
              : server.test === 'ok' ? <CheckCircle2 size={14} /> : <Activity size={14} />}
            label={server.test === 'testing' ? '…' : server.test === 'ok' ? t('ai.mcp.ok') : t('ai.mcp.test')}
            onActivate={() => {
              patch(server.id, { test: 'testing' });
              window.setTimeout(() => patch(server.id, { test: 'ok' }), 700);
            }} />
          <Switch checked={server.enabled} aria-label={`${server.name} enabled`}
            onCheckedChange={checked => patch(server.id, { enabled: checked })} />
          <IconButton actionId={`mcp.${server.id}.delete`} iconId="delete" iconSize={14} label={t('common.delete')}
            onActivate={() => setServers(list => list.filter(s => s.id !== server.id))} />
          {expanded === server.id && server.tools.length > 0 && (
            <div className="sk-mcp-tools">
              {server.tools.map(tool => <Tag key={tool} tone="neutral">{tool}</Tag>)}
            </div>
          )}
        </div>
      ))}
    </SettingsSection>
  );
}

/* ── Voice input (desktop voice module parity: STT preferences only;
   TTS playback was removed in production) ─────────────────────────────── */

type SttProvider = 'browser' | 'openai';
type SttLanguage = 'auto' | 'en' | 'zh' | 'ja' | 'ko' | 'fr' | 'de' | 'es';

export function VoiceSection() {
  const { t } = useT();
  const [provider, setProvider] = useState<SttProvider>('browser');
  const [language, setLanguage] = useState<SttLanguage>('auto');
  const [autoStop, setAutoStop] = useState(true);

  return (
    <SettingsSection icon={Activity} title={t('voice.title')} subtitle={t('voice.desc')}>
      <SettingsRow label={t('voice.provider')} description={t('voice.providerDesc')}>
        <Select<SttProvider> appearance="ghost" aria-label={t('voice.provider')}
          data-voice-provider
          options={[
            { value: 'browser', label: t('voice.providerBrowser') },
            { value: 'openai', label: t('voice.providerOpenai') },
          ]}
          value={provider}
          onValueChange={value => setProvider((Array.isArray(value) ? value[0] : value) ?? 'browser')} />
      </SettingsRow>
      <SettingsRow label={t('voice.language')} description={t('voice.languageDesc')}>
        <Select<SttLanguage> appearance="ghost" aria-label={t('voice.language')}
          data-voice-language
          options={[
            { value: 'auto', label: t('voice.lang.auto') },
            { value: 'en', label: t('voice.lang.en') },
            { value: 'zh', label: t('voice.lang.zh') },
            { value: 'ja', label: t('voice.lang.ja') },
            { value: 'ko', label: t('voice.lang.ko') },
            { value: 'fr', label: t('voice.lang.fr') },
            { value: 'de', label: t('voice.lang.de') },
            { value: 'es', label: t('voice.lang.es') },
          ]}
          value={language}
          onValueChange={value => setLanguage((Array.isArray(value) ? value[0] : value) ?? 'auto')} />
      </SettingsRow>
      <SettingsRow label={t('voice.autoStop')} description={t('voice.autoStopDesc')}>
        <Switch checked={autoStop} aria-label={t('voice.autoStop')} data-voice-auto-stop
          onCheckedChange={setAutoStop} />
      </SettingsRow>
    </SettingsSection>
  );
}

/* ── shared atoms ─────────────────────────────────────────────────────── */

function Segmented2<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return <Segmented<T> options={options} value={value} onValueChange={v => onChange((v ?? options[0].value) as T)} />;
}
