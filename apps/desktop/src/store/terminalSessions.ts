import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';

import {
  terminalDefaultWorkspace,
  terminalStationCreate,
  terminalStationList,
  terminalStationReconcile,
  terminalStationRemove,
  terminalStationUpdate,
  terminalWorkerCreate,
  terminalWorkerKill,
  terminalWorkerList,
  terminalWorkerRead,
  terminalWorkerRemove,
  terminalWorkerWrite,
  type TerminalSessionMeta,
  type TerminalStationSession,
} from '../services/desktop_api';
import { log } from '../utils/logger';

// TW-D5: terminal sessions are device-held worker resources. The store only
// keeps subscription state (cursor + text) and merges Station metadata with
// live worker proof. A Station row saying RUNNING without a live handle is
// never displayed as running.

export type TerminalStatus = 'running' | 'exited' | 'killed' | 'unknown';

export interface TerminalSessionView {
  sessionId: string;
  conversationId: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  status: TerminalStatus;
  exitCode: number | null;
  outputBytes: number;
  live: boolean;
  startedAtMs: number;
}

type OutputSubscriber = (chunk: string, meta: TerminalSessionMeta) => void;
type StatusSubscriber = (meta: TerminalSessionMeta) => void;

const STATION_RUNNING = 'TERMINAL_SESSION_STATUS_RUNNING';

function stationStatusToView(status: string): TerminalStatus {
  switch (status) {
    case 'TERMINAL_SESSION_STATUS_EXITED':
      return 'exited';
    case 'TERMINAL_SESSION_STATUS_KILLED':
      return 'killed';
    case 'TERMINAL_SESSION_STATUS_UNKNOWN':
      return 'unknown';
    default:
      return 'unknown';
  }
}

type StationTerminalStatus =
  | 'TERMINAL_SESSION_STATUS_RUNNING'
  | 'TERMINAL_SESSION_STATUS_EXITED'
  | 'TERMINAL_SESSION_STATUS_KILLED'
  | 'TERMINAL_SESSION_STATUS_UNKNOWN';

function viewStatusToStation(status: TerminalStatus): StationTerminalStatus {
  switch (status) {
    case 'running':
      return 'TERMINAL_SESSION_STATUS_RUNNING';
    case 'exited':
      return 'TERMINAL_SESSION_STATUS_EXITED';
    case 'killed':
      return 'TERMINAL_SESSION_STATUS_KILLED';
    default:
      return 'TERMINAL_SESSION_STATUS_UNKNOWN';
  }
}

/**
 * Merge Station-persisted metadata with worker handles. Worker proof is
 * authoritative for liveness while it exists; a RUNNING Station row without
 * a live handle collapses to UNKNOWN (no daemon survived the restart).
 */
