import { create } from 'zustand';
import {
  browserHostInfo,
  browserStationCreate,
  browserStationList,
  browserStationReconcile,
  browserStationRemove,
  browserStationUpdate,
  browserWorkerClick,
  browserWorkerCloseTab,
  browserWorkerCreate,
  browserWorkerFill,
  browserWorkerHistory,
  browserWorkerInspect,
  browserWorkerList,
  browserWorkerNavigate,
  browserWorkerRelease,
  browserWorkerRemove,
  browserWorkerScreenshot,
  browserWorkerSnapshot,
  browserWorkerSubmit,
  browserWorkerTakeover,
  type BrowserHostInfo,
  type BrowserSessionMeta,
  type BrowserSnapshot,
  type BrowserStationSession,
  type BrowserTabMeta,
} from '../services/desktop_api';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';

// TW-D6: device-held real browser sessions. The browser process/tabs live in
// the Rust worker (CDP host). This store is a subscriber/orchestrator and
// Station metadata is merged with live worker proof: a Station ACTIVE row
// without a live handle is never shown as controllable.

const STATION_RUNNING = 'BROWSER_SESSION_STATUS_ACTIVE';
const STATION_CLOSED = 'BROWSER_SESSION_STATUS_CLOSED';
const STATION_LEASE_HUMAN = 'BROWSER_CONTROL_LEASE_HUMAN';

// Crockford Base32 ULID — matches the Station id contract brows-<26 chars>.
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newBrowserSessionId(): string {
  let time = Date.now();
  const timeChars = new Array<string>(10);
  for (let i = 9; i >= 0; i -= 1) {
    timeChars[i] = ULID_ALPHABET[time % 32];
    time = Math.floor(time / 32);
  }
  const randomChars = new Array<string>(16);
  for (let i = 0; i < 16; i += 1) {
    randomChars[i] = ULID_ALPHABET[Math.floor(Math.random() * 32)];
  }
  return `brows-${timeChars.join('')}${randomChars.join('')}`;
}

export interface BrowserSessionView {
  sessionId: string;
  conversationId: string;
  engine: string;
  status: 'active' | 'closed' | 'unknown';
  lease: 'agent' | 'human';
  tabs: BrowserTabMeta[];
  live: boolean;
}

export interface BrowserScreenshotView {
  dataUrl: string;
  innerWidth: number;
  innerHeight: number;
  capturedAt: number;
}

interface BrowserSessionState {
  host: BrowserHostInfo | null;
  sessionsByConversation: Record<string, BrowserSessionView[]>;
  activeSessionByConversation: Record<string, string>;
  snapshotByTab: Record<string, BrowserSnapshot>;
  screenshotByTab: Record<string, BrowserScreenshotView>;
  hostChecked: boolean;
  busy: boolean;
  deviceId: string;
  setOpen: (open: boolean) => void;
  open: boolean;
  setDeviceId: (deviceId: string) => void;
  probeHost: () => Promise<void>;
  initConversation: (conversationId: string, deviceId: string) => Promise<void>;
  selectSession: (conversationId: string, sessionId: string) => void;
  createSession: (input: {
    conversationId: string;
    turnId?: string;
    initialUrl?: string;
    deviceId: string;
  }) => Promise<BrowserSessionView>;
  navigate: (conversationId: string, tabId: string, url: string) => Promise<void>;
  history: (
    conversationId: string,
    tabId: string,
    direction: 'back' | 'forward' | 'reload',
  ) => Promise<void>;
  observe: (conversationId: string, tabId: string) => Promise<BrowserSnapshot | null>;
  click: (conversationId: string, tabId: string, ref: string) => Promise<void>;
  fill: (conversationId: string, tabId: string, ref: string, value: string) => Promise<void>;
  submit: (conversationId: string, tabId: string, ref: string) => Promise<void>;
  closeTab: (conversationId: string, tabId: string) => Promise<void>;
  screenshot: (conversationId: string, tabId: string) => Promise<string>;
  takeover: (conversationId: string) => Promise<void>;
  release: (conversationId: string) => Promise<void>;
  removeSession: (conversationId: string) => Promise<void>;
}

function stationStatusToView(status: string): BrowserSessionView['status'] {
  switch (status) {
    case STATION_CLOSED:
      return 'closed';
    case STATION_RUNNING:
      return 'active';
    default:
      return 'unknown';
  }
}

function stationLeaseToView(lease: string): BrowserSessionView['lease'] {
  return lease === STATION_LEASE_HUMAN ? 'human' : 'agent';
}

function viewStatusToStation(status: BrowserSessionView['status']): number {
  // Enum order mirrors browser_session.proto (unspecified=0, active=1,
  // closed=2, unknown=3).
  if (status === 'active') return 1;
  if (status === 'closed') return 2;
  return 3;
}

