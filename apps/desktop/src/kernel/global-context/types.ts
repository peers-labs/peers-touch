export type RuntimeAppState = 'booting' | 'ready' | 'degraded' | 'shutdown'
export type PipelineName =
  | 'bootstrap'
  | 'session_login'
  | 'session_logout'
  | 'identity_switch'
  | 'network_recovery'
  | 'capability_refresh'

// TODO(unified-actor): align projection fields with AccountIdentity / actor model (see desktop_api.AccountIdentity).
export interface IdentitySlice {
  userId: string | null
  displayName: string | null
  provider: string | null
  email: string | null
  avatarUrl: string | null
  profileUrl: string | null
  registerTime: string | null
  lastLoginAt: string | null
}

export interface SessionSlice {
  loginStatus: 'unknown' | 'authenticated' | 'unauthenticated'
  authenticated: boolean
  activeAccountId: string | null
  lastAuthAt: string | null
}

export interface OAuthAccountSnapshot {
  id: string
  provider: string
  name: string
  email: string
  connectedAt: string
}

export interface OAuthSlice {
  connectedAccounts: OAuthAccountSnapshot[]
  connectedCount: number
}

export interface RuntimeSlice {
  appState: RuntimeAppState
  online: boolean
  networkMode: 'online' | 'offline'
}

export interface NetworkSlice {
  online: boolean
  mode: 'online' | 'offline'
  degraded: boolean
  lastChangedAt: number
}

export interface CapabilitySlice {
  oauth: boolean
  chat: boolean
  groupChat: boolean
  timeline: boolean
  settings: boolean
}

export interface WorkspaceSlice {
  id: string | null
  name: string | null
  environment: string | null
}

export interface TaskStateItem {
  key: string
  status: 'idle' | 'running' | 'failed' | 'completed'
  updatedAt: number
}

export interface TaskSlice {
  items: Record<string, TaskStateItem>
}

export interface NotificationItem {
  id: string
  level: 'info' | 'warning' | 'error'
  title: string
  createdAt: number
}

export interface NotificationSlice {
  items: NotificationItem[]
}

export interface MetaSlice {
  version: number
  updatedAt: number
}

export interface GlobalContextSnapshot {
  identity: IdentitySlice
  session: SessionSlice
  oauth: OAuthSlice
  runtime: RuntimeSlice
  network: NetworkSlice
  capability: CapabilitySlice
  workspace: WorkspaceSlice
  task: TaskSlice
  notification: NotificationSlice
  meta: MetaSlice
}

export interface PipelinePayload {
  identitySwitch?: { accountId: string }
}
