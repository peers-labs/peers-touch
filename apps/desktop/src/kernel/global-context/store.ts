import { create } from 'zustand'
import { EVENT, eventBus, onWindowOffline, onWindowOnline } from '../events'
import { useSessionStore } from '../../store/session'
import { useOAuth2Store } from '../../store/oauth2'
import { api } from '../../services/desktop_api'
import type {
  GlobalContextSnapshot,
  NotificationItem,
  PipelineName,
  PipelinePayload,
  RuntimeAppState,
} from './types'

interface GlobalContextState {
  snapshot: GlobalContextSnapshot
  runtimeUnsubscribe: (() => void) | null
  getSnapshot: () => GlobalContextSnapshot
  setRuntimeAppState: (state: RuntimeAppState) => void
  setWorkspace: (input: { id?: string | null; name?: string | null; environment?: string | null }) => void
  setTaskStatus: (key: string, status: 'idle' | 'running' | 'failed' | 'completed') => void
  pushNotification: (item: Omit<NotificationItem, 'createdAt'>) => void
  refreshFromSources: () => Promise<void>
  startRuntimeBindings: () => void
  runPipeline: (name: PipelineName, payload?: PipelinePayload) => Promise<void>
  /** Clear identity/session/oauth slices (identity pipeline). Preserves runtime/network/workspace chrome. */
  reset: () => void
  hydrate: (actorId: string) => Promise<void>
}

function now() {
  return Date.now()
}

function createInitialSnapshot(): GlobalContextSnapshot {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  const nowTs = now()
  return {
    identity: {
      userId: null,
      displayName: null,
      provider: null,
      email: null,
      avatarUrl: null,
      profileUrl: null,
      registerTime: null,
      lastLoginAt: null,
    },
    session: {
      loginStatus: 'unknown',
      authenticated: false,
      activeAccountId: null,
      lastAuthAt: null,
    },
    oauth: {
      connectedAccounts: [],
      connectedCount: 0,
    },
    runtime: {
      appState: 'booting',
      online,
      networkMode: online ? 'online' : 'offline',
    },
    network: {
      online,
      mode: online ? 'online' : 'offline',
      degraded: !online,
      lastChangedAt: nowTs,
    },
    capability: {
      oauth: false,
      chat: true,
      groupChat: true,
      timeline: true,
      settings: true,
    },
    workspace: {
      id: null,
      name: null,
      environment: null,
    },
    task: {
      items: {},
    },
    notification: {
      items: [],
    },
    meta: {
      version: 1,
      updatedAt: nowTs,
    },
  }
}

function mapSnapshotFromStores(snapshot: GlobalContextSnapshot): GlobalContextSnapshot {
  const sessionState = useSessionStore.getState()
  const oauthState = useOAuth2Store.getState()

  // Identity: SessionStore is the SOLE source of truth.
  // No fallback to AccountIdentityStore — one session = one user.
  const cu = sessionState.currentUser
  const identity = cu
    ? {
        userId: cu.actorId,
        displayName: cu.name || null,
        provider: cu.loginProvider || null,
        email: cu.email || null,
        avatarUrl: cu.avatarUrl || null,
        profileUrl: null,
        registerTime: null,
        lastLoginAt: null,
      }
    : {
        userId: null,
        displayName: null,
        provider: null,
        email: null,
        avatarUrl: null,
        profileUrl: null,
        registerTime: null,
        lastLoginAt: null,
      }

  const connectedAccounts = oauthState.connections
    .filter((item) => item.status === 'active')
    .map((item) => ({
      id: item.provider_id,
      provider: item.provider_name || item.provider_id,
      name: item.user_name || item.user_id || item.provider_id,
      email: item.email || '',
      connectedAt: item.connected_at || '',
    }))

  return {
    ...snapshot,
    identity,
    session: {
      loginStatus: sessionState.authenticated ? 'authenticated' : 'unauthenticated',
      authenticated: sessionState.authenticated,
      activeAccountId: cu?.actorId || null,
      lastAuthAt: null,
    },
    oauth: {
      connectedAccounts,
      connectedCount: connectedAccounts.length,
    },
    capability: {
      ...snapshot.capability,
      oauth: connectedAccounts.length > 0,
    },
    workspace: {
      ...snapshot.workspace,
    },
    task: {
      ...snapshot.task,
    },
    notification: {
      ...snapshot.notification,
    },
    meta: {
      ...snapshot.meta,
      updatedAt: now(),
    },
  }
}

