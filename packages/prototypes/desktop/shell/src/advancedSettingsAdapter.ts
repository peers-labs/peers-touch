/**
 * Browser-only projection/command boundary for the Advanced Settings prototype.
 * Field and command semantics follow the Desktop owners; no production runtime
 * is imported here. Fixtures belong to the caller, never to a settings panel.
 */
export type LoadState = 'ready' | 'loading' | 'error';
export type AdvancedSection = 'storage' | 'files' | 'recovery' | 'channels' | 'applets' | 'logs' | 'cron' | 'about';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type Retention = 'forever' | '365' | '90' | '30';
export interface StorageMeasurement {
  revision: string;
  measuredAt: string;
  physicalTotalBytes: number;
  messageBytes: number;
  mediaBytes: number;
  cacheBytes: number;
  systemBytes: number;
  retention: Retention;
}
export interface FileProjection {
  id: string;
  name: string;
  size: number;
  visibility: 'private' | 'public' | 'chat';
  expires_at: string | null;
  deleted_at: string | null;
}
export interface ChannelProjection {
  id: string;
  name: string;
  type: 'lark';
  enabled: boolean;
  botStatus?: { connected: boolean; error?: string };
  targets?: readonly { id: string; name: string; type: 'group' | 'p2p' }[];
}
export interface AppletProjection {
  id: string;
  name: string;
  version: string;
  status: string;
  settingsPanel?: () => import('react').ReactNode;
}
export interface LogProjection {
  id: number;
  raw: string;
  level: LogLevel;
  source: string;
  message: string;
}
export interface CronDraft {
  name: string;
  scheduleKind: 'cron' | 'interval' | 'once';
  cronExpr: string;
  intervalSec: number;
  runAt: string;
  timezone: string;
  execKind: 'shell' | 'agent';
  shellCmd: string;
  agentPrompt: string;
  agentName: string;
  timeoutSec: number;
  deliveryMode: 'none' | 'channel';
  deliveryChannelId: string;
  deliveryTargetId: string;
  deliveryTargetType: string;
}
export interface CronProjection extends CronDraft {
  id: string;
  enabled: boolean;
}
export interface CronRunProjection {
  id: number;
  jobId: string;
  startedAt: string;
  status: 'running' | 'ok' | 'error';
  output: string;
}
export interface AdvancedSettingsProjection {
  states: Record<AdvancedSection, LoadState>;
  storage: StorageMeasurement | null;
  files: readonly FileProjection[];
  channels: readonly ChannelProjection[];
  applets: readonly AppletProjection[];
  logs: readonly LogProjection[];
  logCursor: number;
  cronJobs: readonly CronProjection[];
  cronRuns: readonly CronRunProjection[];
  recovery: { available: boolean; latestRevision: string | null };
  memoryExport: { available: boolean; records: readonly unknown[] };
  about: { version: string; platform: string; runtime: 'browser'; buildMode: string; sourceCommit: string };
}
export type AdvancedCommand =
  | { kind: 'refresh'; section: AdvancedSection }
  | { kind: 'tail-logs'; cursor: number; limit: number; maxBytes: number }
  | { kind: 'set-retention'; value: Retention }
  | { kind: 'clear-cache'; revision: string }
  | { kind: 'patch-file'; id: string; visibility: FileProjection['visibility']; expires_at?: string; clear_expires_at?: true }
  | { kind: 'delete-file' | 'restore-file'; id: string }
  | { kind: 'save-channel'; id?: string; name: string; config: string }
  | { kind: 'toggle-channel'; id: string; enabled: boolean }
  | { kind: 'delete-channel'; id: string }
  | { kind: 'save-cron'; id?: string; draft: CronDraft }
  | { kind: 'toggle-cron'; id: string; enabled: boolean }
  | { kind: 'delete-cron' | 'run-cron' | 'list-cron-runs'; id: string }
  | { kind: 'create-recovery' | 'restore-recovery'; phrase: string }
  | { kind: 'export-memory' | 'reset-onboarding' };
export interface AdvancedCommandResult {
  message: string;
  download?: { name: string; content: string; mime: string };
}
export interface AdvancedSettingsAdapter {
  getSnapshot: () => AdvancedSettingsProjection;
  subscribe: (listener: () => void) => () => void;
  execute: (command: AdvancedCommand) => Promise<AdvancedCommandResult>;
}