export function mergeTerminalSessions(
  stationRows: TerminalStationSession[],
  liveMetas: Map<string, TerminalSessionMeta>,
): TerminalSessionView[] {
  return stationRows.map((row) => {
    const live = liveMetas.get(row.sessionId);
    const status: TerminalStatus = live
      ? live.status
      : row.status === STATION_RUNNING
        ? 'unknown'
        : stationStatusToView(row.status);
    const outputBytes = live
      ? live.outputBytes
      : Number(row.outputBytes ?? 0) || 0;
    return {
      sessionId: row.sessionId,
      conversationId: row.conversationId,
      command: row.command,
      args: row.args ?? [],
      cwd: row.cwd,
      pid: live?.pid ?? row.pid ?? 0,
      status,
      exitCode: live ? live.exitCode ?? null : row.exitCode ?? null,
      outputBytes,
      live: Boolean(live),
      startedAtMs: live?.startedAtMs ?? 0,
    };
  }).sort((left, right) => right.startedAtMs - left.startedAtMs);
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export interface CreateTerminalInput {
  conversationId: string;
  turnId?: string;
  command: string;
  args?: string[];
  cwd?: string;
}

interface TerminalSessionState {
  sessionsByConversation: Record<string, TerminalSessionView[]>;
  activeSessionByConversation: Record<string, string>;
  liveMetas: Record<string, TerminalSessionMeta>;
  cursors: Record<string, number>;
  text: Record<string, string>;
  open: boolean;
  // Last proven device id, so lifecycle events can re-merge with an honest
  // reconcile without the Page passing it around again.
  deviceId: string;
  creating: boolean;
  eventBound: boolean;

  setOpen: (open: boolean) => void;
  selectSession: (conversationId: string, sessionId: string) => void;
  initConversation: (conversationId: string, deviceId: string) => Promise<void>;
  createSession: (input: CreateTerminalInput, deviceId: string) => Promise<TerminalSessionView>;
  killSession: (conversationId: string, sessionId: string) => Promise<void>;
  removeSession: (conversationId: string, sessionId: string) => Promise<void>;
  attachOutput: (sessionId: string, subscriber: OutputSubscriber) => () => void;
  attachStatus: (sessionId: string, subscriber: StatusSubscriber) => () => void;
  hydrateFromCursor: (sessionId: string, cursor: number) => Promise<void>;
  writeInput: (sessionId: string, data: string) => Promise<void>;
}

const outputSubscribers = new Map<string, Set<OutputSubscriber>>();
const statusSubscribers = new Map<string, Set<StatusSubscriber>>();

function subscribe<T>(map: Map<string, Set<T>>, key: string, fn: T): () => void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

function reportTerminalStatus(meta: TerminalSessionMeta): void {
  if (meta.status === 'running') return;
  void terminalStationUpdate({
    sessionId: meta.sessionId,
    status: viewStatusToStation(meta.status),
    exitCode: meta.exitCode ?? 0,
    outputBytes: String(meta.outputBytes),
  }).catch((error: unknown) => {
    log.warn('terminal', 'failed to report terminal status', {
      sessionId: meta.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

let eventBinding: Promise<void> | null = null;

type TerminalSet = (
  partial:
    | Partial<TerminalSessionState>
    | ((state: TerminalSessionState) => Partial<TerminalSessionState>),
) => void;

function bindTerminalEvents(
  get: () => TerminalSessionState,
  set: TerminalSet,
): Promise<void> {
  if (eventBinding) return eventBinding;
  eventBinding = listen<{
    sessionId: string;
    kind: 'output' | 'status';
    chunkB64?: string;
    status?: TerminalStatus;
    exitCode?: number | null;
    outputBytes?: number;
  }>('peers-touch://terminal-session-event', (event) => {
    const payload = event.payload;
    if (!payload?.sessionId) return;
    if (payload.kind === 'output' && payload.chunkB64) {
      const text = decodeBase64Utf8(payload.chunkB64);
      const state = get();
      const current = state.text[payload.sessionId] ?? '';
      const previousMeta = state.liveMetas[payload.sessionId];
      const meta: TerminalSessionMeta = previousMeta
        ? { ...previousMeta, outputBytes: payload.outputBytes ?? previousMeta.outputBytes }
        : previousMeta as TerminalSessionMeta;
      set({
        text: { ...state.text, [payload.sessionId]: current + text },
        liveMetas: previousMeta
          ? { ...state.liveMetas, [payload.sessionId]: meta }
          : state.liveMetas,
      });
      if (previousMeta) {
        outputSubscribers.get(payload.sessionId)?.forEach((fn) => fn(text, meta));
      }
      return;
    }
    if (payload.kind === 'status' && payload.status) {
      const previous = get().liveMetas[payload.sessionId];
      if (!previous) return;
      const meta: TerminalSessionMeta = {
        ...previous,
        status: payload.status,
        exitCode: payload.exitCode ?? null,
        outputBytes: payload.outputBytes ?? previous.outputBytes,
      };
      set({ liveMetas: { ...get().liveMetas, [payload.sessionId]: meta } });
      statusSubscribers.get(payload.sessionId)?.forEach((fn) => fn(meta));
      reportTerminalStatus(meta);
      // Re-merge the owning conversation so its view reflects the terminal
      // lifecycle. A device id is known after the first init, so the refresh
      // keeps the same honesty gate (reconcile) as user-triggered loads.
      const owningConversation = Object.keys(get().sessionsByConversation)
        .find((key) => get().sessionsByConversation[key]
          ?.some((session) => session.sessionId === payload.sessionId));
      if (owningConversation) {
        void get().initConversation(owningConversation, get().deviceId)
          .catch(() => undefined);
      }
    }
  }).then(() => undefined);
  return eventBinding;
}

// Draft topics have no Station conversation yet. Sessions started there are
// stored unbound (empty conversation_id on Station); they surface in the
// draft panel via device-wide reconcile rows. They attach to a persisted
// conversation through a later rebind flow, not during TW-D5.
function isDraftConversationKey(conversationId: string): boolean {
  return conversationId === '' || conversationId.startsWith('draft:');
}

function rowsForConversation(
  rows: TerminalStationSession[],
  conversationId: string,
): TerminalStationSession[] {
  if (isDraftConversationKey(conversationId)) {
    return rows.filter((row) => isDraftConversationKey(row.conversationId));
  }
  return rows.filter((row) => row.conversationId === conversationId);
}

function commitConversation(
  set: TerminalSet,
  conversationId: string,
  views: TerminalSessionView[],
  liveList: TerminalSessionMeta[],
  deviceId: string,
): void {
  set((state) => {
    const previousActive = state.activeSessionByConversation[conversationId];
    const activeBelongs = views.some((session) => session.sessionId === previousActive);
    return {
      deviceId: deviceId || state.deviceId,
      liveMetas: {
        ...state.liveMetas,
        ...Object.fromEntries(liveList.map((meta) => [meta.sessionId, meta])),
      },
      sessionsByConversation: {
        ...state.sessionsByConversation,
        [conversationId]: views,
      },
      activeSessionByConversation: {
        ...state.activeSessionByConversation,
        [conversationId]: activeBelongs ? previousActive : (views[0]?.sessionId ?? ''),
      },
    };
  });
}

export const useTerminalSessionsStore = create<TerminalSessionState>()((set, get) => ({
  sessionsByConversation: {},
  activeSessionByConversation: {},
  liveMetas: {},
  cursors: {},
  text: {},
  open: false,
  deviceId: '',
  creating: false,
  eventBound: false,

  setOpen: (open) => set({ open }),

  selectSession: (conversationId, sessionId) => set((state) => ({
    activeSessionByConversation: {
      ...state.activeSessionByConversation,
      [conversationId]: sessionId,
    },
  })),

  initConversation: async (conversationId, deviceId) => {
    const provenDeviceId = deviceId || get().deviceId;
    const [liveList, stationRows] = await Promise.all([
      terminalWorkerList().catch(() => [] as TerminalSessionMeta[]),
      terminalStationList(conversationId).catch(() => [] as TerminalStationSession[]),
    ]);
    const liveMap = new Map(liveList.map((meta) => [meta.sessionId, meta]));
    // Honesty gate: every RUNNING Station row this device cannot prove is
    // downgraded to UNKNOWN on the Station as well.
    if (provenDeviceId) {
      const liveIds = liveList.map((meta) => meta.sessionId);
      const reconciled = await terminalStationReconcile(provenDeviceId, liveIds)
        .catch(() => null);
      if (reconciled) {
        const rows = rowsForConversation(reconciled, conversationId);
        commitConversation(
          set,
          conversationId,
          mergeTerminalSessions(rows, liveMap),
          liveList,
          provenDeviceId,
        );
        return;
      }
    }
    commitConversation(
      set,
      conversationId,
      mergeTerminalSessions(stationRows, liveMap),
      liveList,
      provenDeviceId,
    );
  },

  createSession: async (input, deviceId) => {
    set({ creating: true });
    try {
      await bindTerminalEvents(get, set);
      const { workspaceRoot } = await terminalDefaultWorkspace(deviceId);
      const workerMeta = await terminalWorkerCreate({
        command: input.command,
        args: input.args ?? [],
        cwd: input.cwd,
        workspaceRoot,
      });
      try {
        await terminalStationCreate({
          sessionId: workerMeta.sessionId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          deviceId,
          cwd: workerMeta.cwd,
          command: workerMeta.command,
          args: workerMeta.args,
          pid: workerMeta.pid,
        });
      } catch (error) {
        await terminalWorkerKill(workerMeta.sessionId).catch(() => undefined);
        throw error;
      }
      set((state) => ({
        liveMetas: { ...state.liveMetas, [workerMeta.sessionId]: workerMeta },
        cursors: { ...state.cursors, [workerMeta.sessionId]: 0 },
        text: { ...state.text, [workerMeta.sessionId]: '' },
        activeSessionByConversation: {
          ...state.activeSessionByConversation,
          [input.conversationId]: workerMeta.sessionId,
        },
      }));
      await get().initConversation(input.conversationId, deviceId);
      const view = get()
        .sessionsByConversation[input.conversationId]
        ?.find((session) => session.sessionId === workerMeta.sessionId);
      if (!view) throw new Error('terminal session missing after create');
      return view;
    } finally {
      set({ creating: false });
    }
  },

  killSession: async (conversationId, sessionId) => {
    const meta = await terminalWorkerKill(sessionId);
    set((state) => ({ liveMetas: { ...state.liveMetas, [sessionId]: meta } }));
    await get().initConversation(conversationId, get().deviceId).catch(() => undefined);
  },

  removeSession: async (conversationId, sessionId) => {
    await terminalWorkerRemove(sessionId).catch(() => undefined);
    await terminalStationRemove(sessionId).catch(() => undefined);
    await get().initConversation(conversationId, get().deviceId).catch(() => undefined);
  },

  attachOutput: (sessionId, subscriber) => subscribe(outputSubscribers, sessionId, subscriber),
  attachStatus: (sessionId, subscriber) => subscribe(statusSubscribers, sessionId, subscriber),

  hydrateFromCursor: async (sessionId, cursor) => {
    const read = await terminalWorkerRead(sessionId, cursor);
    if (!read.chunkB64) return;
    const text = decodeBase64Utf8(read.chunkB64);
    set((state) => ({
      liveMetas: { ...state.liveMetas, [sessionId]: read.meta },
      cursors: { ...state.cursors, [sessionId]: read.nextCursor },
      text: { ...state.text, [sessionId]: (state.text[sessionId] ?? '') + text },
    }));
  },

  writeInput: async (sessionId, data) => {
    const bytes = new TextEncoder().encode(data);
    await terminalWorkerWrite(sessionId, bytes);
  },
}));
