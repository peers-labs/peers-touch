import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Button, Input, Typography } from 'antd';
import {
  Check,
  ChevronRight,
  ExternalLink,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import catalog from '../../settingsCapabilities.json';
import type {
  Applet,
  Channel,
  CronTask,
  MobileSettingsState,
} from '../../settingsState';
import { AccessibleClearIcon } from '../AccessibleClearIcon';
import { ConfirmationDialog } from '../ConfirmationDialog';
import { useDismissableLayer } from '../useDismissableLayer';
import {
  Capability,
  Choice,
  DegradedCapability,
  InlineStatus,
  SettingActionRow,
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

export function CronSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<CronTask | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState('');
  const [historyId, setHistoryId] = useState('');
  const [runStatus, setRunStatus] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CronTask | null>(null);
  const rows = state.cronTasks.filter((task) => (
    `${task.title} ${task.schedule}`.toLowerCase().includes(query.trim().toLowerCase())
  ));

  const updateTask = (taskId: string, change: (task: CronTask) => CronTask) => updateField(
    setState,
    'cronTasks',
    (tasks) => tasks.map((task) => task.id === taskId ? change(task) : task),
  );

  const beginEdit = (task: CronTask | 'new') => {
    setEditor(task);
    setTitle(task === 'new' ? '' : task.title);
    setSchedule(task === 'new' ? '' : task.schedule);
  };

  return (
    <>
      <SettingSection
        title="Cron Jobs"
        description="Recurring Agent work and recent outcomes."
        action={(
          <Capability id="cron.create">
            <Button
              size="small"
              type="primary"
              icon={<Plus size={13} />}
              data-capability-action="cron.create"
              onClick={() => beginEdit('new')}
            >
              New
            </Button>
          </Capability>
        )}
      >
        <Capability id="cron.search">
          <Input
            aria-label="Search scheduled tasks"
            placeholder="Search scheduled tasks"
            prefix={<Search size={13} />}
            data-capability-action="cron.search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Capability>
        {editor && (
          <div className="mp-setting-editor">
            <Input
              aria-label="Task name"
              placeholder="Task name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Input
              aria-label="Task schedule"
              placeholder="Weekdays · 09:00"
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
            />
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setEditor(null)}>Cancel</Button>
              <Button
                type="primary"
                disabled={!title.trim() || !schedule.trim()}
                onClick={() => {
                  if (editor === 'new') {
                    updateField(setState, 'cronTasks', (current) => [...current, {
                      id: title.trim().toLowerCase().replace(/\W+/g, '-'),
                      title: title.trim(),
                      schedule: schedule.trim(),
                      enabled: true,
                      lastRun: 'Never',
                      lastResult: 'Never',
                    }]);
                  } else {
                    updateTask(editor.id, (task) => ({
                      ...task,
                      title: title.trim(),
                      schedule: schedule.trim(),
                    }));
                  }
                  setEditor(null);
                }}
              >
                Save task
              </Button>
            </div>
          </div>
        )}
        <div className="mp-cron-list" data-ui-rows>
          {rows.map((task) => (
            <article key={task.id} className="mp-cron-row" data-ui-row>
              <span data-ui-column="content" data-ui-column-align="start">
                <strong>{task.title}</strong>
                <small>{task.schedule} · {task.lastResult}</small>
              </span>
              <span className="mp-cron-actions" data-ui-controls-align="end">
                <Capability id="cron.run">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`Run ${task.title}`}
                    data-capability-action="cron.run"
                    icon={<Play size={14} />}
                    onClick={() => {
                      updateTask(task.id, (current) => ({
                        ...current,
                        lastRun: 'Just now',
                        lastResult: 'Succeeded',
                      }));
                      setRunStatus(`${task.title} completed.`);
                    }}
                  />
                </Capability>
                <Capability id="cron.history">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`History for ${task.title}`}
                    data-capability-action="cron.history"
                    icon={<History size={14} />}
                    onClick={() => setHistoryId(task.id)}
                  />
                </Capability>
                <Capability id="cron.toggle">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`${task.enabled ? 'Pause' : 'Resume'} ${task.title}`}
                    data-capability-action="cron.toggle"
                    icon={task.enabled ? <Pause size={14} /> : <Play size={14} />}
                    onClick={() => updateTask(task.id, (current) => ({ ...current, enabled: !current.enabled }))}
                  />
                </Capability>
                <Capability id="cron.edit">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`Edit ${task.title}`}
                    data-capability-action="cron.edit"
                    icon={<Settings2 size={14} />}
                    onClick={() => beginEdit(task)}
                  />
                </Capability>
                <Capability id="cron.delete">
                  <Button
                    type="text"
                    size="small"
                    danger
                    aria-label={`Delete ${task.title}`}
                    data-capability-action="cron.delete"
                    icon={<Trash2 size={14} />}
                    onClick={() => setPendingDelete(task)}
                  />
                </Capability>
              </span>
            </article>
          ))}
          {rows.length === 0 && <div className="mp-setting-empty">No matching scheduled tasks</div>}
        </div>
        {runStatus && <InlineStatus tone="success">{runStatus}</InlineStatus>}
        {historyId && (
          <section className="mp-setting-detail-panel" aria-label="Task run history">
            <span>
              <Text strong>Run history</Text>
              <Text type="secondary">{state.cronTasks.find((task) => task.id === historyId)?.lastRun} · Succeeded</Text>
            </span>
            <Button size="small" onClick={() => setHistoryId('')}>Close</Button>
          </section>
        )}
      </SettingSection>

      {pendingDelete && (
        <ConfirmationDialog
          title={`Delete ${pendingDelete.title}?`}
          description="Its run history will remain in diagnostics."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            updateField(setState, 'cronTasks', (current) => (
              current.filter((task) => task.id !== pendingDelete.id)
            ));
            setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}

export function CommandPaletteSettingsSection({
  onCommand,
}: {
  onCommand: (command: 'Open Chats' | 'New Post' | 'Switch Station') => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissableLayer({
    open,
    containerRef: panelRef,
    onDismiss: close,
    dismissOnWindowBlur: true,
  });
  const commands = ['Open Chats', 'New Post', 'Switch Station'] as const;

  return (
    <>
      <SettingSection title="Command Palette" description="Search actions without leaving your current context.">
        <div className="mp-command-preview">
          <span>⌘ K</span>
          <Text type="secondary">Search pages, applets, and actions</Text>
        </div>
      </SettingSection>
      <Capability id="command.open">
        <Button block data-capability-action="command.open" onClick={() => setOpen(true)}>
          Open Command Palette
        </Button>
      </Capability>
      {open && (
        <div className="mp-command-sheet" role="dialog" aria-label="Command Palette">
          <button type="button" className="mp-command-sheet-backdrop" aria-label="Close Command Palette" onClick={close} />
          <section ref={panelRef}>
            <div className="mp-command-sheet-header">
              <Text strong>Command Palette</Text>
              <Button type="text" onClick={close}>Close</Button>
            </div>
            <Capability id="command.search">
              <Input
                autoFocus
                aria-label="Search commands"
                placeholder="Search commands"
                allowClear={{ clearIcon: <AccessibleClearIcon label="Clear command search" /> }}
                data-capability-action="command.search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Capability>
            <Capability id="command.run">
              <div className="mp-command-results">
                {commands
                  .filter((command) => command.toLowerCase().includes(query.trim().toLowerCase()))
                  .map((command) => (
                    <button
                      key={command}
                      type="button"
                      data-capability-action="command.run"
                      onClick={() => {
                        setOpen(false);
                        setQuery('');
                        onCommand(command);
                      }}
                    >
                      {command}
                    </button>
                  ))}
              </div>
            </Capability>
          </section>
        </div>
      )}
    </>
  );
}

export function ToolsSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [detail, setDetail] = useState('');
  const providers = [
    { id: 'brave', name: 'Brave Search', available: true },
    { id: 'tavily', name: 'Tavily', available: true },
    { id: 'google', name: 'Google', available: false },
  ];
  const tools = [
    { id: 'web-search', name: 'Web search', category: 'web', approval: 'Automatic' },
    { id: 'memory-read', name: 'Memory read', category: 'memory', approval: 'Automatic' },
    { id: 'mcp-run', name: 'MCP tool execution', category: 'mcp', approval: 'Required' },
  ];

  return (
    <>
      <SettingSection title="Search engines" description="Select the primary configured search provider.">
        <Capability id="tools.search-provider.select">
          <div className="mp-setting-picker-list">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!provider.available}
                aria-pressed={state.primarySearchProvider === provider.id}
                className={state.primarySearchProvider === provider.id ? 'active' : ''}
                data-capability-action="tools.search-provider.select"
                onClick={() => updateField(setState, 'primarySearchProvider', provider.id)}
              >
                <span>
                  <strong>{provider.name}</strong>
                  <small>{provider.available ? 'Configured' : 'Not configured'}</small>
                </span>
                <span>{state.primarySearchProvider === provider.id ? 'Primary' : ''}</span>
              </button>
            ))}
          </div>
        </Capability>
      </SettingSection>

      <SettingSection title="Agent tools" description="Availability and approval policy.">
        <Capability id="tools.catalog.inspect">
          <SettingList rows={tools.map((tool) => ({
            id: tool.id,
            title: tool.name,
            detail: `${tool.category} · ${tool.approval}`,
            action: (
              <Button
                size="small"
                data-capability-action="tools.catalog.inspect"
                onClick={() => setDetail(tool.id)}
              >
                Details
              </Button>
            ),
          }))} />
        </Capability>
        {detail && (
          <InlineStatus tone="neutral">
            {tools.find((tool) => tool.id === detail)?.name} is supplied by the active Agent runtime.
          </InlineStatus>
        )}
        <DegradedCapability
          id="tools.local-filesystem"
          title="Local filesystem"
          reason={catalog.degraded['tools.local-filesystem']}
        />
        <DegradedCapability
          id="tools.local-shell"
          title="Local shell"
          reason={catalog.degraded['tools.local-shell']}
        />
      </SettingSection>
    </>
  );
}

