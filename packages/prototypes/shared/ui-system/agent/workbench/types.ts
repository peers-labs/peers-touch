/**
 * Workbench view models for the Agent prototype (frontend-eles · desktop).
 *
 * The vocabulary mirrors the production right work area
 * (store/workbenchTabs + agent/workbench/* docks) but stays local and
 * deterministic: the prototype trains peers-ui composition, not Station or
 * device wiring. No capability that production does not own is invented here.
 */
import type { IconId } from '@peers-touch/ui-assets';
import type { StringKey } from '../../prefs';
import type { WorkbenchToolId } from '../types';
import type { ConversationMessage, TerminalLineView } from '../conversation/types';

export interface WorkbenchToolMeta {
  id: WorkbenchToolId;
  iconId: IconId;
  labelKey: StringKey;
  descKey: StringKey;
}

/* ---- summary dock ---------------------------------------------------- */

export interface SummaryProjection {
  title: string;
  agentName: string;
  model: string;
  elapsedLabel: string | null;
  turns: number;
  replies: number;
  toolCalls: number;
  toolErrors: number;
  pendingApprovals: number;
  queuedTurns: number;
}

/* ---- file dock ------------------------------------------------------- */

/** Git short status codes rendered by the production workspace FS store. */
export type GitStatusCode = '??' | 'M' | 'A' | 'D' | 'R' | 'C' | '';

export interface FileNode {
  path: string;
  name: string;
  isDir: boolean;
  status?: GitStatusCode;
  children?: FileNode[];
}

export interface FileChange {
  path: string;
  status: Exclude<GitStatusCode, ''>;
}

export interface OpenedFile {
  path: string;
  name: string;
  binary?: boolean;
  content: string;
  diffBefore?: string;
  diffAfter?: string;
}

/* ---- browser dock ---------------------------------------------------- */

export interface BrowserTabSeed {
  tabId: string;
  title: string;
  url: string;
  /** In-memory navigation history; back/forward walk this list. */
  history: string[];
  historyIndex: number;
}

export interface BrowserSessionSeed {
  sessionId: string;
  tabs: BrowserTabSeed[];
  activeTabId: string;
}

/* ---- terminal dock --------------------------------------------------- */

export type TerminalSessionStatus = 'running' | 'exited' | 'killed';

export interface TerminalSessionSeed {
  sessionId: string;
  command: string;
  cwd: string;
  placement: 'desktop' | 'remote';
  status: TerminalSessionStatus;
  exitCode?: number;
  lines: TerminalLineView[];
}

/* ---- memory dock ----------------------------------------------------- */

export interface MemoryCandidate {
  memoryId: string;
  layer: string;
  content: string;
}

/* ---- branches dock --------------------------------------------------- */

export type BranchKind = 'origin' | 'alternate';

export interface BranchRowSeed {
  id: string;
  kind: BranchKind;
  /** ISO timestamp; the dock renders a localized short form, never a raw label. */
  at: string;
  snippet: string;
}

/** Project the seeded conversation into the same task facts production derives. */
export function projectSummary(
  messages: readonly ConversationMessage[],
  title: string,
  agentName: string,
): SummaryProjection | null {
  if (messages.length === 0) return null;

  let turns = 0;
  let replies = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let pendingApprovals = 0;
  let queuedTurns = 0;
  const models = new Set<string>();
  let firstAt = 0;
  let lastAt = 0;

  for (const message of messages) {
    const ts = parseTimestamp(message.timestamp);
    if (ts !== null) {
      if (!firstAt || ts < firstAt) firstAt = ts;
      if (ts > lastAt) lastAt = ts;
    }
    if (message.role === 'user') turns += 1;
    if (message.role === 'assistant' && message.status === 'completed') replies += 1;
    if (message.status === 'queued') queuedTurns += 1;
    if (message.model) models.add(message.model);
    for (const call of message.tools ?? []) {
      toolCalls += 1;
      if (call.status === 'failed' || call.status === 'cancelled') toolErrors += 1;
      if (call.status === 'approval_required') pendingApprovals += 1;
    }
  }

  return {
    title,
    agentName,
    model: models.size === 1 ? [...models][0] : '',
    elapsedLabel: firstAt && lastAt ? formatElapsed(lastAt - firstAt) : null,
    turns,
    replies,
    toolCalls,
    toolErrors,
    pendingApprovals,
    queuedTurns,
  };
}

/**
 * Resolve a seed timestamp to comparable millis. Production messages carry
 * numeric/ISO timestamps; the prototype seed uses same-day `HH:mm` clock
 * labels, so both forms are reduced to a minute-granularity numeric span.
 */
function parseTimestamp(value: string): number | null {
  const iso = Date.parse(value);
  if (Number.isFinite(iso)) return iso;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!clock) return null;
  return (Number(clock[1]) * 60 + Number(clock[2])) * 60_000;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.round(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
