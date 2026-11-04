import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';

import {
  terminalDefaultWorkspace,
  terminalSandboxPtyRead,
  terminalSandboxPtyResize,
  terminalSandboxPtySignal,
  terminalSandboxPtyWrite,
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
  terminalWorkerResize,
  terminalWorkerWrite,
  type TerminalSessionMeta,
  type TerminalStationSession,
} from '../services/desktop_api';
import { log } from '../utils/logger';

// TW-D5: terminal sessions are device-held worker resources. The store only
// keeps subscription state (cursor + text) and merges Station metadata with
// live worker proof. A Station row saying RUNNING without a live handle is
// never displayed as running.
//
// WE-S6: WORKSPACE_SANDBOX sessions have no local Rust worker and no Tauri
// event stream; Station proxies their PTY over HTTP, so the store polls
// /agent/sandbox-pty/read on an interval instead of subscribing to worker
// events. The two paths never mix: placement is read from the Station row.

export type TerminalStatus = 'running' | 'exited' | 'killed' | 'unknown';

export type ExecutionPlacement = 'desktop' | 'sandbox';

// Sandbox PTY rows encode ExecutionTarget as the proto enum number (2) over
// the JSON wire; tolerate the string form and proto-enum-name form.
const SANDBOX_TARGET = 2;
function rowPlacement(row: TerminalStationSession): ExecutionPlacement {
  const target = row.executionTarget;
  if (target === SANDBOX_TARGET || target === String(SANDBOX_TARGET) || target === 'EXECUTION_TARGET_WORKSPACE_SANDBOX') {
    return 'sandbox';
  }
  return 'desktop';
}

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
  // WE-S6: where the process actually lives. Desktop rows are unchanged.
  placement: ExecutionPlacement;
  sandboxRef: string;
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
    const placement = rowPlacement(row);
    // Sandbox sessions are live as long as the Station row says RUNNING (the
    // proxy poll provides liveness); device sessions require a worker handle.
    const stationRunning = row.status === STATION_RUNNING;
    const isLive = placement === 'sandbox' ? stationRunning : Boolean(live);
    const status: TerminalStatus = placement === 'sandbox'
      ? (stationRunning ? 'running' : stationStatusToView(row.status))
      : live
        ? live.status
        : stationRunning
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
      live: isLive,
      startedAtMs: live?.startedAtMs ?? 0,
      placement,
      sandboxRef: row.sandboxRef ?? '',
    };
  }).sort((left, right) => right.startedAtMs - left.startedAtMs);
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// Station validates session ids as "terms-" + 26 Crockford-base32 chars.
// Sandbox sessions are Station-minted (there is no local worker), so the
// client generates the same ULID-shaped id.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function mintSessionId(): string {
  let suffix = '';
  const values = new Uint32Array(7);
  crypto.getRandomValues(values);
  for (const value of values) {
    suffix += CROCKFORD[value % 32];
    if (suffix.length === 26) break;
  }
  return `terms-${suffix.slice(0, 26)}`;
}