export function ChannelsSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [editor, setEditor] = useState<Channel | 'new' | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<Channel['type']>('webhook');
  const [endpoint, setEndpoint] = useState('');
  const [status, setStatus] = useState('');
  const [eventsFor, setEventsFor] = useState('');
  const [statsFor, setStatsFor] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Channel | null>(null);

  const updateChannel = (channelId: string, change: (channel: Channel) => Channel) => updateField(
    setState,
    'channels',
    (channels) => channels.map((channel) => channel.id === channelId ? change(channel) : channel),
  );

  const beginEdit = (channel: Channel | 'new') => {
    setEditor(channel);
    setName(channel === 'new' ? '' : channel.name);
    setType(channel === 'new' ? 'webhook' : channel.type);
    setEndpoint(channel === 'new' ? '' : channel.endpoint);
  };

  return (
    <>
      <SettingSection
        title="Channels"
        description="External delivery and bot connections."
        action={(
          <span className="mp-account-edit-actions">
            <Capability id="channels.refresh">
              <Button
                size="small"
                aria-label="Refresh channels"
                icon={<RefreshCw size={13} />}
                data-capability-action="channels.refresh"
                onClick={() => setStatus('Channel status refreshed.')}
              />
            </Capability>
            <Capability id="channels.create">
              <Button
                size="small"
                type="primary"
                icon={<Plus size={13} />}
                data-capability-action="channels.create"
                onClick={() => beginEdit('new')}
              >
                Add
              </Button>
            </Capability>
          </span>
        )}
      >
        {editor && (
          <div className="mp-setting-editor">
            <Input
              aria-label="Channel name"
              placeholder="Channel name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Choice
              label="Channel type"
              value={type}
              onChange={(value) => setType(value as Channel['type'])}
              options={[
                { value: 'email', label: 'Email' },
                { value: 'webhook', label: 'Webhook' },
                { value: 'lark', label: 'Lark' },
              ]}
            />
            <Input
              aria-label="Channel endpoint"
              placeholder={type === 'email' ? 'alice@example.com' : 'https://hooks.example.com'}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setEditor(null)}>Cancel</Button>
              <Button
                type="primary"
                disabled={!name.trim() || !endpoint.trim()}
                onClick={() => {
                  if (editor === 'new') {
                    const channel: Channel = {
                      id: name.trim().toLowerCase().replace(/\W+/g, '-'),
                      name: name.trim(),
                      type,
                      endpoint: endpoint.trim(),
                      enabled: true,
                      status: 'ready',
                    };
                    updateField(setState, 'channels', (current) => [
                      ...current.filter((item) => item.id !== channel.id),
                      channel,
                    ]);
                  } else {
                    updateChannel(editor.id, (channel) => ({
                      ...channel,
                      name: name.trim(),
                      type,
                      endpoint: endpoint.trim(),
                      status: 'ready',
                    }));
                  }
                  setEditor(null);
                }}
              >
                Save channel
              </Button>
            </div>
          </div>
        )}
        <div className="mp-channel-list" data-ui-rows>
          {state.channels.map((channel) => (
            <article key={channel.id} className="mp-channel-row" data-ui-row>
              <span data-ui-column="content" data-ui-column-align="start">
                <strong>{channel.name}</strong>
                <small>{channel.type} · {channel.endpoint || 'Not configured'}</small>
              </span>
              <span className="mp-channel-actions" data-ui-controls-align="end">
                <Capability id="channels.toggle">
                  <SettingToggle
                    label={`Enable ${channel.name}`}
                    checked={channel.enabled}
                    capability="channels.toggle"
                    onChange={(enabled) => updateChannel(channel.id, (current) => ({ ...current, enabled }))}
                  />
                </Capability>
                <Capability id="channels.test">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`Test ${channel.name}`}
                    data-capability-action="channels.test"
                    icon={<Check size={14} />}
                    onClick={() => {
                      updateChannel(channel.id, (current) => ({ ...current, status: current.endpoint ? 'ready' : 'error' }));
                      setStatus(channel.endpoint ? `${channel.name} connection passed.` : `${channel.name} needs configuration.`);
                    }}
                  />
                </Capability>
                <Capability id="channels.edit">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`Edit ${channel.name}`}
                    data-capability-action="channels.edit"
                    icon={<Settings2 size={14} />}
                    onClick={() => beginEdit(channel)}
                  />
                </Capability>
                <Capability id="channels.delete">
                  <Button
                    type="text"
                    size="small"
                    danger
                    aria-label={`Delete ${channel.name}`}
                    data-capability-action="channels.delete"
                    icon={<Trash2 size={14} />}
                    onClick={() => setPendingDelete(channel)}
                  />
                </Capability>
              </span>
              <div className="mp-channel-secondary-actions">
                <Capability id="channels.send-test">
                  <Button
                    size="small"
                    icon={<Send size={13} />}
                    data-capability-action="channels.send-test"
                    disabled={!channel.enabled || channel.status !== 'ready'}
                    onClick={() => setStatus(`Test message sent through ${channel.name}.`)}
                  >
                    Send test
                  </Button>
                </Capability>
                <Capability id="channels.events">
                  <Button
                    size="small"
                    data-capability-action="channels.events"
                    onClick={() => setEventsFor(channel.id)}
                  >
                    Events
                  </Button>
                </Capability>
                <Capability id="channels.statistics">
                  <Button
                    size="small"
                    data-capability-action="channels.statistics"
                    onClick={() => setStatsFor(channel.id)}
                  >
                    Statistics
                  </Button>
                </Capability>
              </div>
            </article>
          ))}
        </div>
        {status && <InlineStatus tone={status.includes('needs') ? 'danger' : 'success'}>{status}</InlineStatus>}
        {eventsFor && (
          <InlineStatus tone="neutral">
            {state.channels.find((channel) => channel.id === eventsFor)?.name}: 12 delivered · 0 failed.
          </InlineStatus>
        )}
        {statsFor && (
          <InlineStatus tone="neutral">
            {state.channels.find((channel) => channel.id === statsFor)?.name}: 99.8% success · 240 ms average.
          </InlineStatus>
        )}
      </SettingSection>

      {pendingDelete && (
        <ConfirmationDialog
          title={`Delete ${pendingDelete.name}?`}
          description="External delivery through this channel will stop."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            updateField(setState, 'channels', (current) => (
              current.filter((channel) => channel.id !== pendingDelete.id)
            ));
            setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}

export function AppletsSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [selectedId, setSelectedId] = useState('');
  const selected = state.applets.find((applet) => applet.id === selectedId);

  const updateApplet = (appletId: string, change: (applet: Applet) => Applet) => updateField(
    setState,
    'applets',
    (applets) => applets.map((applet) => applet.id === appletId ? change(applet) : applet),
  );

  return (
    <>
      <Capability id="applets.list">
        <SettingSection title="Installed applets" description="Product units available on this account.">
          <div className="mp-applet-list" data-ui-rows>
            {state.applets.map((applet) => (
              <article key={applet.id} className="mp-applet-row" data-ui-row>
                <span data-ui-column="content" data-ui-column-align="start">
                  <strong>{applet.name}</strong>
                  <small>v{applet.version} · {applet.description}</small>
                </span>
                <Capability id="applets.toggle">
                  <SettingToggle
                    label={`Enable ${applet.name}`}
                    checked={applet.enabled}
                    capability="applets.toggle"
                    onChange={(enabled) => updateApplet(applet.id, (current) => ({ ...current, enabled }))}
                  />
                </Capability>
                <Capability id="applets.settings">
                  <Button
                    type="text"
                    size="small"
                    aria-label={`Settings for ${applet.name}`}
                    disabled={!applet.hasSettings}
                    data-capability-action="applets.settings"
                    icon={<ChevronRight size={15} />}
                    onClick={() => setSelectedId(applet.id)}
                  />
                </Capability>
              </article>
            ))}
          </div>
        </SettingSection>
      </Capability>
      {selected && (
        <SettingSection title={`${selected.name} settings`}>
          <SettingRow label="Background refresh" description="Allow this applet to refresh when Peers Touch is active.">
            <SettingToggle
              label={`${selected.name} background refresh`}
              checked={selected.enabled}
              onChange={(enabled) => updateApplet(selected.id, (current) => ({ ...current, enabled }))}
            />
          </SettingRow>
          <div className="mp-setting-section-action">
            <Button onClick={() => setSelectedId('')}>Back to applets</Button>
          </div>
        </SettingSection>
      )}
    </>
  );
}