function viewLeaseToStation(lease: BrowserSessionView['lease']): number {
  return lease === 'human' ? 2 : 1;
}

function mergeSessions(
  conversationId: string,
  stationRows: BrowserStationSession[],
  liveMap: Map<string, BrowserSessionMeta>,
): BrowserSessionView[] {
  return stationRows.map((row) => {
    const live = liveMap.get(row.sessionId);
    const status = live
      ? (live.status as BrowserSessionView['status'])
      : row.status === STATION_RUNNING
        ? 'unknown'
        : stationStatusToView(row.status);
    return {
      sessionId: row.sessionId,
      conversationId,
      engine: row.engine,
      status,
      lease: live ? (live.lease as BrowserSessionView['lease']) : stationLeaseToView(row.lease),
      tabs: live?.tabs ?? row.tabs ?? [],
      live: Boolean(live),
    };
  });
}

async function reportSession(meta: BrowserSessionMeta): Promise<void> {
  const viewStatus: BrowserSessionView['status'] =
    meta.status === 'closed' ? 'closed' : meta.status === 'unknown' ? 'unknown' : 'active';
  try {
    await browserStationUpdate({
      sessionId: meta.sessionId,
      status: viewStatusToStation(viewStatus),
      lease: viewLeaseToStation(meta.lease as BrowserSessionView['lease']),
      tabs: meta.tabs,
    });
  } catch (error) {
    log.warn('browser', 'failed to report session state', {
      sessionId: meta.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const useBrowserSessionsStore = create<BrowserSessionState>((set, get) => ({
  host: null,
  sessionsByConversation: {},
  activeSessionByConversation: {},
  snapshotByTab: {},
  screenshotByTab: {},
  hostChecked: false,
  busy: false,
  deviceId: '',
  open: false,

  setOpen: (open) => set({ open }),

  setDeviceId: (deviceId) => set({ deviceId }),

  probeHost: async () => {
    try {
      const host = await browserHostInfo();
      set({ host, hostChecked: true });
    } catch {
      set({
        host: { available: false, engine: '', version: '', path: '' },
        hostChecked: true,
      });
    }
  },

  initConversation: async (conversationId, deviceId) => {
    const [liveList, stationRows] = await Promise.all([
      browserWorkerList().catch(() => [] as BrowserSessionMeta[]),
      browserStationList(conversationId).catch(() => [] as BrowserStationSession[]),
    ]);
    const liveMap = new Map(liveList.map((meta) => [meta.sessionId, meta]));
    const views = mergeSessions(conversationId, stationRows, liveMap);
    // Honesty gate: every ACTIVE Station row this device cannot prove alive
    // is downgraded UNKNOWN on the Station as well.
    if (deviceId) {
      const liveIds = liveList.map((meta) => meta.sessionId);
      const reconciled = await browserStationReconcile(deviceId, liveIds).catch(
        () => [] as BrowserStationSession[],
      );
      if (reconciled.length > 0) {
        const reMap = new Map(liveList.map((meta) => [meta.sessionId, meta]));
        views.splice(0, views.length, ...mergeSessions(conversationId, reconciled, reMap));
      }
    }
    set((state) => ({
      deviceId,
      sessionsByConversation: { ...state.sessionsByConversation, [conversationId]: views },
      activeSessionByConversation: {
        ...state.activeSessionByConversation,
        [conversationId]:
          state.activeSessionByConversation[conversationId]
          ?? views.find((session) => session.status === 'active')?.sessionId
          ?? '',
      },
    }));
  },

  selectSession: (conversationId, sessionId) => {
    set((state) => ({
      activeSessionByConversation: {
        ...state.activeSessionByConversation,
        [conversationId]: sessionId,
      },
    }));
  },

  createSession: async ({ conversationId, turnId, initialUrl, deviceId }) => {
    const sessionId = newBrowserSessionId();
    const workerMeta = await browserWorkerCreate(sessionId);
    try {
      await browserStationCreate({
        sessionId,
        conversationId,
        turnId,
        deviceId,
        engine: workerMeta.engine,
      });
    } catch (error) {
      await browserWorkerRemove(sessionId).catch(() => undefined);
      throw error;
    }
    let meta = workerMeta;
    if (initialUrl && meta.tabs[0]?.tabId) {
      // Navigate the session's initial tab instead of opening a second one;
      // the panel always drives tabs[0].
      await browserWorkerNavigate(sessionId, meta.tabs[0].tabId, initialUrl);
      meta = await browserWorkerInspect(sessionId);
    }
    await get().initConversation(conversationId, deviceId);
    set((state) => ({
      activeSessionByConversation: {
        ...state.activeSessionByConversation,
        [conversationId]: sessionId,
      },
    }));
    void reportSession(meta);
    // Pull the first live frame so the panel renders the page immediately
    // instead of showing a control-only shell. Failure here is non-fatal.
    if (meta.tabs[0]?.tabId) {
      try {
        await get().observe(conversationId, meta.tabs[0].tabId);
      } catch (error) {
        log.warn('browser', 'initial observe failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return (
      get().sessionsByConversation[conversationId]?.find((s) => s.sessionId === sessionId)
      ?? {
        sessionId,
        conversationId,
        engine: meta.engine,
        status: 'active',
        lease: 'agent',
        tabs: meta.tabs,
        live: true,
      }
    );
  },

  navigate: async (conversationId, tabId, url) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) throw new Error('no active browser session');
    await browserWorkerNavigate(sessionId, tabId, url);
    await get().observe(conversationId, tabId);
    const meta = await browserWorkerInspect(sessionId);
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  history: async (conversationId, tabId, direction) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) throw new Error('no active browser session');
    await browserWorkerHistory(sessionId, tabId, direction);
    await get().observe(conversationId, tabId);
    const meta = await browserWorkerInspect(sessionId);
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  observe: async (conversationId, tabId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return null;
    const snapshot = await browserWorkerSnapshot(sessionId, tabId);
    // Pair the accessibility snapshot with a fresh frame so the in-panel
    // viewport mirrors the real device page after every observation.
    let screenshotView: BrowserScreenshotView | null = null;
    try {
      const shot = await browserWorkerScreenshot(sessionId, tabId);
      screenshotView = {
        dataUrl: `data:${shot.mime};base64,${shot.dataB64}`,
        innerWidth: snapshot.viewport?.innerWidth || 0,
        innerHeight: snapshot.viewport?.innerHeight || 0,
        capturedAt: Date.now(),
      };
    } catch (error) {
      log.warn('browser', 'viewport screenshot failed', {
        sessionId,
        tabId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    set((state) => ({
      snapshotByTab: { ...state.snapshotByTab, [tabId]: snapshot },
      ...(screenshotView
        ? { screenshotByTab: { ...state.screenshotByTab, [tabId]: screenshotView } }
        : {}),
    }));
    return snapshot;
  },

  click: async (conversationId, tabId, ref) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    await browserWorkerClick(sessionId, tabId, ref);
    await get().observe(conversationId, tabId);
    const meta = await browserWorkerInspect(sessionId);
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  fill: async (conversationId, tabId, ref, value) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    await browserWorkerFill(sessionId, tabId, ref, value);
  },

  submit: async (conversationId, tabId, ref) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    await browserWorkerSubmit(sessionId, tabId, ref);
    await get().observe(conversationId, tabId);
    const meta = await browserWorkerInspect(sessionId);
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  closeTab: async (conversationId, tabId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    await browserWorkerCloseTab(sessionId, tabId);
    const meta = await browserWorkerInspect(sessionId);
    set((state) => {
      const nextSnapshots = { ...state.snapshotByTab };
      delete nextSnapshots[tabId];
      const nextScreenshots = { ...state.screenshotByTab };
      delete nextScreenshots[tabId];
      return {
        snapshotByTab: nextSnapshots,
        screenshotByTab: nextScreenshots,
      };
    });
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  screenshot: async (conversationId, tabId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) throw new Error('no active browser session');
    const shot = await browserWorkerScreenshot(sessionId, tabId);
    return `data:${shot.mime};base64,${shot.dataB64}`;
  },

  takeover: async (conversationId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    const meta = await browserWorkerTakeover(sessionId);
    // Takeover relaunches the browser on the same profile; rebuilt tab target
    // ids invalidate every cached frame and observation.
    set({ snapshotByTab: {}, screenshotByTab: {} });
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  release: async (conversationId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    const meta = await browserWorkerRelease(sessionId);
    // Release invalidates every observation; drop cached snapshots so the
    // agent/operator must observe the new generation first.
    set({ snapshotByTab: {}, screenshotByTab: {} });
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  removeSession: async (conversationId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    await browserWorkerRemove(sessionId).catch(() => undefined);
    try {
      await browserStationRemove(sessionId);
    } catch (error) {
      log.warn('browser', 'failed to remove station session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    set(() => ({
      activeSessionByConversation: { ...get().activeSessionByConversation, [conversationId]: '' },
      sessionsByConversation: {
        ...get().sessionsByConversation,
        [conversationId]: (get().sessionsByConversation[conversationId] ?? []).filter(
          (session) => session.sessionId !== sessionId,
        ),
      },
    }));
  },
}));

// Keep device id resolution close to the terminal dock: same account command.
export async function resolveBrowserDeviceId(): Promise<string> {
  const result = (await api.accountGetDeviceId()) as unknown as {
    deviceId?: string;
    device_id?: string;
  };
  return result.deviceId ?? result.device_id ?? '';
}

