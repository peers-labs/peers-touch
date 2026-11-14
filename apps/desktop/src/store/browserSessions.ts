import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import {
  browserHostInfo,
  browserStationCreate,
  browserStationList,
  browserStationReconcile,
  browserStationRemove,
  browserStationUpdate,
  browserWorkerCloseTab,
  browserWorkerCreate,
  browserWorkerHistory,
  browserWorkerInsertText,
  browserWorkerInspect,
  browserWorkerList,
  browserWorkerNavigate,
  browserWorkerOpenTab,
  browserWorkerRemove,
  browserWorkerScreencastStart,
  browserWorkerScreencastStop,
  browserWorkerSendKey,
  browserWorkerSendMouse,
  browserWorkerSendWheel,
  type BrowserHostInfo,
  type BrowserMouseKind,
  type BrowserSessionMeta,
  type BrowserStationSession,
  type BrowserTabMeta,
} from '../services/desktop_api';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';

// TW-D6: device-held real browser sessions. One headless Chromium per
// session is driven by two planes over CDP: the agent's structured tools
// (Rust side) and the human panel (screencast frames + forwarded input).
// This store only tracks inventory, frames and human navigation.

const STATION_RUNNING = 'BROWSER_SESSION_STATUS_ACTIVE';
const STATION_CLOSED = 'BROWSER_SESSION_STATUS_CLOSED';
const STATION_LEASE_HUMAN = 'BROWSER_CONTROL_LEASE_HUMAN';
const FRAME_EVENT = 'peers-touch://browser-frame-event';

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

export interface BrowserFrameView {
  dataUrl: string;
  width: number;
  height: number;
  at: number;
}

interface FramePayload {
  sessionId: string;
  tabId: string;
  dataB64: string;
  width: number;
  height: number;
}

interface SessionEventPayload {
  sessionId: string;
  kind: 'meta' | 'closed';
  meta?: BrowserSessionMeta;
  status?: string;
}

export interface MouseInput {
  kind: BrowserMouseKind;
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  buttons: number;
  clickCount: number;
}

