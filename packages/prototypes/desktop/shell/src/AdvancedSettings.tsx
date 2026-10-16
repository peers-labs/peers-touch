import {
  useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ComponentType, type ReactNode,
} from 'react';
import { Clock, Database, HardDrive, HelpCircle, Info, Puzzle, ScrollText, Send, type LucideIcon } from 'lucide-react';
import { T } from './theme';
import './advancedSettings.css';
import {
  formatMeasuredBytes,
  type AdvancedCommand,
  type AdvancedSection,
  type AdvancedSettingsAdapter,
  type AdvancedSettingsProjection,
  type CronDraft,
  type CronProjection,
  type FileProjection,
  type LogLevel,
} from './advancedSettingsAdapter';

/** Reuse the existing Settings atoms without coupling either module by import. */
interface SettingsAtoms {
  Container: ComponentType<{ children: ReactNode }>;
  Section: ComponentType<{ icon: LucideIcon; title: string; subtitle?: string; action?: ReactNode; children: ReactNode }>;
  Row: ComponentType<{ label: string; desc?: string; children?: ReactNode }>;
  Field: ComponentType<{ label: string; hint?: string; children: ReactNode }>;
  Select: ComponentType<{ value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; width?: number | string; ariaLabel?: string; disabled?: boolean }>;
  Toggle: ComponentType<{ on: boolean; onToggle: () => void; label?: string; disabled?: boolean }>;
  GhostBtn: ComponentType<{ label: string; ariaLabel?: string; onClick: () => void; danger?: boolean; disabled?: boolean }>;
  PrimaryBtn: ComponentType<{ label: string; onClick: () => void; disabled?: boolean }>;
  DangerZone: ComponentType<{ title?: string; desc?: string; children: ReactNode }>;
  inputStyle: React.CSSProperties;
}
interface PaneProps {
  projection: AdvancedSettingsProjection;
  adapter: AdvancedSettingsAdapter;
  onNavigate: (section: AdvancedSection) => void;
}

function downloadFile(file: { name: string; content: string; mime: string }) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function useCommand(adapter: AdvancedSettingsAdapter) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', error: false });
  const live = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const run = async (command: AdvancedCommand): Promise<boolean> => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setFeedback({ message: 'Working…', error: false });
    try {
      const result = await adapter.execute(command);
      if (live.current) {
        if (result.download) downloadFile(result.download);
        setFeedback({ message: result.message, error: false });
      }
      return live.current;
    } catch (error) {
      if (live.current) setFeedback({
        message: error instanceof Error ? error.message : 'Unable to complete the request.',
        error: true,
      });
      return false;
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  };
  return {
    busy, run,
    feedback: <div role={feedback.error ? 'alert' : 'status'} aria-live="polite"
      style={{ minHeight: 28, paddingTop: 6, fontSize: 12, color: feedback.error ? T.danger : T.textSecondary }}>
      {feedback.message}
    </div>,
  };
}

const emptyCron: CronDraft = {
  name: '', scheduleKind: 'cron', cronExpr: '', intervalSec: 3600, runAt: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  execKind: 'shell', shellCmd: '', agentPrompt: '', agentName: '',
  timeoutSec: 60, deliveryMode: 'none', deliveryChannelId: '', deliveryTargetId: '', deliveryTargetType: '',
};
const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };
const textStyle: React.CSSProperties = { margin: 0, fontSize: 13, color: T.textSecondary, lineHeight: 1.5, overflowWrap: 'anywhere' };