function mapSnapshotFromRust(
  snapshot: GlobalContextSnapshot,
  input: Record<string, unknown>,
): GlobalContextSnapshot {
  const next = input as Partial<GlobalContextSnapshot>
  return {
    ...snapshot,
    identity: {
      ...snapshot.identity,
      ...(next.identity || {}),
    },
    session: {
      ...snapshot.session,
      ...(next.session || {}),
    },
    oauth: {
      ...snapshot.oauth,
      ...(next.oauth || {}),
    },
    runtime: {
      ...snapshot.runtime,
      ...(next.runtime || {}),
    },
    network: {
      ...snapshot.network,
      ...(next.network || {}),
    },
    capability: {
      ...snapshot.capability,
      ...(next.capability || {}),
    },
    workspace: {
      ...snapshot.workspace,
      ...(next.workspace || {}),
    },
    task: {
      ...snapshot.task,
      ...(next.task || {}),
    },
    notification: {
      ...snapshot.notification,
      ...(next.notification || {}),
    },
    meta: {
      ...snapshot.meta,
      ...(next.meta || {}),
      updatedAt: now(),
    },
  }
}

function publishUpdate(slice: string) {
  eventBus.publish(EVENT.GLOBAL_CONTEXT_UPDATED, {
    slice,
    timestamp_ms: now(),
  })
}

