/**
 * Topological sort with cycle detection for runtime bootstrap ordering.
 *
 * Given a set of MobileRuntimeDescriptors, produces a linear ordering that
 * respects `dependsOn` edges. Teardown order is the reverse of bootstrap order.
 */

import type { MobileRuntimeDescriptor } from './types';

export interface TopologicalSortResult {
  /** Runtime IDs in bootstrap order (dependencies first). */
  readonly order: readonly string[];
  /** True if the graph contains a cycle — `order` will be empty. */
  readonly hasCycle: boolean;
  /** IDs involved in the cycle, if any. Empty when no cycle. */
  readonly cycleParticipants: readonly string[];
}

type VisitState = 'unvisited' | 'visiting' | 'visited';

/**
 * Produce a topological ordering of runtimes based on their `dependsOn` edges.
 *
 * Uses Kahn-style DFS with three-color marking for cycle detection.
 * Unknown dependency IDs (referencing a runtime not in the input set) are
 * silently skipped — this allows optional runtimes.
 */
export function topologicalSortRuntimes(
  descriptors: readonly MobileRuntimeDescriptor[],
): TopologicalSortResult {
  const idSet = new Set(descriptors.map((d) => d.id));
  const adjacency = new Map<string, readonly string[]>();

  for (const descriptor of descriptors) {
    // Filter to only known runtime IDs to tolerate optional dependencies
    const validDeps = descriptor.dependsOn.filter((dep) => idSet.has(dep));
    adjacency.set(descriptor.id, validDeps);
  }

  const state = new Map<string, VisitState>();
  const order: string[] = [];
  const cycleParticipants: string[] = [];

  for (const id of idSet) {
    state.set(id, 'unvisited');
  }

  for (const id of idSet) {
    if (state.get(id) === 'unvisited') {
      if (!dfsVisit(id, adjacency, state, order, cycleParticipants)) {
        return {
          order: [],
          hasCycle: true,
          cycleParticipants: [...new Set(cycleParticipants)],
        };
      }
    }
  }

  return {
    order,
    hasCycle: false,
    cycleParticipants: [],
  };
}

/**
 * Return the reverse of a topological order (for teardown / suspend).
 */
export function reverseTeardownOrder(bootstrapOrder: readonly string[]): readonly string[] {
  return [...bootstrapOrder].reverse();
}

// --- Internal DFS ---

function dfsVisit(
  id: string,
  adjacency: Map<string, readonly string[]>,
  visited: Map<string, VisitState>,
  order: string[],
  cycleParticipants: string[],
): boolean {
  visited.set(id, 'visiting');

  const deps = adjacency.get(id) ?? [];
  for (const dep of deps) {
    const depState = visited.get(dep);
    if (depState === 'visiting') {
      // Cycle detected
      cycleParticipants.push(id, dep);
      return false;
    }
    if (depState === 'unvisited') {
      if (!dfsVisit(dep, adjacency, visited, order, cycleParticipants)) {
        cycleParticipants.push(id);
        return false;
      }
    }
  }

  visited.set(id, 'visited');
  order.push(id);
  return true;
}
