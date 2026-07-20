import { test, expect } from '../fixtures';
import {
  runtimePreflight,
  warmAllSecondaryTabs,
  SCENARIO_SAMPLERS,
  type PerformanceRuntime,
} from '../performanceHarness';

const EXPECTED_RUNTIME = (process.env.PT_PERFORMANCE_RUNTIME ?? 'tauri-webview-dev') as PerformanceRuntime;
const EXPECTED_ACTOR = process.env.PT_PERFORMANCE_ACTOR_ID ?? '345662927891595266';

test.describe('P0c3 stress tests', () => {
  test('rapid-click: 20 fast navigation clicks produce no >200ms outlier', async ({ tauriPage }) => {
    test.setTimeout(120_000);
    const preflight = await runtimePreflight(tauriPage, EXPECTED_RUNTIME, EXPECTED_ACTOR);
    expect(preflight.runtime).toBe(EXPECTED_RUNTIME);

    await warmAllSecondaryTabs(tauriPage);

    const durations: number[] = [];

    for (let i = 0; i < 20; i++) {
      const baseline = await tauriPage.evaluate<string[]>(
        'window.__PT_FRONTEND_TELEMETRY__?.getEvents?.().map(e => e.id) ?? []',
      );
      const target = i % 2 === 0 ? 'settings' : 'chat';
      await tauriPage.click(`[data-pt-primary-nav="${target}"] [role="button"]`);

      const baselineLiteral = JSON.stringify(baseline);
      try {
        await tauriPage.waitForFunction(`
          (() => {
            const bl = new Set(${baselineLiteral});
            const events = (window.__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? []).filter(e => !bl.has(e.id));
            return events.some(e => e.kind === 'route.visible');
          })()
        `, 5_000);
      } catch {
        durations.push(5000);
        continue;
      }

      const visible = await tauriPage.evaluate<number>(`
        (() => {
          const bl = new Set(${baselineLiteral});
          const events = (window.__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? []).filter(e => !bl.has(e.id));
          const rv = events.find(e => e.kind === 'route.visible');
          return rv?.durationMs ?? -1;
        })()
      `);
      durations.push(visible);
    }

    const valid = durations.filter((d) => d >= 0 && d < 5000);
    const max = Math.max(...valid);
    const p95 = valid.sort((a, b) => a - b)[Math.ceil(valid.length * 0.95) - 1] ?? 0;

    expect(valid.length).toBeGreaterThanOrEqual(18);
    expect(max).toBeLessThan(200);
    expect(p95).toBeLessThan(100);
  });

  test('slow-dependency: navigation stays responsive when invoke is slow', async ({ tauriPage }) => {
    test.setTimeout(60_000);
    await runtimePreflight(tauriPage, EXPECTED_RUNTIME, EXPECTED_ACTOR);

    await tauriPage.click('[data-pt-primary-nav="chat"] [role="button"]');
    await tauriPage.waitForSelector('[data-pt-context-menu-trigger]', 10_000);

    await tauriPage.evaluate<undefined>(`(() => {
      const orig = window.__TAURI_INTERNALS__?.invoke;
      if (!orig) return;
      window.__ORIG_INVOKE__ = orig;
      window.__TAURI_INTERNALS__.invoke = async function(cmd, ...args) {
        if (cmd !== 'frontend_telemetry_upload' && cmd !== 'frontend_log') {
          await new Promise(r => setTimeout(r, 300));
        }
        return window.__ORIG_INVOKE__.call(this, cmd, ...args);
      };
    })()`);

    const baseline = await tauriPage.evaluate<string[]>(
      'window.__PT_FRONTEND_TELEMETRY__?.getEvents?.().map(e => e.id) ?? []',
    );
    await tauriPage.click('[data-pt-primary-nav="settings"] [role="button"]');
    const baselineLiteral = JSON.stringify(baseline);

    try {
      await tauriPage.waitForFunction(`
        (() => {
          const bl = new Set(${baselineLiteral});
          const events = (window.__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? []).filter(e => !bl.has(e.id));
          return events.some(e => e.kind === 'route.visible');
        })()
      `, 5_000);
    } catch {
      await tauriPage.evaluate<undefined>(`(() => {
        if (window.__ORIG_INVOKE__) window.__TAURI_INTERNALS__.invoke = window.__ORIG_INVOKE__;
      })()`);
      throw new Error('route.visible never emitted with slow invoke');
    }

    const navDuration = await tauriPage.evaluate<number>(`
      (() => {
        const bl = new Set(${baselineLiteral});
        const events = (window.__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? []).filter(e => !bl.has(e.id));
        return events.find(e => e.kind === 'route.visible')?.durationMs ?? -1;
      })()
    `);

    await tauriPage.evaluate<undefined>(`(() => {
      if (window.__ORIG_INVOKE__) {
        window.__TAURI_INTERNALS__.invoke = window.__ORIG_INVOKE__;
        delete window.__ORIG_INVOKE__;
      }
    })()`);

    expect(navDuration).toBeGreaterThan(0);
    expect(navDuration).toBeLessThan(150);
  });

  test('heavy-load: 30 rapid text inputs do not produce >100ms P95', async ({ tauriPage }) => {
    test.setTimeout(60_000);
    await runtimePreflight(tauriPage, EXPECTED_RUNTIME, EXPECTED_ACTOR);

    const durations: number[] = [];
    for (let i = 0; i < 30; i++) {
      try {
        const sample = await SCENARIO_SAMPLERS['text-input'](tauriPage);
        const visible = sample.events.find((e) => e.kind === 'input.visible');
        if (visible?.durationMs !== undefined) durations.push(visible.durationMs);
      } catch {
        durations.push(3000);
      }
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;

    expect(sorted.length).toBeGreaterThanOrEqual(25);
    expect(p95).toBeLessThan(100);
  });
});
