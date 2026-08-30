// PERFORMANCE ONLY. This file is not a product Acceptance Gate.
import { test, expect } from '../fixtures';
import {
  runtimePreflight,
  SCENARIO_SAMPLERS,
  warmAllSecondaryTabs,
  type PerformanceRuntime,
  type PerformanceScenario,
  type ScenarioSample,
} from '../performanceHarness';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const COHORT_PATH = path.resolve(
  THIS_DIR,
  '../../../../tooling/acceptance/desktop-performance-cohort.json',
);
const OUTPUT_DIR = path.resolve(
  THIS_DIR,
  '../../../../tooling/acceptance/reports/desktop-performance-cells',
);

interface CohortManifest {
  cohortId: string;
  expectedActorPtid: string;
  warmupRuns: number;
  postWarmupSamplesPerScenario: number;
  runtimes: PerformanceRuntime[];
  scenarios: PerformanceScenario[];
  buildRevision: string;
  profile: string;
  station: string;
  dataRevision: string;
  window: { width: number; height: number };
}

interface SampleTiming {
  interactionId: string;
  scenario: PerformanceScenario;
  durationMs: number | undefined;
  eventCount: number;
  eventKinds: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(timings: number[]): {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
} {
  const sorted = [...timings].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    count: sorted.length,
  };
}

function extractDuration(sample: ScenarioSample): number | undefined {
  const visibleEvent = sample.events.find(
    (e) =>
      e.kind === 'input.visible' ||
      e.kind === 'route.visible' ||
      e.kind === 'overlay.visible',
  );
  return visibleEvent?.durationMs;
}

const EXPECTED_RUNTIME = (process.env.PT_PERFORMANCE_RUNTIME ?? 'tauri-webview-dev') as PerformanceRuntime;

test.describe('P0c3 evidence collection', () => {
  test(`collect N≥30 samples for ${EXPECTED_RUNTIME}`, async ({ tauriPage }) => {
    test.setTimeout(300_000);

    const cohort: CohortManifest = JSON.parse(
      fs.readFileSync(COHORT_PATH, 'utf-8'),
    );
    expect(cohort.runtimes).toContain(EXPECTED_RUNTIME);

    const preflight = await runtimePreflight(
      tauriPage,
      EXPECTED_RUNTIME,
      cohort.expectedActorPtid,
    );
    expect(preflight.runtime).toBe(EXPECTED_RUNTIME);

    const allSamples: Record<PerformanceScenario, SampleTiming[]> = {
      'text-input': [],
      'primary-nav': [],
      'secondary-tab': [],
      overlay: [],
    };

    const scenarios = cohort.scenarios as PerformanceScenario[];
    const warmup = cohort.warmupRuns;
    const target = cohort.postWarmupSamplesPerScenario;

    await warmAllSecondaryTabs(tauriPage);

    for (const scenario of scenarios) {
      const sampler = SCENARIO_SAMPLERS[scenario];

      for (let i = 0; i < warmup; i++) {
        await sampler(tauriPage);
        await new Promise((r) => setTimeout(r, 100));
      }

      for (let i = 0; i < target; i++) {
        const sample = await sampler(tauriPage);
        const duration = extractDuration(sample);
        allSamples[scenario].push({
          interactionId: sample.interactionId,
          scenario,
          durationMs: duration,
          eventCount: sample.events.length,
          eventKinds: [...new Set(sample.events.map((e) => e.kind))],
        });
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    const stats: Record<string, ReturnType<typeof computeStats>> = {};
    for (const scenario of scenarios) {
      const durations = allSamples[scenario]
        .map((s) => s.durationMs)
        .filter((d): d is number => d !== undefined);
      stats[scenario] = computeStats(durations);
    }

    const artifact = {
      schemaVersion: 1,
      artifactKind: 'desktop-performance-cell-evidence',
      phase: 'P0c-3',
      cellId: EXPECTED_RUNTIME,
      cohortId: cohort.cohortId,
      collectedAt: new Date().toISOString(),
      runtime: EXPECTED_RUNTIME,
      profile: cohort.profile,
      actualActorPtid: preflight.actualActorPtid,
      station: cohort.station,
      buildRevision: cohort.buildRevision,
      warmupRuns: warmup,
      samplesPerScenario: target,
      stats,
      samples: allSamples,
    };

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(OUTPUT_DIR, `${EXPECTED_RUNTIME}-evidence.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');

    for (const scenario of scenarios) {
      expect(allSamples[scenario].length).toBe(target);
    }
  });
});
