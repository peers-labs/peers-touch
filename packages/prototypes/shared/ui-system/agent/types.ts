/**
 * Agent prototype view models (frontend-eles · desktop · agent).
 *
 * These are prototype-local shapes seeded in agent-data.ts. They mirror the
 * production domain vocabulary (Agent roster → Topic → Turn → workbench)
 * without importing any runtime store: the prototype trains peers-ui
 * composition, not the Station wire.
 */

export type AgentStatus = 'active' | 'disabled';
export type AvatarMode = 'initial' | 'emoji' | 'image';

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  avatarMode: AvatarMode;
  avatarValue: string;
  status: AgentStatus;
  defaultModel: string;
  topicCount: number;
  pinned?: boolean;
  /** Production keeps the built-in assistant undeletable. */
  systemOwned?: boolean;
}

export interface TopicRecord {
  id: string;
  agentId: string;
  title: string;
  pinned?: boolean;
  /** ISO timestamp; date groups derive from this, never from a label. */
  updatedAt: string;
  messageCount: number;
  draft: string;
}

/** Right work-area tools, identical id set to the production workbench. */
export type WorkbenchToolId =
  | 'summary'
  | 'file'
  | 'browser'
  | 'terminal'
  | 'memory'
  | 'branches';

export type AgentSurface = 'chat' | 'profile';

export interface AgentNavigationRequest {
  nonce: number;
  kind: 'agent' | 'topic' | 'profile';
  agentId?: string;
  topicId?: string;
}

/** Mirrors deriveAgentWorkbenchLayout breakpoints (900 / 560). */
export const NARROW_WIDTH = 900;
export const ULTRA_NARROW_WIDTH = 560;

export type RailState = 'expanded' | 'collapsed' | 'hidden';

export interface WorkbenchLayout {
  narrow: boolean;
  ultraNarrow: boolean;
  agentRail: RailState;
  topicRail: RailState;
  workbenchVisible: boolean;
}