export function createAdvancedSettingsSections(ui: SettingsAtoms) {
  const { Container, Section, Row, Field, Select, Toggle, GhostBtn, PrimaryBtn, DangerZone, inputStyle } = ui;

  function Storage({ projection, adapter, onNavigate }: PaneProps) {
    const command = useCommand(adapter);
    const [confirm, setConfirm] = useState<'cache' | 'reset' | null>(null);
    const measurement = projection.storage;
    return (
      <Container>
        <Section icon={HardDrive} title="Local storage" action={<GhostBtn label="Refresh storage" disabled={command.busy} onClick={() => void command.run({ kind: 'refresh', section: 'storage' })} />}>
          {measurement ? (
            <>
              <Row label="Physical storage" desc={`Measured ${measurement.measuredAt}`}><strong data-measured-storage>{formatMeasuredBytes(measurement.physicalTotalBytes)}</strong></Row>
              {([
                ['Messages', measurement.messageBytes], ['Media', measurement.mediaBytes],
                ['Cache', measurement.cacheBytes], ['System', measurement.systemBytes],
              ] as const).map(([label, value]) => <Row key={label} label={label}><span>{formatMeasuredBytes(value)}</span></Row>)}
              <Row label="Message retention">
                <Select ariaLabel="Message retention" value={measurement.retention} disabled={command.busy}
                  options={[{ id: 'forever', label: 'Forever' }, { id: '365', label: '1 year' }, { id: '90', label: '90 days' }, { id: '30', label: '30 days' }]}
                  onChange={value => void command.run({ kind: 'set-retention', value: value as typeof measurement.retention })} />
              </Row>
              <Row label="Clear cache" desc="Messages are kept.">
                <GhostBtn label="Clear cache" disabled={command.busy} onClick={() => setConfirm('cache')} />
              </Row>
              {confirm === 'cache' ? <div style={actionsStyle}>
                <p style={textStyle}>Clear cached media on this device?</p>
                <GhostBtn label="Cancel" disabled={command.busy} onClick={() => setConfirm(null)} />
                <GhostBtn label="Confirm cache cleanup" danger disabled={command.busy} onClick={() => {
                  void command.run({ kind: 'clear-cache', revision: measurement.revision }).then(ok => { if (ok) setConfirm(null); });
                }} />
              </div> : null}
            </>
          ) : <p style={textStyle} data-storage-unmeasured>Not measured</p>}
          {command.feedback}
        </Section>
        <Section icon={Database} title="Files and recovery">
          <Row label="My files"><GhostBtn label="Manage files" onClick={() => onNavigate('files')} /></Row>
          <Row label="Encrypted messaging recovery"><GhostBtn label="Open recovery" onClick={() => onNavigate('recovery')} /></Row>
        </Section>
        <DangerZone title="Reset onboarding" desc="Sign out and reopen setup. Your conversations are kept.">
          {confirm === 'reset' ? <div style={actionsStyle}>
            <GhostBtn label="Cancel" onClick={() => setConfirm(null)} />
            <GhostBtn label="Confirm onboarding reset" danger disabled={command.busy} onClick={() => void command.run({ kind: 'reset-onboarding' })} />
          </div> : <GhostBtn label="Reset onboarding" danger onClick={() => setConfirm('reset')} />}
        </DangerZone>
      </Container>
    );
  }

  function Files({ projection, adapter }: PaneProps) {
    const command = useCommand(adapter);
    const [query, setQuery] = useState('');
    const [trashed, setTrashed] = useState(false);
    const [editing, setEditing] = useState<FileProjection | null>(null);
    const [ttlIntent, setTtlIntent] = useState('keep');
    const [expiration, setExpiration] = useState('');
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const files = useMemo(() => projection.files.filter(file => Boolean(file.deleted_at) === trashed
      && file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [projection.files, query, trashed]);
    return <Container>
      <Section icon={Database} title="My files" action={<GhostBtn label="Refresh files" disabled={command.busy} onClick={() => void command.run({ kind: 'refresh', section: 'files' })} />}>
        <div style={actionsStyle}>
          <input aria-label="Search files" value={query} onChange={event => setQuery(event.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
          <Toggle label="Show trash" on={trashed} onToggle={() => setTrashed(value => !value)} />
          <span style={textStyle}>Trash</span>
        </div>
        <div style={{ minHeight: 180 }}>
          {files.length === 0 ? <p style={{ ...textStyle, paddingTop: 16 }}>{query ? 'No matching files.' : trashed ? 'Trash is empty.' : 'No files.'}</p> : null}
          {files.slice(0, 50).map(file => <Row key={file.id} label={file.name} desc={`${formatMeasuredBytes(file.size)} · ${file.visibility} · ${file.expires_at ? `Expires ${file.expires_at}` : 'No expiration'}`}>
            <div style={actionsStyle}>
              {trashed ? <GhostBtn label="Restore" ariaLabel={`Restore ${file.name}`} disabled={command.busy} onClick={() => void command.run({ kind: 'restore-file', id: file.id })} /> : <>
                <GhostBtn label="Edit" ariaLabel={`Edit ${file.name}`} onClick={() => { setEditing(file); setTtlIntent('keep'); setExpiration(''); }} />
                <GhostBtn label="Delete" ariaLabel={`Delete ${file.name}`} danger disabled={command.busy} onClick={() => setConfirmDelete(file.id)} />
              </>}
            </div>
          </Row>)}
        </div>
        {confirmDelete ? <div style={actionsStyle}>
          <span style={textStyle}>Move this file to trash?</span>
          <GhostBtn label="Cancel deletion" onClick={() => setConfirmDelete(null)} />
          <GhostBtn label="Confirm file deletion" danger disabled={command.busy} onClick={() => void command.run({ kind: 'delete-file', id: confirmDelete }).then(ok => { if (ok) setConfirmDelete(null); })} />
        </div> : null}
        {editing ? <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Visibility"><Select ariaLabel="File visibility" value={editing.visibility} options={['private', 'public', 'chat'].map(id => ({ id, label: id }))} onChange={value => setEditing({ ...editing, visibility: value as FileProjection['visibility'] })} /></Field>
          <Field label="Expiration"><Select ariaLabel="Expiration change" value={ttlIntent} options={[{ id: 'keep', label: 'Keep current expiration' }, { id: 'clear', label: 'Remove expiration' }, { id: 'set', label: 'Set expiration' }]} onChange={setTtlIntent} /></Field>
          {ttlIntent === 'set' ? <Field label="Expires at"><input aria-label="Expires at" type="datetime-local" required value={expiration} onChange={event => setExpiration(event.target.value)} style={inputStyle} /></Field> : null}
          <div style={actionsStyle}>
            <PrimaryBtn label="Save file" disabled={command.busy || (ttlIntent === 'set' && !expiration)} onClick={() => {
              void command.run({ kind: 'patch-file', id: editing.id, visibility: editing.visibility,
                ...(ttlIntent === 'clear' ? { clear_expires_at: true as const } : {}),
                ...(ttlIntent === 'set' && expiration ? { expires_at: new Date(expiration).toISOString() } : {}),
              }).then(ok => { if (ok) setEditing(null); });
            }} />
            <GhostBtn label="Cancel file editing" onClick={() => setEditing(null)} />
          </div>
        </div> : null}
        {command.feedback}
      </Section>
    </Container>;
  }

  function Channels({ projection, adapter }: PaneProps) {
    const command = useCommand(adapter);
    const [editing, setEditing] = useState<{ id?: string; name: string; appId: string; secret: string } | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    return <Container>
      <Section icon={Send} title="Outbound channels" action={<PrimaryBtn label="Add Lark channel" onClick={() => setEditing({ name: '', appId: '', secret: '' })} />}>
        <p style={textStyle}>Lark</p>
        {projection.channels.length === 0 ? <p style={{ ...textStyle, paddingTop: 16 }}>No outbound channels.</p> : null}
        {projection.channels.map(channel => <Row key={channel.id} label={channel.name} desc={`Lark · ${channel.botStatus ? channel.botStatus.connected ? 'Connected' : channel.botStatus.error || 'Offline' : 'Not checked'}`}>
          <div style={actionsStyle}>
            <Toggle label={`${channel.name} enabled`} on={channel.enabled} disabled={command.busy} onToggle={() => void command.run({ kind: 'toggle-channel', id: channel.id, enabled: !channel.enabled })} />
            <GhostBtn label="Edit" ariaLabel={`Edit ${channel.name}`} onClick={() => setEditing({ id: channel.id, name: channel.name, appId: '', secret: '' })} />
            <GhostBtn label="Delete" ariaLabel={`Delete ${channel.name}`} danger onClick={() => setDeleting(channel.id)} />
          </div>
        </Row>)}
        {editing ? <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 }}>
          <Field label="Channel name"><input aria-label="Channel name" style={inputStyle} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></Field>
          <Field label="App ID"><input aria-label="Lark App ID" autoComplete="off" style={inputStyle} value={editing.appId} onChange={event => setEditing({ ...editing, appId: event.target.value })} /></Field>
          <Field label="App secret"><input aria-label="Lark App secret" type="password" autoComplete="new-password" style={inputStyle} value={editing.secret} onChange={event => setEditing({ ...editing, secret: event.target.value })} /></Field>
          <div style={actionsStyle}>
            <PrimaryBtn label="Save channel" disabled={command.busy || !editing.name.trim() || !editing.appId.trim() || !editing.secret.trim()} onClick={() => {
              void command.run({ kind: 'save-channel', id: editing.id, name: editing.name, config: JSON.stringify({ appId: editing.appId, appSecret: editing.secret }) }).then(ok => { if (ok) setEditing(null); });
            }} />
            <GhostBtn label="Cancel channel editing" disabled={command.busy} onClick={() => setEditing(null)} />
          </div>
        </div> : null}
        {deleting ? <div style={actionsStyle}>
          <span style={textStyle}>Delete this outbound channel?</span>
          <GhostBtn label="Cancel channel deletion" onClick={() => setDeleting(null)} />
          <GhostBtn label="Confirm channel deletion" danger disabled={command.busy} onClick={() => void command.run({ kind: 'delete-channel', id: deleting }).then(ok => { if (ok) setDeleting(null); })} />
        </div> : null}
        {command.feedback}
      </Section>
    </Container>;
  }

  function Applets({ projection }: PaneProps) {
    const [selected, setSelected] = useState<string | null>(null);
    const applet = projection.applets.find(item => item.id === selected);
    return <Container>
      <Section icon={Puzzle} title="Applet settings">
        {applet?.settingsPanel ? <>
          <GhostBtn label="Back to applets" onClick={() => setSelected(null)} />
          {applet.settingsPanel()}
        </> : <>
          {projection.applets.length === 0 ? <p style={textStyle}>No installed applets.</p> : null}
          {projection.applets.map(item => <Row key={item.id} label={item.name} desc={`${item.version} · ${item.status}`}>
            {item.settingsPanel ? <GhostBtn label="Configure" ariaLabel={`Configure ${item.name}`} onClick={() => setSelected(item.id)} /> : <span style={textStyle}>No settings</span>}
          </Row>)}
        </>}
      </Section>
    </Container>;
  }

  function Logs({ projection, adapter }: PaneProps) {
    const command = useCommand(adapter);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [paused, setPaused] = useState(false);
    const [follow, setFollow] = useState(true);
    const end = useRef<HTMLDivElement>(null);
    const cursor = useRef(projection.logCursor);
    cursor.current = projection.logCursor;
    // This is a view-bound, selected-only tail subscription, torn down on leave.
    useEffect(() => {
      if (paused) return;
      const interval = window.setInterval(() => {
        void command.run({ kind: 'tail-logs', cursor: cursor.current, limit: 200, maxBytes: 40000 });
      }, 2000);
      return () => window.clearInterval(interval);
    }, [adapter, paused]);
    const visible = useMemo(() => projection.logs.filter(log => (filter === 'all' || log.level === filter)
      && `${log.source} ${log.message}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(-200), [projection.logs, filter, query]);
    useEffect(() => {
      if (follow && !paused) end.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [visible, follow, paused]);
    return <Container>
      <Section icon={ScrollText} title="Diagnostics and logs">
        <div style={actionsStyle}>
          <input aria-label="Filter logs" style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={query} onChange={event => setQuery(event.target.value)} />
          <Select ariaLabel="Log level" value={filter} options={[{ id: 'all', label: 'All levels' }, ...levels.map(id => ({ id, label: id.toUpperCase() }))]} onChange={setFilter} />
          <GhostBtn label={paused ? 'Resume logs' : 'Pause logs'} onClick={() => setPaused(value => !value)} />
          <GhostBtn label="Export visible logs" disabled={visible.length === 0} onClick={() => downloadFile({ name: 'peers-touch-visible.log', content: visible.map(log => log.raw).join('\n'), mime: 'text/plain' })} />
        </div>
        <div data-log-list style={{ height: 320, overflowY: 'auto', padding: '12px 0' }}>
          {visible.length === 0 ? <p style={textStyle}>{query || filter !== 'all' ? 'No matching logs.' : 'No logs.'}</p> : null}
          {visible.map(log => <div key={log.id} style={{ padding: '6px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
            <span style={{ ...textStyle, color: log.level === 'error' || log.level === 'fatal' ? T.danger : T.textTertiary }}>{log.level.toUpperCase()} · {log.source}</span>
            <p style={textStyle}>{log.message}</p>
          </div>)}
          <div ref={end} />
        </div>
        <Row label="Follow latest logs"><Toggle label="Follow latest logs" on={follow} onToggle={() => setFollow(value => !value)} /></Row>
        {command.feedback}
      </Section>
    </Container>;
  }

  function Cron({ projection, adapter }: PaneProps) {
    const command = useCommand(adapter);
    const [editing, setEditing] = useState<{ id?: string; draft: CronDraft } | null>(null);
    const [history, setHistory] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const patch = (change: Partial<CronDraft>) => setEditing(current => current ? { ...current, draft: { ...current.draft, ...change } } : null);
    const input = (label: string, key: keyof CronDraft, type = 'text') => <Field label={label}>
      <input aria-label={label} type={type} style={inputStyle} value={String(editing!.draft[key])} onChange={event => patch({ [key]: type === 'number' ? Number(event.target.value) : event.target.value })} />
    </Field>;
    const schedule = (job: CronProjection) => job.scheduleKind === 'cron' ? job.cronExpr : job.scheduleKind === 'interval' ? `Every ${job.intervalSec} seconds` : job.runAt;
    return <Container>
      <Section icon={Clock} title="Scheduled tasks" action={<PrimaryBtn label="New scheduled task" onClick={() => setEditing({ draft: { ...emptyCron } })} />}>
        {projection.cronJobs.length === 0 ? <p style={textStyle}>No scheduled tasks.</p> : null}
        {projection.cronJobs.map(job => <Row key={job.id} label={job.name} desc={`${schedule(job)} · ${job.execKind} · ${job.enabled ? 'Active' : 'Paused'}`}>
          <div style={actionsStyle}>
            <GhostBtn label="Run now" ariaLabel={`Run ${job.name}`} disabled={command.busy} onClick={() => void command.run({ kind: 'run-cron', id: job.id })} />
            <GhostBtn label="History" ariaLabel={`History ${job.name}`} onClick={() => { setHistory(job.id); void command.run({ kind: 'list-cron-runs', id: job.id }); }} />
            <Toggle label={`${job.name} enabled`} on={job.enabled} disabled={command.busy} onToggle={() => void command.run({ kind: 'toggle-cron', id: job.id, enabled: !job.enabled })} />
            <GhostBtn label="Edit" ariaLabel={`Edit ${job.name}`} onClick={() => setEditing({ id: job.id, draft: { ...job } })} />
            <GhostBtn label="Delete" ariaLabel={`Delete ${job.name}`} danger onClick={() => setDeleting(job.id)} />
          </div>
        </Row>)}
        {editing ? <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 }}>
          {input('Task name', 'name')}
          <Field label="Schedule"><Select ariaLabel="Schedule kind" value={editing.draft.scheduleKind} options={['cron', 'interval', 'once'].map(id => ({ id, label: id }))} onChange={value => patch({ scheduleKind: value as CronDraft['scheduleKind'] })} /></Field>
          {editing.draft.scheduleKind === 'cron' ? input('Cron expression', 'cronExpr') : editing.draft.scheduleKind === 'interval' ? input('Interval seconds', 'intervalSec', 'number') : input('Run at', 'runAt', 'datetime-local')}
          {input('Timezone', 'timezone')}
          <Field label="Execution"><Select ariaLabel="Execution kind" value={editing.draft.execKind} options={[{ id: 'shell', label: 'Shell command' }, { id: 'agent', label: 'Agent' }]} onChange={value => patch({ execKind: value as CronDraft['execKind'] })} /></Field>
          {editing.draft.execKind === 'shell' ? input('Shell command', 'shellCmd') : <>{input('Agent name', 'agentName')}{input('Agent prompt', 'agentPrompt')}</>}
          {input('Timeout seconds', 'timeoutSec', 'number')}
          <Field label="Delivery"><Select ariaLabel="Delivery mode" value={editing.draft.deliveryMode} options={[{ id: 'none', label: 'None' }, { id: 'channel', label: 'Outbound channel' }]} onChange={value => patch({ deliveryMode: value as CronDraft['deliveryMode'] })} /></Field>
          {editing.draft.deliveryMode === 'channel' ? <>
            <Field label="Outbound channel"><Select ariaLabel="Delivery channel" value={editing.draft.deliveryChannelId} options={[{ id: '', label: 'Choose channel' }, ...projection.channels.filter(channel => channel.enabled).map(channel => ({ id: channel.id, label: channel.name }))]} onChange={value => patch({ deliveryChannelId: value, deliveryTargetId: '', deliveryTargetType: '' })} /></Field>
            <Field label="Destination"><Select ariaLabel="Delivery destination" value={editing.draft.deliveryTargetId}
              options={[{ id: '', label: 'Choose destination' }, ...(projection.channels.find(channel => channel.id === editing.draft.deliveryChannelId)?.targets ?? []).map(target => ({ id: target.id, label: target.name }))]}
              onChange={value => {
                const target = projection.channels.find(channel => channel.id === editing.draft.deliveryChannelId)?.targets?.find(item => item.id === value);
                patch({ deliveryTargetId: value, deliveryTargetType: target?.type ?? '' });
              }} />
            </Field>
          </> : null}
          <div style={actionsStyle}>
            <PrimaryBtn label="Save scheduled task" disabled={command.busy} onClick={() => void command.run({ kind: 'save-cron', ...editing }).then(ok => { if (ok) setEditing(null); })} />
            <GhostBtn label="Cancel task editing" onClick={() => setEditing(null)} />
          </div>
        </div> : null}
        {deleting ? <div style={actionsStyle}>
          <span style={textStyle}>Delete this scheduled task?</span>
          <GhostBtn label="Cancel task deletion" onClick={() => setDeleting(null)} />
          <GhostBtn label="Confirm task deletion" danger disabled={command.busy} onClick={() => void command.run({ kind: 'delete-cron', id: deleting }).then(ok => { if (ok) setDeleting(null); })} />
        </div> : null}
        {history ? <div data-cron-history style={{ minHeight: 140, paddingTop: 16 }}>
          <GhostBtn label="Close run history" onClick={() => setHistory(null)} />
          {projection.cronRuns.filter(run => run.jobId === history).length === 0 ? <p style={textStyle}>No runs.</p> : null}
          {projection.cronRuns.filter(run => run.jobId === history).slice(-20).map(run => <Row key={run.id} label={run.status} desc={run.startedAt}><span style={textStyle}>{run.output}</span></Row>)}
        </div> : null}
        {command.feedback}
      </Section>
    </Container>;
  }

  function Recovery({ projection, adapter }: PaneProps) {
    const command = useCommand(adapter);
    const [phrase, setPhrase] = useState('');
    return <Container>
      <Section icon={Database} title="Encrypted messaging recovery">
        <Row label="Latest recovery revision" desc={projection.recovery.latestRevision ?? 'No recovery revision.'} />
        {projection.recovery.available ? <Field label="Recovery phrase"><input aria-label="Recovery phrase" type="password" autoComplete="off" value={phrase} onChange={event => setPhrase(event.target.value)} style={inputStyle} /></Field> : <p style={textStyle}>Encrypted recovery runtime unavailable.</p>}
        <div style={{ ...actionsStyle, paddingTop: 12 }}>
          <PrimaryBtn label="Create recovery revision" disabled={!projection.recovery.available || !phrase.trim() || command.busy} onClick={() => void command.run({ kind: 'create-recovery', phrase }).then(ok => { if (ok) setPhrase(''); })} />
          <GhostBtn label="Restore messaging" disabled={!projection.recovery.available || !projection.recovery.latestRevision || !phrase.trim() || command.busy} onClick={() => void command.run({ kind: 'restore-recovery', phrase }).then(ok => { if (ok) setPhrase(''); })} />
        </div>
        {command.feedback}
      </Section>
      <Section icon={HardDrive} title="Memory export">
        {!projection.memoryExport.available ? <p style={textStyle}>Memory export unavailable.</p> : null}
        <GhostBtn label="Export memories" disabled={!projection.memoryExport.available || command.busy} onClick={() => void command.run({ kind: 'export-memory' })} />
      </Section>
    </Container>;
  }

  function About({ projection }: PaneProps) {
    return <Container>
      <Section icon={Info} title="About Peers Touch">
        <Row label="Version" desc={projection.about.version} />
        <Row label="Runtime" desc={projection.about.runtime} />
        <Row label="Platform" desc={projection.about.platform} />
        <Row label="Build mode" desc={projection.about.buildMode} />
        <Row label="Source commit" desc={projection.about.sourceCommit} />
      </Section>
    </Container>;
  }

  const panes = { storage: Storage, files: Files, recovery: Recovery, channels: Channels, applets: Applets, logs: Logs, cron: Cron, about: About };
  return function AdvancedSettingsSection({ section, adapter, onNavigate }: { section: AdvancedSection; adapter: AdvancedSettingsAdapter; onNavigate: PaneProps['onNavigate'] }) {
    const projection = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot);
    const command = useCommand(adapter);
    const state = projection.states[section];
    if (state !== 'ready') return <Container>
      <Section icon={HelpCircle} title={section === 'cron' ? 'Scheduled tasks' : `${section[0].toUpperCase()}${section.slice(1)}`}>
        <div style={{ minHeight: 180 }}>
          <p role={state === 'error' ? 'alert' : 'status'} style={textStyle}>{state === 'error' ? 'Unable to load this section.' : 'Loading…'}</p>
          {state === 'error' ? <GhostBtn label="Retry section" disabled={command.busy} onClick={() => void command.run({ kind: 'refresh', section })} /> : null}
          {command.feedback}
        </div>
      </Section>
    </Container>;
    const Pane = panes[section];
    return <div className="advanced-settings-pane" data-advanced-settings-section={section}><Pane key={section} projection={projection} adapter={adapter} onNavigate={onNavigate} /></div>;
  };
}
