// PERFORMANCE ONLY. This file is not a product Acceptance Gate.
import { test, expect } from '../fixtures';
import {
  runtimePreflight,
  SCENARIO_SAMPLERS,
  type PerformanceRuntime,
} from '../performanceHarness';

const EXPECTED_RUNTIME = (
  process.env.PT_PERFORMANCE_RUNTIME ?? 'tauri-webview-dev'
) as PerformanceRuntime;
const EXPECTED_ACTOR = process.env.PT_PERFORMANCE_ACTOR_PTID ?? '';

test.describe('P0c3 unified performance harness', () => {
  test('runs every interaction-linked scenario against one runtime adapter', async ({ tauriPage }) => {
    expect(EXPECTED_ACTOR).not.toBe('');
    const preflight = await runtimePreflight(
      tauriPage,
      EXPECTED_RUNTIME,
      EXPECTED_ACTOR,
    );
    expect(preflight.runtime).toBe(EXPECTED_RUNTIME);
    expect(preflight.actualActorPtid).toBe(EXPECTED_ACTOR);

    for (const [scenario, sample] of Object.entries(SCENARIO_SAMPLERS)) {
      const result = await sample(tauriPage);
      expect(result.scenario).toBe(scenario);
      expect(result.interactionId).not.toBe('');
      expect(result.events.length).toBeGreaterThan(1);
      expect(result.events.every((event) => event.runtime === EXPECTED_RUNTIME)).toBe(true);
    }
  });
});