// Start polling a sandbox PTY and fan new bytes out through the same output
// subscriber channel the device worker uses, so the viewer is placement
// agnostic. Honors the bounded cursor; stops once the process exits/kills.
function startSandboxPump(get: () => TerminalSessionState, set: TerminalSet, sessionId: string): void {
  if (sandboxPollers.has(sessionId)) return;
  const tick = async () => {
    const cursor = get().cursors[sessionId] ?? 0;
    try {
      const read = await terminalSandboxPtyRead(sessionId, cursor, 64 * 1024);
      const metaFor = (status: TerminalStatus): TerminalSessionMeta => {
        const view = findView(get, sessionId);
        return {
          sessionId,
          command: view?.command ?? '',
          args: view?.args ?? [],
          cwd: view?.cwd ?? '',
          pid: view?.pid ?? 0,
          status,
          exitCode: read.exitCode ?? null,
          outputBytes: read.outputBytes,
          startedAtMs: view?.startedAtMs ?? 0,
        };
      };
      if (read.data.length > 0) {
        const text = new TextDecoder().decode(read.data);
        set((state) => ({
          cursors: { ...state.cursors, [sessionId]: read.nextCursor },
          text: { ...state.text, [sessionId]: (state.text[sessionId] ?? '') + text },
        }));
        outputSubscribers.get(sessionId)?.forEach((fn) => fn(text, metaFor(mapProtoStatus(read.status))));
      }
      // Terminal states EXITED(2)/KILLED(3) end the poll; UNKNOWN(0/4) leaves
      // it running so a transient gap can recover.
      if (read.status === 2 || read.status === 3) {
        statusSubscribers.get(sessionId)?.forEach((fn) => fn(metaFor(mapProtoStatus(read.status))));
        stopSandboxPump(sessionId);
        void get().initConversation(findConversationForSession(get, sessionId), get().deviceId)
          .catch(() => undefined);
      } else if (read.status === 1) {
        // A successful read is the sandbox liveness proof. After a cold-start
        // reconcile downgraded the row to UNKNOWN, re-merge once so the panel
        // flips back to running; later reads see a live view and stay quiet.
        provenSandboxSessions.add(sessionId);
        const view = findView(get, sessionId);
        if (view?.placement === 'sandbox' && !view.live) {
          void get().initConversation(findConversationForSession(get, sessionId), get().deviceId)
            .catch(() => undefined);
        }
      }
    } catch (error) {
      log.warn('terminal', 'sandbox pty poll failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const handle = setInterval(() => { void tick(); }, SANDBOX_POLL_MS);
  sandboxPollers.set(sessionId, handle);
  void tick();
}

function mapProtoStatus(status: number): TerminalStatus {
  switch (status) {
    case 1: return 'running';
    case 2: return 'exited';
    case 3: return 'killed';
    default: return 'unknown';
  }
}

function stopSandboxPump(sessionId: string): void {
  const handle = sandboxPollers.get(sessionId);
  if (handle) {
    clearInterval(handle);
    sandboxPollers.delete(sessionId);
  }
  provenSandboxSessions.delete(sessionId);
}

function findConversationForSession(get: () => TerminalSessionState, sessionId: string): string {
  const found = Object.entries(get().sessionsByConversation)
    .find(([, sessions]) => sessions.some((session) => session.sessionId === sessionId));
  return found?.[0] ?? '';
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
  // WE-S6: create a Station-proxied terminal inside an allocated sandbox.
  createSandboxSession: (input: CreateTerminalInput, sandboxRef: string) => Promise<TerminalSessionView>;
  killSession: (conversationId: string, sessionId: string) => Promise<void>;
  removeSession: (conversationId: string, sessionId: string) => Promise<void>;
  attachOutput: (sessionId: string, subscriber: OutputSubscriber) => () => void;
  attachStatus: (sessionId: string, subscriber: StatusSubscriber) => () => void;
  hydrateFromCursor: (sessionId: string, cursor: number) => Promise<void>;
  writeInput: (sessionId: string, data: string) => Promise<void>;
  // Placement-aware primitives used by the xterm viewer.
  initialRead: (session: TerminalSessionView) => Promise<{ text: string; resync: boolean }>;
  resize: (session: TerminalSessionView, cols: number, rows: number) => Promise<void>;
}

const outputSubscribers = new Map<string, Set<OutputSubscriber>>();
const statusSubscribers = new Map<string, Set<StatusSubscriber>>();

// WE-S6 poll handles for sandbox PTYs (no Rust worker/Tauri events).
const sandboxPollers = new Map<string, ReturnType<typeof setInterval>>();
// Session ids the poll pump has proven alive through a successful PTY read
// since the last cold start. Boot-time sandbox reconcile passes these as live
// ids (mirroring device worker handles); an in-memory reset means a fresh
// client proves nothing until its first read.
const provenSandboxSessions = new Set<string>();
const SANDBOX_POLL_MS = 400;

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
    outputBytes: meta.outputBytes,
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

// Reconcile a single sandbox_ref scope. Only sessions the pump has already
// proven alive (successful PTY read since cold start) count as live; every
// other RUNNING row in the ref downgrades to UNKNOWN. A failed reconcile falls
// back to the listed rows for that ref so sandbox terminals never disappear.
async function reconcileSandboxRef(
  sandboxRef: string,
  listed: TerminalStationSession[],
  conversationId: string,
): Promise<TerminalStationSession[]> {
  const liveIds = [...provenSandboxSessions];
  const reconciled = await terminalStationReconcile('', liveIds, { sandboxRef })
    .catch(() => null);
  const inRef = (row: TerminalStationSession): boolean =>
    rowPlacement(row) === 'sandbox' && row.sandboxRef === sandboxRef;
  if (reconciled) {
    return rowsForConversation(reconciled, conversationId).filter(inRef);
  }
  return rowsForConversation(listed, conversationId).filter(inRef);
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
    const listed = rowsForConversation(stationRows, conversationId);

    // DESKTOP_DEVICE honesty gate: device_id-scoped reconcile downgrades every
    // RUNNING row this device cannot prove. Falls back to listed rows when the
    // reconcile RPC is unavailable so the panel never loses its terminals.
    let desktopRows = listed.filter((row) => rowPlacement(row) === 'desktop');
    if (provenDeviceId) {
      const liveIds = liveList.map((meta) => meta.sessionId);
      const reconciled = await terminalStationReconcile(provenDeviceId, liveIds)
        .catch(() => null);
      if (reconciled) {
        desktopRows = rowsForConversation(reconciled, conversationId)
          .filter((row) => rowPlacement(row) === 'desktop');
      }
    }

    // WORKSPACE_SANDBOX honesty gate, independent of device liveness: one
    // sandbox_ref-scoped reconcile per ref. On a cold start nothing is proven
    // yet, so RUNNING rows collapse to UNKNOWN until the pump's first read
    // re-proves them. Desktop reconcile never returns sandbox rows (device_id
    // is empty for them), so without this merge they would vanish on reload.
    const sandboxRefs = [...new Set(
      listed.flatMap((row) => (
        rowPlacement(row) === 'sandbox' && row.sandboxRef ? [row.sandboxRef] : []
      )),
    )];
    const sandboxRows = (
      await Promise.all(sandboxRefs.map((ref) => reconcileSandboxRef(ref, listed, conversationId)))
    ).flat();

    const views = mergeTerminalSessions([...desktopRows, ...sandboxRows], liveMap);
    commitConversation(set, conversationId, views, liveList, provenDeviceId);

    // Resume the poll pump for every non-terminal sandbox session so output
    // and liveness continue across reloads. Idempotent per session id.
    for (const view of views) {
      if (view.placement === 'sandbox' && view.status !== 'exited' && view.status !== 'killed') {
        startSandboxPump(get, set, view.sessionId);
      }
    }
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

  createSandboxSession: async (input, sandboxRef) => {
    set({ creating: true });
    const sessionId = mintSessionId();
    try {
      // Station create opens the provisioner PTY inside the live sandbox and
      // fails closed if the sandbox/provisioner is unavailable.
      const created = await terminalStationCreate({
        sessionId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        deviceId: '',
        cwd: input.cwd ?? '',
        command: input.command,
        args: input.args ?? [],
        pid: 0,
        executionTarget: 'EXECUTION_TARGET_WORKSPACE_SANDBOX',
        sandboxRef,
      });
      set((state) => ({
        cursors: { ...state.cursors, [sessionId]: 0 },
        text: { ...state.text, [sessionId]: '' },
        activeSessionByConversation: {
          ...state.activeSessionByConversation,
          [input.conversationId]: sessionId,
        },
      }));
      // A successful create means the provisioner opened the PTY, so it is
      // proven live: the reconcile inside init must not downgrade it.
      provenSandboxSessions.add(sessionId);
      await get().initConversation(input.conversationId, get().deviceId);
      startSandboxPump(get, set, sessionId);
      const view = get()
        .sessionsByConversation[input.conversationId]
        ?.find((session) => session.sessionId === sessionId);
      if (view) return view;
      return {
        sessionId,
        conversationId: input.conversationId,
        command: input.command,
        args: input.args ?? [],
        cwd: input.cwd ?? '',
        pid: 0,
        status: 'running' as TerminalStatus,
        exitCode: null,
        outputBytes: 0,
        live: true,
        startedAtMs: 0,
        placement: 'sandbox' as ExecutionPlacement,
        sandboxRef: created.sandboxRef ?? sandboxRef,
      };
    } finally {
      set({ creating: false });
    }
  },

  killSession: async (conversationId, sessionId) => {
    const session = findView(get, sessionId);
    if (session?.placement === 'sandbox') {
      await terminalSandboxPtySignal(sessionId, 9);
    } else {
      const meta = await terminalWorkerKill(sessionId);
      set((state) => ({ liveMetas: { ...state.liveMetas, [sessionId]: meta } }));
    }
    await get().initConversation(conversationId, get().deviceId).catch(() => undefined);
  },

  removeSession: async (conversationId, sessionId) => {
    const session = findView(get, sessionId);
    if (session?.placement === 'sandbox') {
      stopSandboxPump(sessionId);
    } else {
      await terminalWorkerRemove(sessionId).catch(() => undefined);
    }
    // Station remove closes the provisioner PTY for sandbox rows.
    await terminalStationRemove(sessionId).catch(() => undefined);
    await get().initConversation(conversationId, get().deviceId).catch(() => undefined);
  },

  attachOutput: (sessionId, subscriber) => subscribe(outputSubscribers, sessionId, subscriber),
  attachStatus: (sessionId, subscriber) => subscribe(statusSubscribers, sessionId, subscriber),

  hydrateFromCursor: async (sessionId, cursor) => {
    const session = findView(get, sessionId);
    if (session?.placement === 'sandbox') {
      // Sandbox scrollback is delivered by the poller; nothing extra to fetch.
      return;
    }
    const read = await terminalWorkerRead(sessionId, cursor);
    if (!read.chunkB64) return;
    const text = decodeBase64Utf8(read.chunkB64);
    set((state) => ({
      liveMetas: { ...state.liveMetas, [sessionId]: read.meta },
      cursors: { ...state.cursors, [sessionId]: read.nextCursor },
      text: { ...state.text, [sessionId]: (state.text[sessionId] ?? '') + text },
    }));
  },

  initialRead: async (session) => {
    if (session.placement === 'sandbox') {
      // The poller streams from cursor 0; replay any text already captured.
      const text = get().text[session.sessionId] ?? '';
      return { text, resync: false };
    }
    const read = await terminalWorkerRead(session.sessionId, 0);
    const text = decodeBase64Utf8(read.chunkB64 || '');
    return { text, resync: Boolean(read.resync) };
  },

  resize: async (session, cols, rows) => {
    if (session.placement === 'sandbox') {
      await terminalSandboxPtyResize(session.sessionId, cols, rows);
    } else {
      await terminalWorkerResize(session.sessionId, cols, rows);
    }
  },

  writeInput: async (sessionId, data) => {
    const session = findView(get, sessionId);
    const bytes = new TextEncoder().encode(data);
    if (session?.placement === 'sandbox') {
      await terminalSandboxPtyWrite(sessionId, bytes);
    } else {
      await terminalWorkerWrite(sessionId, bytes);
    }
  },
}));

function findView(get: () => TerminalSessionState, sessionId: string): TerminalSessionView | undefined {
  for (const sessions of Object.values(get().sessionsByConversation)) {
    const found = sessions.find((session) => session.sessionId === sessionId);
    if (found) return found;
  }
  return undefined;
}

