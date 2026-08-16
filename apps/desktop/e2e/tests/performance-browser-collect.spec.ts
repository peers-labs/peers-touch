// PERFORMANCE ONLY. This file is not a product Acceptance Gate.
import { test, expect, chromium } from '@playwright/test';
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

const WEB_PORT = process.env.PT_DESKTOP_APP_WEB_PORT || '3210';
const DEV_URL = `http://localhost:${WEB_PORT}`;
const RUNTIME = 'browser-gateway' as const;

interface CohortManifest {
  cohortId: string;
  expectedActorId: string;
  warmupRuns: number;
  postWarmupSamplesPerScenario: number;
  scenarios: string[];
  buildRevision: string;
  profile: string;
  station: string;
}

type TelemetryEvent = {
  id: string;
  interactionId?: string;
  kind: string;
  runtime: string;
  durationMs?: number;
};

type ScenarioSample = {
  scenario: string;
  interactionId: string;
  events: TelemetryEvent[];
};

const READY_SHELL = '[data-pt-primary-nav]';
const TEXT_INPUT = '[data-pt-text-input="chat-composer"]';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(timings: number[]) {
  const sorted = [...timings].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    count: sorted.length,
  };
}

test.describe('P0c3 browser-gateway evidence', () => {
  test('collect N≥30 samples', async () => {
    test.setTimeout(300_000);

    const cohort: CohortManifest = JSON.parse(
      fs.readFileSync(COHORT_PATH, 'utf-8'),
    );

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();

    await page.goto(DEV_URL);
    await page.waitForSelector(READY_SHELL, { timeout: 30_000 });
    await page.waitForFunction(
      "typeof window.__PT_ACCEPTANCE__?.getRealtimeDevice === 'function'",
      { timeout: 10_000 },
    );

    const observed = await page.evaluate(() => ({
      runtime: (window as any).__PT_FRONTEND_TELEMETRY__?.snapshot?.().runtime ?? 'unknown',
      actorId: '',
    }));
    expect(observed.runtime).toBe('browser-gateway');

    const identity = await page.evaluate(async () => {
      const device = await (window as any).__PT_ACCEPTANCE__.getRealtimeDevice();
      return { actorId: device.actorId ?? '' };
    });
    expect(identity.actorId).toBe(cohort.expectedActorId);

    async function baselineIds(): Promise<string[]> {
      return page.evaluate(() =>
        ((window as any).__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? []).map((e: any) => e.id),
      );
    }

    async function eventsAfterBaseline(baseline: string[]): Promise<TelemetryEvent[]> {
      return page.evaluate((bl: string[]) => {
        const set = new Set(bl);
        return ((window as any).__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? [])
          .filter((e: any) => !set.has(e.id));
      }, baseline);
    }

    async function waitForLinked(
      baseline: string[],
      requiredKinds: string[],
      timeout = 10_000,
    ): Promise<TelemetryEvent[]> {
      await page.waitForFunction(
        ([bl, kinds]: [string[], string[]]) => {
          const set = new Set(bl);
          const events = ((window as any).__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? [])
            .filter((e: any) => !set.has(e.id));
          return events.some((c: any) => c.interactionId
            && kinds.every((k: string) => events.some(
              (e: any) => e.interactionId === c.interactionId && e.kind === k,
            )));
        },
        [baseline, requiredKinds] as [string[], string[]],
        { timeout },
      );
      return eventsAfterBaseline(baseline);
    }

    function linkedSample(scenario: string, events: TelemetryEvent[], requiredKinds: string[]): ScenarioSample {
      const interactionId = events.find((c) => c.interactionId
        && requiredKinds.every((k) => events.some(
          (e) => e.interactionId === c.interactionId && e.kind === k,
        )))?.interactionId ?? '';
      return { scenario, interactionId, events: events.filter((e) => e.interactionId === interactionId) };
    }

    async function ensureChatReady(): Promise<void> {
      await page.click(`[data-pt-primary-nav="chat"] [role="button"]`);
      await page.waitForSelector('[data-pt-context-menu-trigger]', { timeout: 15_000 });
      if (await page.locator(TEXT_INPUT).count() === 0) {
        await page.click('[data-pt-context-menu-trigger]');
        await page.waitForSelector(TEXT_INPUT, { timeout: 10_000 });
      }
    }

    async function sampleTextInput(): Promise<ScenarioSample> {
      await ensureChatReady();
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLTextAreaElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter!.call(el, '');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'insertText' }));
      }, TEXT_INPUT);
      const bl = await baselineIds();
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLTextAreaElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter!.call(el, 'x');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'x', inputType: 'insertText' }));
      }, TEXT_INPUT);
      const events = await waitForLinked(bl, ['input.intent', 'input.visible']);
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLTextAreaElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter!.call(el, '');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'insertText' }));
      }, TEXT_INPUT);
      return linkedSample('text-input', events, ['input.intent', 'input.visible']);
    }

    async function samplePrimaryNav(): Promise<ScenarioSample> {
      await ensureChatReady();
      const bl = await baselineIds();
      await page.click('[data-pt-primary-nav="settings"] [role="button"]');
      const events = await waitForLinked(bl, ['interaction.started', 'route.requested', 'route.visible']);
      return linkedSample('primary-nav', events, ['interaction.started', 'route.requested', 'route.visible']);
    }

    async function sampleSecondaryTab(): Promise<ScenarioSample> {
      await page.click(`[data-pt-primary-nav="settings"] [role="button"]`);
      await page.waitForSelector('[data-pt-secondary-tab]', { timeout: 10_000 });
      const target = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-pt-secondary-tab]'))
          .find((el) => el.getAttribute('aria-selected') !== 'true')
          ?.getAttribute('data-pt-secondary-tab') ?? '';
      });
      if (!target) throw new Error('no inactive tab');
      const bl = await baselineIds();
      await page.click(`[data-pt-secondary-tab="${target}"]`);
      const events = await waitForLinked(bl, ['interaction.started', 'route.requested', 'route.visible']);
      return linkedSample('secondary-tab', events, ['interaction.started', 'route.requested', 'route.visible']);
    }

    async function sampleOverlay(): Promise<ScenarioSample> {
      await ensureChatReady();
      await page.keyboard.press('Escape');
      const bl = await baselineIds();
      await page.evaluate(() => {
        const el = document.querySelector('[data-pt-context-menu-trigger]');
        if (!el) throw new Error('trigger missing');
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, button: 2, buttons: 2, cancelable: true,
          clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
          view: window,
        }));
      });
      const events = await waitForLinked(bl, ['contextmenu.intent', 'overlay.visible']);
      await page.keyboard.press('Escape');
      return linkedSample('overlay', events, ['contextmenu.intent', 'overlay.visible']);
    }

    const samplers: Record<string, () => Promise<ScenarioSample>> = {
      'text-input': sampleTextInput,
      'primary-nav': samplePrimaryNav,
      'secondary-tab': sampleSecondaryTab,
      overlay: sampleOverlay,
    };

    const allSamples: Record<string, { durationMs: number | undefined; interactionId: string }[]> = {};
    const warmup = cohort.warmupRuns;
    const target = cohort.postWarmupSamplesPerScenario;

    for (const scenario of cohort.scenarios) {
      allSamples[scenario] = [];
      const sampler = samplers[scenario];

      for (let i = 0; i < warmup; i++) {
        await sampler();
        await page.waitForTimeout(100);
      }

      for (let i = 0; i < target; i++) {
        const sample = await sampler();
        const visibleEvent = sample.events.find(
          (e) => e.kind === 'input.visible' || e.kind === 'route.visible' || e.kind === 'overlay.visible',
        );
        allSamples[scenario].push({
          durationMs: visibleEvent?.durationMs,
          interactionId: sample.interactionId,
        });
        await page.waitForTimeout(50);
      }
    }

    const stats: Record<string, ReturnType<typeof computeStats>> = {};
    for (const scenario of cohort.scenarios) {
      const durations = allSamples[scenario]
        .map((s) => s.durationMs)
        .filter((d): d is number => d !== undefined);
      stats[scenario] = computeStats(durations);
    }

    const artifact = {
      schemaVersion: 1,
      artifactKind: 'desktop-performance-cell-evidence',
      phase: 'P0c-3',
      cellId: RUNTIME,
      cohortId: cohort.cohortId,
      collectedAt: new Date().toISOString(),
      runtime: RUNTIME,
      profile: cohort.profile,
      actualActorId: identity.actorId,
      station: cohort.station,
      buildRevision: cohort.buildRevision,
      warmupRuns: warmup,
      samplesPerScenario: target,
      stats,
      samples: allSamples,
    };

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(OUTPUT_DIR, `${RUNTIME}-evidence.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');

    for (const scenario of cohort.scenarios) {
      expect(allSamples[scenario].length).toBe(target);
    }

    await browser.close();
  });
});
