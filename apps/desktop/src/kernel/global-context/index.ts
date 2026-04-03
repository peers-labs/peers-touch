import { useGlobalContextStore } from './store'
import type { GlobalContextSnapshot, NotificationItem, PipelineName, PipelinePayload, RuntimeAppState } from './types'
import { api } from '../../services/desktop_api'

export type { GlobalContextSnapshot, PipelineName, RuntimeAppState } from './types'

export const globalContext = {
  getSnapshot(): GlobalContextSnapshot {
    return useGlobalContextStore.getState().getSnapshot()
  },

  subscribe(listener: (snapshot: GlobalContextSnapshot) => void) {
    return useGlobalContextStore.subscribe((state) => listener(state.snapshot))
  },

  subscribeSlice<TKey extends keyof GlobalContextSnapshot>(
    key: TKey,
    listener: (slice: GlobalContextSnapshot[TKey]) => void,
  ) {
    return useGlobalContextStore.subscribe((state) => listener(state.snapshot[key]))
  },

  setRuntimeAppState(state: RuntimeAppState) {
    useGlobalContextStore.getState().setRuntimeAppState(state)
  },

  setWorkspace(input: { id?: string | null; name?: string | null; environment?: string | null }) {
    useGlobalContextStore.getState().setWorkspace(input)
  },

  setTaskStatus(key: string, status: 'idle' | 'running' | 'failed' | 'completed') {
    useGlobalContextStore.getState().setTaskStatus(key, status)
  },

  pushNotification(item: Omit<NotificationItem, 'createdAt'>) {
    useGlobalContextStore.getState().pushNotification(item)
  },

  refreshFromSources() {
    return useGlobalContextStore.getState().refreshFromSources()
  },

  capabilities() {
    return api.contextCapabilities()
  },

  health() {
    return api.contextHealth()
  },

  runPipeline(name: PipelineName, payload?: PipelinePayload) {
    return useGlobalContextStore.getState().runPipeline(name, payload)
  },

  bootstrap() {
    return useGlobalContextStore.getState().runPipeline('bootstrap')
  },
}