export const useGlobalContextStore = create<GlobalContextState>((set, get) => ({
  snapshot: createInitialSnapshot(),
  runtimeUnsubscribe: null,

  getSnapshot: () => get().snapshot,

  setRuntimeAppState: (state) => {
    api.contextActionDispatch({
      action: 'set_runtime_state',
      payload: { appState: state },
    }).catch(() => {})
    set((prev) => ({
      snapshot: {
        ...prev.snapshot,
        runtime: {
          ...prev.snapshot.runtime,
          appState: state,
        },
        meta: {
          ...prev.snapshot.meta,
          updatedAt: now(),
        },
      },
    }))
    publishUpdate('runtime')
  },

  setWorkspace: (input) => {
    set((prev) => ({
      snapshot: {
        ...prev.snapshot,
        workspace: {
          id: input.id ?? prev.snapshot.workspace.id,
          name: input.name ?? prev.snapshot.workspace.name,
          environment: input.environment ?? prev.snapshot.workspace.environment,
        },
        meta: {
          ...prev.snapshot.meta,
          updatedAt: now(),
        },
      },
    }))
    publishUpdate('workspace')
  },

  setTaskStatus: (key, status) => {
    set((prev) => ({
      snapshot: {
        ...prev.snapshot,
        task: {
          items: {
            ...prev.snapshot.task.items,
            [key]: {
              key,
              status,
              updatedAt: now(),
            },
          },
        },
        meta: {
          ...prev.snapshot.meta,
          updatedAt: now(),
        },
      },
    }))
    publishUpdate('task')
  },

  pushNotification: (item) => {
    set((prev) => ({
      snapshot: {
        ...prev.snapshot,
        notification: {
          items: [{ ...item, createdAt: now() }, ...prev.snapshot.notification.items].slice(0, 200),
        },
        meta: {
          ...prev.snapshot.meta,
          updatedAt: now(),
        },
      },
    }))
    publishUpdate('notification')
  },

  refreshFromSources: async () => {
    try {
      const rustSnapshot = await api.contextSnapshotGet()
      set((prev) => ({
        snapshot: mapSnapshotFromRust(prev.snapshot, rustSnapshot),
      }))
      publishUpdate('authoritative')
    } catch {}
    await Promise.all([
      useOAuth2Store.getState().loadAll(),
    ])
    set((prev) => ({
      snapshot: mapSnapshotFromStores(prev.snapshot),
    }))
    publishUpdate('identity/session/oauth')
  },

  startRuntimeBindings: () => {
    if (get().runtimeUnsubscribe) return
    const offOnline = onWindowOnline(() => {
      api.contextActionDispatch({
        action: 'set_network_mode',
        payload: { online: true },
      }).catch(() => {})
      set((prev) => ({
        snapshot: {
          ...prev.snapshot,
          runtime: {
            ...prev.snapshot.runtime,
            online: true,
            networkMode: 'online',
          },
          network: {
            ...prev.snapshot.network,
            online: true,
            mode: 'online',
            degraded: false,
            lastChangedAt: now(),
          },
          meta: {
            ...prev.snapshot.meta,
            updatedAt: now(),
          },
        },
      }))
      publishUpdate('runtime')
    })
    const offOffline = onWindowOffline(() => {
      api.contextActionDispatch({
        action: 'set_network_mode',
        payload: { online: false },
      }).catch(() => {})
      set((prev) => ({
        snapshot: {
          ...prev.snapshot,
          runtime: {
            ...prev.snapshot.runtime,
            online: false,
            networkMode: 'offline',
          },
          network: {
            ...prev.snapshot.network,
            online: false,
            mode: 'offline',
            degraded: true,
            lastChangedAt: now(),
          },
          meta: {
            ...prev.snapshot.meta,
            updatedAt: now(),
          },
        },
      }))
      publishUpdate('runtime')
    })
    set({
      runtimeUnsubscribe: () => {
        offOnline()
        offOffline()
      },
    })
  },

  reset: () => {
    set((prev) => ({
      snapshot: {
        ...createInitialSnapshot(),
        runtime: prev.snapshot.runtime,
        network: prev.snapshot.network,
        workspace: prev.snapshot.workspace,
        task: prev.snapshot.task,
        notification: prev.snapshot.notification,
      },
    }))
    publishUpdate('identity/session')
  },

  hydrate: async (_actorId: string) => {
    await get().refreshFromSources()
  },

  runPipeline: async (name, _payload) => {
    eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED, {
      name,
      timestamp_ms: now(),
    })
    try {
      if (name === 'bootstrap') {
        get().setTaskStatus('global_context.bootstrap', 'running')
        get().setRuntimeAppState('booting')
        await get().refreshFromSources()
        get().startRuntimeBindings()
        get().setRuntimeAppState('ready')
        get().setTaskStatus('global_context.bootstrap', 'completed')
      } else if (name === 'session_login') {
        get().setTaskStatus('global_context.session_login', 'running')
        await get().refreshFromSources()
        get().setTaskStatus('global_context.session_login', 'completed')
      } else if (name === 'session_logout') {
        get().setTaskStatus('global_context.session_logout', 'running')
        set((prev) => ({
          snapshot: {
            ...createInitialSnapshot(),
            runtime: prev.snapshot.runtime,
            network: prev.snapshot.network,
            workspace: prev.snapshot.workspace,
            task: prev.snapshot.task,
            notification: prev.snapshot.notification,
            meta: {
              ...prev.snapshot.meta,
              updatedAt: now(),
            },
          },
        }))
        publishUpdate('identity/session/oauth')
        get().setTaskStatus('global_context.session_logout', 'completed')
      } else if (name === 'network_recovery') {
        get().setTaskStatus('global_context.network_recovery', 'running')
        set((prev) => ({
          snapshot: {
            ...prev.snapshot,
            runtime: {
              ...prev.snapshot.runtime,
              appState: prev.snapshot.network.online ? 'ready' : 'degraded',
            },
            network: {
              ...prev.snapshot.network,
              degraded: !prev.snapshot.network.online,
              lastChangedAt: now(),
            },
            meta: {
              ...prev.snapshot.meta,
              updatedAt: now(),
            },
          },
        }))
        publishUpdate('runtime')
        get().setTaskStatus('global_context.network_recovery', 'completed')
      } else if (name === 'capability_refresh') {
        get().setTaskStatus('global_context.capability_refresh', 'running')
        await get().refreshFromSources()
        get().setTaskStatus('global_context.capability_refresh', 'completed')
      }
      eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED, {
        name,
        timestamp_ms: now(),
      })
    } catch (error: any) {
      get().setTaskStatus(`global_context.${name}`, 'failed')
      get().pushNotification({
        id: `global_context.pipeline_failed.${name}.${now()}`,
        level: 'error',
        title: `Pipeline failed: ${name}`,
      })
      eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED, {
        name,
        error: error?.message || 'pipeline_failed',
        timestamp_ms: now(),
      })
      throw error
    }
  },
}))