interface BrowserSessionState {
  host: BrowserHostInfo | null;
  sessionsByConversation: Record<string, BrowserSessionView[]>;
  activeSessionByConversation: Record<string, string>;
  activeTabByConversation: Record<string, string>;
  frameByTab: Record<string, BrowserFrameView>;
  hostChecked: boolean;
  deviceId: string;
  setDeviceId: (deviceId: string) => void;
  probeHost: () => Promise<void>;
  initConversation: (conversationId: string, deviceId: string) => Promise<void>;
  selectSession: (conversationId: string, sessionId: string) => void;
  selectTab: (conversationId: string, tabId: string) => void;
  createSession: (input: {
    conversationId: string;
    turnId?: string;
    initialUrl?: string;
    deviceId: string;
  }) => Promise<BrowserSessionView>;
  openTab: (conversationId: string, url?: string) => Promise<void>;
  closeTab: (conversationId: string, tabId: string) => Promise<void>;
  navigate: (conversationId: string, tabId: string, url: string) => Promise<void>;
  history: (
    conversationId: string,
    tabId: string,
    direction: 'back' | 'forward' | 'reload',
  ) => Promise<void>;
  removeSession: (conversationId: string) => Promise<void>;
  startStream: (sessionId: string, tabId: string, width: number, height: number) => Promise<void>;
  stopStream: (sessionId: string, tabId: string) => Promise<void>;
  sendMouse: (sessionId: string, tabId: string, input: MouseInput) => Promise<void>;
  sendWheel: (
    sessionId: string,
    tabId: string,
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ) => Promise<void>;
  sendKey: (
    sessionId: string,
    tabId: string,
    kind: 'down' | 'up',
    key: string,
    code: string,
    modifiers: number,
  ) => Promise<void>;
  insertText: (sessionId: string, tabId: string, text: string) => Promise<void>;
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

let frameEventBound = false;
function bindFrameEvents(): void {
  if (frameEventBound) return;
  frameEventBound = true;
  void listen<FramePayload>(FRAME_EVENT, (event) => {
    const payload = event.payload;
    if (!payload?.tabId) return;
    useBrowserSessionsStore.setState((state) => ({
      frameByTab: {
        ...state.frameByTab,
        [payload.tabId]: {
          dataUrl: `data:image/jpeg;base64,${payload.dataB64}`,
          width: payload.width,
          height: payload.height,
          at: Date.now(),
        },
      },
    }));
  });
  // Rust emits fresh tab inventory on in-page navigation (screencast location
  // poll) so the tab strip and address bar stay live without a refetch.
  void listen<SessionEventPayload>('peers-touch://browser-session-event', (event) => {
    const payload = event.payload;
    if (!payload?.sessionId) return;
    if (payload.kind === 'meta' && payload.meta) {
      const meta = payload.meta;
      useBrowserSessionsStore.setState((state) => {
        const next: typeof state.sessionsByConversation = {};
        for (const [conversationId, sessions] of Object.entries(state.sessionsByConversation)) {
          let changed = false;
          const views = sessions.map((view) => {
            if (view.sessionId !== meta.sessionId) return view;
            changed = true;
            return {
              ...view,
              status: (meta.status === 'closed'
                ? 'closed'
                : meta.status === 'unknown'
                  ? 'unknown'
                  : 'active') as BrowserSessionView['status'],
              tabs: meta.tabs,
            };
          });
          if (changed) next[conversationId] = views;
          else next[conversationId] = sessions;
        }
        return { sessionsByConversation: next };
      });
    }
  });
}

// Active streams keyed by tab: restarting a stream (resize/tab switch) stops
// the previous supervisor. The viewport is reported in CSS pixels.
const streamSizes = new Map<string, { width: number; height: number }>();

export const useBrowserSessionsStore = create<BrowserSessionState>((set, get) => ({
  host: null,
  sessionsByConversation: {},
  activeSessionByConversation: {},
  activeTabByConversation: {},
  frameByTab: {},
  hostChecked: false,
  deviceId: '',

  setDeviceId: (deviceId) => set({ deviceId }),

  probeHost: async () => {
    bindFrameEvents();
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
    set((state) => {
      const activeSession =
        state.activeSessionByConversation[conversationId]
        ?? views.find((session) => session.status === 'active')?.sessionId
        ?? '';
      const sessionView = views.find((session) => session.sessionId === activeSession) ?? null;
      const activeTab =
        state.activeTabByConversation[conversationId]
        ?? sessionView?.tabs[0]?.tabId
        ?? '';
      return {
        deviceId,
        sessionsByConversation: { ...state.sessionsByConversation, [conversationId]: views },
        activeSessionByConversation: {
          ...state.activeSessionByConversation,
          [conversationId]: activeSession,
        },
        activeTabByConversation: {
          ...state.activeTabByConversation,
          [conversationId]: activeTab,
        },
      };
    });
  },

  selectSession: (conversationId, sessionId) => {
    set((state) => ({
      activeSessionByConversation: {
        ...state.activeSessionByConversation,
        [conversationId]: sessionId,
      },
    }));
  },

  selectTab: (conversationId, tabId) => {
    set((state) => ({
      activeTabByConversation: {
        ...state.activeTabByConversation,
        [conversationId]: tabId,
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
      await browserWorkerNavigate(sessionId, meta.tabs[0].tabId, initialUrl);
      meta = await browserWorkerInspect(sessionId);
    }
    await get().initConversation(conversationId, deviceId);
    // Station list can lag right after create; the worker inventory is the
    // authority for existence, so make sure the new live session is present.
    set((state) => {
      const views = state.sessionsByConversation[conversationId] ?? [];
      const merged = views.some((view) => view.sessionId === sessionId)
        ? views
        : [
            ...views,
            {
              sessionId,
              conversationId,
              engine: meta.engine,
              status: 'active' as const,
              lease: (meta.lease as BrowserSessionView['lease']) ?? 'agent',
              tabs: meta.tabs,
              live: true,
            },
          ];
      return {
        sessionsByConversation: { ...state.sessionsByConversation, [conversationId]: merged },
        activeSessionByConversation: {
          ...state.activeSessionByConversation,
          [conversationId]: sessionId,
        },
        activeTabByConversation: {
          ...state.activeTabByConversation,
          [conversationId]: meta.tabs[0]?.tabId ?? '',
        },
      };
    });
    void reportSession(meta);
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

  openTab: async (conversationId, url = 'about:blank') => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) throw new Error('no active browser session');
    const tab = await browserWorkerOpenTab(sessionId, url);
    const meta = await browserWorkerInspect(sessionId);
    await get().initConversation(conversationId, get().deviceId);
    get().selectTab(conversationId, tab.tabId);
    void reportSession(meta);
  },

  closeTab: async (conversationId, tabId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    await get().stopStream(sessionId, tabId).catch(() => undefined);
    await browserWorkerCloseTab(sessionId, tabId);
    const meta = await browserWorkerInspect(sessionId);
    set((state) => {
      const nextFrames = { ...state.frameByTab };
      delete nextFrames[tabId];
      const remaining = meta.tabs.map((tab) => tab.tabId);
      const nextActive =
        state.activeTabByConversation[conversationId] === tabId
          ? remaining[0] ?? ''
          : state.activeTabByConversation[conversationId];
      return { frameByTab: nextFrames,
        activeTabByConversation: {
          ...state.activeTabByConversation,
          [conversationId]: nextActive,
        } };
    });
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  navigate: async (conversationId, tabId, url) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) throw new Error('no active browser session');
    await browserWorkerNavigate(sessionId, tabId, url);
    const meta = await browserWorkerInspect(sessionId);
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  history: async (conversationId, tabId, direction) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) throw new Error('no active browser session');
    await browserWorkerHistory(sessionId, tabId, direction);
    const meta = await browserWorkerInspect(sessionId);
    await get().initConversation(conversationId, get().deviceId);
    void reportSession(meta);
  },

  removeSession: async (conversationId) => {
    const sessionId = get().activeSessionByConversation[conversationId];
    if (!sessionId) return;
    for (const key of streamSizes.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        const [, tabId] = key.split(':');
        streamSizes.delete(key);
        await browserWorkerScreencastStop(sessionId, tabId).catch(() => undefined);
      }
    }
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
      activeTabByConversation: { ...get().activeTabByConversation, [conversationId]: '' },
      sessionsByConversation: {
        ...get().sessionsByConversation,
        [conversationId]: (get().sessionsByConversation[conversationId] ?? []).filter(
          (session) => session.sessionId !== sessionId,
        ),
      },
    }));
  },

  startStream: async (sessionId, tabId, width, height) => {
    const size = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
    const key = `${sessionId}:${tabId}`;
    const previous = streamSizes.get(key);
    if (previous && previous.width === size.width && previous.height === size.height) return;
    streamSizes.set(key, size);
    await browserWorkerScreencastStart(sessionId, tabId, size.width, size.height);
  },

  stopStream: async (sessionId, tabId) => {
    streamSizes.delete(`${sessionId}:${tabId}`);
    await browserWorkerScreencastStop(sessionId, tabId);
  },

  sendMouse: async (sessionId, tabId, input) => {
    await browserWorkerSendMouse({ sessionId, tabId, ...input });
  },

  sendWheel: async (sessionId, tabId, x, y, deltaX, deltaY) => {
    await browserWorkerSendWheel({ sessionId, tabId, x, y, deltaX, deltaY });
  },

  sendKey: async (sessionId, tabId, kind, key, code, modifiers) => {
    await browserWorkerSendKey({ sessionId, tabId, kind, key, code, modifiers });
  },

  insertText: async (sessionId, tabId, text) => {
    await browserWorkerInsertText(sessionId, tabId, text);
  },
}));

// Keep device id resolution close to the browser dock: same account command.
export async function resolveBrowserDeviceId(): Promise<string> {
  const result = (await api.accountGetDeviceId()) as unknown as {
    deviceId?: string;
    device_id?: string;
  };
  return result.deviceId ?? result.device_id ?? '';
}