export function emptyAdvancedProjection(about: AdvancedSettingsProjection['about']): AdvancedSettingsProjection {
  return {
    states: { storage: 'ready', files: 'ready', recovery: 'ready', channels: 'ready', applets: 'ready', logs: 'ready', cron: 'ready', about: 'ready' },
    storage: null, files: [], channels: [], applets: [], logs: [], logCursor: -1,
    cronJobs: [], cronRuns: [],
    recovery: { available: false, latestRevision: null },
    memoryExport: { available: false, records: [] },
    about,
  };
}

export function createAdvancedSettingsAdapter(
  initial: AdvancedSettingsProjection,
  options: { onResetOnboarding: () => void; failFirstCommand?: boolean; cleanupMeasurement?: StorageMeasurement },
): AdvancedSettingsAdapter {
  let projection = initial;
  let nextId = 0;
  let failNext = options.failFirstCommand ?? false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<AdvancedSettingsProjection>) => {
    projection = { ...projection, ...patch };
    for (const listener of listeners) listener();
  };
  const requireRecord = <T extends { id: string }>(records: readonly T[], id: string): T => {
    const record = records.find(item => item.id === id);
    if (!record) throw new Error('This item is no longer available. Refresh and try again.');
    return record;
  };
  return {
    getSnapshot: () => projection,
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    execute: async command => {
      // Yield so the view can present pending feedback before command completion.
      await new Promise(resolve => window.setTimeout(resolve, 80));
      if (failNext) {
        failNext = false;
        throw new Error('Unable to complete the request. Your changes have been kept.');
      }
      switch (command.kind) {
        case 'refresh':
          publish({ states: { ...projection.states, [command.section]: 'ready' } });
          return { message: 'Refreshed.' };
        case 'tail-logs':
          // The injected tail is already bounded; there is no synthetic log producer.
          publish({ logCursor: projection.logs[projection.logs.length - 1]?.id ?? command.cursor });
          return { message: 'Logs refreshed.' };
        case 'set-retention':
          if (!projection.storage) throw new Error('Storage has not been measured.');
          publish({ storage: { ...projection.storage, retention: command.value } });
          return { message: 'Retention saved.' };
        case 'clear-cache': {
          const storage = projection.storage;
          if (!storage || storage.revision !== command.revision) throw new Error('Storage changed. Review the latest measurement.');
          const after = options.cleanupMeasurement;
          if (!after) throw new Error('Cache cleanup requires a new storage measurement.');
          const released = storage.physicalTotalBytes - after.physicalTotalBytes;
          if (released < 0) throw new Error('No released bytes were measured.');
          publish({ storage: after });
          return { message: `${formatMeasuredBytes(released)} released.` };
        }
        case 'patch-file': {
          requireRecord(projection.files, command.id);
          if (command.expires_at && command.clear_expires_at) throw new Error('Choose one expiration change.');
          publish({ files: projection.files.map(file => file.id !== command.id ? file : {
            ...file, visibility: command.visibility,
            expires_at: command.clear_expires_at ? null : command.expires_at ?? file.expires_at,
          }) });
          return { message: 'File updated.' };
        }
        case 'delete-file':
        case 'restore-file':
          requireRecord(projection.files, command.id);
          publish({ files: projection.files.map(file => file.id !== command.id ? file : {
            ...file, deleted_at: command.kind === 'delete-file' ? new Date().toISOString() : null,
          }) });
          return { message: command.kind === 'delete-file' ? 'Moved to trash.' : 'File restored.' };
        case 'save-channel': {
          if (!command.name.trim()) throw new Error('Enter a channel name.');
          const config = JSON.parse(command.config);
          if (!config.appId || !config.appSecret) throw new Error('App ID and App secret are required.');
          if (command.id) requireRecord(projection.channels, command.id);
          const existing = projection.channels.find(item => item.id === command.id);
          const channel: ChannelProjection = { ...existing, id: command.id ?? `channel-${++nextId}`, name: command.name.trim(), type: 'lark', enabled: existing?.enabled ?? false };
          publish({ channels: [...projection.channels.filter(item => item.id !== channel.id), channel] });
          // Credentials are command input only; they never enter the snapshot.
          return { message: 'Channel saved.' };
        }
        case 'toggle-channel':
          requireRecord(projection.channels, command.id);
          publish({ channels: projection.channels.map(channel => channel.id === command.id ? { ...channel, enabled: command.enabled } : channel) });
          return { message: command.enabled ? 'Channel enabled.' : 'Channel disabled.' };
        case 'delete-channel':
          requireRecord(projection.channels, command.id);
          publish({ channels: projection.channels.filter(channel => channel.id !== command.id) });
          return { message: 'Channel deleted.' };
        case 'save-cron': {
          validateCronDraft(command.draft);
          if (command.draft.deliveryMode === 'channel') {
            const channel = requireRecord(projection.channels, command.draft.deliveryChannelId);
            if (!channel.enabled || !channel.targets?.some(target => target.id === command.draft.deliveryTargetId && target.type === command.draft.deliveryTargetType)) {
              throw new Error('Choose an available channel destination.');
            }
          }
          if (command.id) requireRecord(projection.cronJobs, command.id);
          const existing = projection.cronJobs.find(job => job.id === command.id);
          const job = { ...command.draft, id: command.id ?? `cron-${++nextId}`, enabled: existing?.enabled ?? true };
          publish({ cronJobs: [...projection.cronJobs.filter(item => item.id !== job.id), job] });
          return { message: 'Scheduled task saved.' };
        }
        case 'toggle-cron':
          requireRecord(projection.cronJobs, command.id);
          publish({ cronJobs: projection.cronJobs.map(job => job.id === command.id ? { ...job, enabled: command.enabled } : job) });
          return { message: command.enabled ? 'Task resumed.' : 'Task paused.' };
        case 'delete-cron':
          requireRecord(projection.cronJobs, command.id);
          publish({ cronJobs: projection.cronJobs.filter(job => job.id !== command.id) });
          return { message: 'Task deleted.' };
        case 'run-cron':
          requireRecord(projection.cronJobs, command.id);
          publish({ cronRuns: [...projection.cronRuns, { id: ++nextId, jobId: command.id, startedAt: new Date().toISOString(), status: 'running', output: '' }] });
          return { message: 'Execution requested.' };
        case 'list-cron-runs':
          requireRecord(projection.cronJobs, command.id);
          return { message: 'Run history loaded.' };
        case 'create-recovery':
        case 'restore-recovery':
          throw new Error('Encrypted recovery requires its runtime adapter.');
        case 'export-memory':
          if (!projection.memoryExport.available) throw new Error('Memory export is unavailable.');
          return { message: 'Memory export prepared.', download: { name: 'memory-export.json', content: JSON.stringify(projection.memoryExport.records, null, 2), mime: 'application/json' } };
        case 'reset-onboarding':
          options.onResetOnboarding();
          return { message: 'Setup reopened.' };
      }
    },
  };
}

export function validateCronDraft(draft: CronDraft): void {
  if (!draft.name.trim()) throw new Error('Enter a task name.');
  if (draft.scheduleKind === 'cron' && draft.cronExpr.trim().split(/\s+/).length !== 5) throw new Error('Enter a five-field cron expression.');
  if (draft.scheduleKind === 'interval' && (!Number.isFinite(draft.intervalSec) || draft.intervalSec <= 0)) throw new Error('Interval must be greater than zero.');
  if (draft.scheduleKind === 'once' && !Number.isFinite(Date.parse(draft.runAt))) throw new Error('Choose a run time.');
  if (draft.execKind === 'shell' && !draft.shellCmd.trim()) throw new Error('Enter a shell command.');
  if (draft.execKind === 'agent' && !draft.agentPrompt.trim()) throw new Error('Enter an agent prompt.');
  if (draft.deliveryMode === 'channel' && !draft.deliveryChannelId) throw new Error('Choose an outbound channel.');
  if (draft.deliveryMode === 'channel' && !draft.deliveryTargetId) throw new Error('Choose a channel destination.');
}

export function formatMeasuredBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'Not measured';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toLocaleString(undefined, { maximumFractionDigits: exponent === 0 ? 0 : 1 })} ${units[exponent]}`;
}
