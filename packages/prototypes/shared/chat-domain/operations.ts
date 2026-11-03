/**
 * Pure reaction-state operations shared by chat and moments.
 *
 * Canonical state shape:
 *   counts — aggregate count per kind (including non-viewer reactions)
 *   viewer — every kind the local viewer currently holds (multi-select)
 *
 * Toggling adjusts the aggregate by ±1 alongside the viewer set and drops
 * zero-count kinds, so `counts` and `viewer` never disagree.
 */
import type { ReactionKind } from './reactions';

export interface ReactionState {
  readonly counts: Partial<Record<ReactionKind, number>>;
  readonly viewer: readonly ReactionKind[];
}

export function emptyReactionState(): ReactionState {
  return { counts: {}, viewer: [] };
}

export function viewerHas(state: ReactionState, kind: ReactionKind): boolean {
  return state.viewer.includes(kind);
}

export function toggleViewerReaction(state: ReactionState, kind: ReactionKind): ReactionState {
  const counts: Partial<Record<ReactionKind, number>> = { ...state.counts };
  let viewer: ReactionKind[];
  if (state.viewer.includes(kind)) {
    viewer = state.viewer.filter(entry => entry !== kind);
    const next = (counts[kind] ?? 1) - 1;
    if (next <= 0) delete counts[kind];
    else counts[kind] = next;
  } else {
    viewer = [...state.viewer, kind];
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return { counts, viewer };
}

/** Anything that carries the canonical reaction state. */
export interface ReactionBearer {
  reactions?: ReactionState;
}

export function applyViewerReaction<M extends ReactionBearer & { id: string }>(
  messages: readonly M[],
  messageId: string,
  kind: ReactionKind,
): M[] {
  return messages.map(message => (
    message.id === messageId
      ? { ...message, reactions: toggleViewerReaction(message.reactions ?? emptyReactionState(), kind) }
      : message
  ));
}

/** Ordered kinds for chip rendering: viewer-selected first, then catalog order. */
export function orderedKinds(state: ReactionState): ReactionKind[] {
  const present = new Set(
    (Object.entries(state.counts) as [ReactionKind, number][])
      .filter(([, count]) => count > 0)
      .map(([kind]) => kind),
  );
  return [
    ...state.viewer.filter(kind => present.has(kind)),
    ...[...present].filter(kind => !state.viewer.includes(kind)),
  ];
}