export function HelpSettingsSection({ onReset }: { onReset: () => void }) {
  const [panel, setPanel] = useState<'release' | 'licenses' | 'support' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const details = useMemo(() => ({
    release: 'Account controls, Settings parity, and storage cleanup were refined in this build.',
    licenses: 'Third-party notices are bundled with the application build.',
    support: 'Export relevant logs before contacting support.',
  }), []);

  return (
    <>
      <section className="mp-about-hero">
        <span className="mp-setting-hero-icon"><ShieldCheck size={26} /></span>
        <Text strong>Peers Touch</Text>
        <Text type="secondary">Version 1.0.0 · Build 2026.10.14</Text>
      </section>
      <SettingSection title="Help">
        <SettingActionRow
          capability="help.release-notes"
          label="Release notes"
          icon={<ChevronRight size={16} />}
          onClick={() => setPanel('release')}
        />
        <SettingActionRow
          capability="help.licenses"
          label="Open-source licenses"
          icon={<ExternalLink size={16} />}
          onClick={() => setPanel('licenses')}
        />
        <SettingActionRow
          capability="help.support"
          label="Support"
          icon={<ExternalLink size={16} />}
          onClick={() => setPanel('support')}
        />
      </SettingSection>
      {panel && (
        <section className="mp-about-detail" role="region" aria-label={`${panel} details`}>
          <span>
            <Text strong>{panel === 'release' ? 'Release notes' : panel === 'licenses' ? 'Open-source licenses' : 'Support'}</Text>
            <Text type="secondary">{details[panel]}</Text>
          </span>
          <Button size="small" onClick={() => setPanel(null)}>Close</Button>
        </section>
      )}
      <Capability id="help.reset-onboarding">
        <section className="mp-setting-danger">
          <Text strong>Reset onboarding</Text>
          <Text type="secondary">Sign out and return to Station selection. Local prototype data is retained.</Text>
          {confirmReset ? (
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
              <Button
                danger
                type="primary"
                data-capability-action="help.reset-onboarding"
                icon={<RotateCcw size={14} />}
                onClick={onReset}
              >
                Reset onboarding
              </Button>
            </div>
          ) : (
            <Button danger icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
              Reset onboarding
            </Button>
          )}
        </section>
      </Capability>
    </>
  );
}
