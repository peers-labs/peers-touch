// PERFORMANCE ONLY. This file is not a product Acceptance Gate.
import { test, expect } from '../fixtures';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORT_DIR = path.resolve(
  __dirname,
  '../../../../tooling/acceptance/reports',
);
const REPORT_PATH = path.join(
  REPORT_DIR,
  'desktop-performance-cells/tauri-webview-dev.json',
);
const CELL_METADATA = {
  schemaVersion: 1,
  artifactKind: 'desktop-performance-runtime-cell',
  phase: 'P0c-3',
  bom: ['BOM-GATE-02', 'BOM-CAP-04'],
  spec: ['SPEC-GATE-02', 'SPEC-RUN-01'],
  gate: 'Development Native Tauri WebView runtime evidence is required',
  cellId: 'tauri-webview-dev',
  runtime: 'tauri-webview-dev',
  entrypoint: 'make desktop',
  startupMode: 'dev-tauri-webview',
} as const;
const COHORT_METADATA = {
  profile: process.env.PT_PERFORMANCE_PROFILE ?? 'unknown',
  actorPtid: process.env.PT_PERFORMANCE_ACTOR_PTID ?? 'unknown',
  dataRevision: process.env.PT_PERFORMANCE_DATA_REVISION ?? 'unknown',
  station: process.env.PT_PERFORMANCE_STATION ?? 'unknown',
  windowSize: process.env.PT_PERFORMANCE_WINDOW_SIZE ?? 'unknown',
  warmupRuns: Number(process.env.PT_PERFORMANCE_WARMUP_RUNS ?? 0),
} as const;

function writeReport(report: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        ...CELL_METADATA,
        cohort: COHORT_METADATA,
        generatedAt: new Date().toISOString(),
        ...report,
      },
      null,
      2,
    ),
  );
}

test.describe('tauri-webview-dev runtime cell evidence', () => {
  test('collects overlay telemetry from real WKWebView', async ({ tauriPage }) => {
    try {
      await tauriPage.waitForFunction(
        "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
        30_000,
      );
    } catch (error) {
      const diagnostic = await tauriPage.evaluate(`
        (() => {
          const snapshot = window.__PT_FRONTEND_TELEMETRY__?.snapshot?.();
          return {
            url: window.location.href,
            runtime: snapshot?.runtime ?? 'unknown',
            primaryNavCount: document.querySelectorAll('[data-pt-primary-nav]').length,
            contextMenuTriggerCount: document.querySelectorAll('[data-pt-context-menu-trigger]').length,
            pinInputCount: document.querySelectorAll('input[type="password"][inputmode="numeric"]').length,
            eventCount: snapshot?.eventCount ?? 0,
            droppedCount: snapshot?.droppedCount ?? 0,
            visibleText: (document.body?.innerText ?? '').slice(0, 1000),
          };
        })()
      `);
      writeReport({
        status: 'diagnostic incomplete',
        completionStatus: 'PARTIAL',
        proofStatus: 'UNPROVEN',
        sampleEmissionAllowed: false,
        interactionId: null,
        reason: diagnostic.pinInputCount > 0 ? 'pin-required' : 'ready-shell-missing',
        preflight: {
          station: 'passed',
          gateway: 'passed',
          renderer: 'passed',
          login: diagnostic.pinInputCount > 0 ? 'blocked' : 'unknown',
          readyShell: 'blocked',
        },
        readyShell: {
          status: 'diagnostic incomplete',
          proofStatus: 'UNPROVEN',
          visible: false,
          reason: 'Ready Shell is unavailable before login preflight passes',
        },
        diagnostic,
      });
      throw error;
    }

    const runtime = await tauriPage.evaluate(
      'window.__PT_FRONTEND_TELEMETRY__?.snapshot()?.runtime',
    );
    expect(runtime).toBe('tauri-webview-dev');

    const baselineEventIds = await tauriPage.evaluate<string[]>(
      'window.__PT_FRONTEND_TELEMETRY__?.getEvents?.().map((event) => event.id) ?? []',
    );

    await tauriPage.click('[data-pt-primary-nav="chat"] [role="button"]');
    try {
      await tauriPage.waitForSelector('[data-pt-context-menu-trigger]', 1_000);
    } catch (error) {
      const snapshot = await tauriPage.evaluate(
        'window.__PT_FRONTEND_TELEMETRY__?.snapshot()',
      );
      const sampledEvents = snapshot.events.filter(
        (event: any) => !baselineEventIds.includes(event.id),
      );
      const interaction = sampledEvents.find(
        (event: any) => event.interactionId,
      );
      writeReport({
        status: 'diagnostic incomplete',
        completionStatus: 'PARTIAL',
        proofStatus: 'UNPROVEN',
        sampleEmissionAllowed: false,
        interactionId: interaction?.interactionId ?? null,
        reason: 'context-menu-trigger-missing',
        preflight: {
          station: 'passed',
          gateway: 'passed',
          renderer: 'passed',
          login: 'passed',
          readyShell: 'passed',
          interactionTarget: 'blocked',
        },
        readyShell: {
          status: 'pass',
          proofStatus: 'PROVEN',
          visible: true,
        },
        telemetry: {
          eventCount: sampledEvents.length,
          events: sampledEvents.slice(0, 30),
        },
      });
      throw error;
    }

    await tauriPage.keyboard.press('Escape');
    const trigger = tauriPage.locator('[data-pt-context-menu-trigger]').first();
    await trigger.evaluate(
      `(element) => {
        const rect = element.getBoundingClientRect();
        return element.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          buttons: 2,
          cancelable: true,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2,
          view: window,
        }));
      }`,
    );

    const baselineEventIdsLiteral = JSON.stringify(baselineEventIds);
    await tauriPage.waitForFunction(
      `(() => {
        const snap = window.__PT_FRONTEND_TELEMETRY__?.snapshot();
        if (!snap) return false;
        const baseline = new Set(${baselineEventIdsLiteral});
        const sampled = snap.events.filter((event) => !baseline.has(event.id));
        return sampled.some((event) => event.kind === 'contextmenu.intent')
          && sampled.some((event) => event.kind === 'overlay.visible');
      })()`,
      10_000,
    );

    const snapshot = await tauriPage.evaluate(
      'window.__PT_FRONTEND_TELEMETRY__?.snapshot()',
    );

    expect(snapshot).toBeDefined();
    expect(snapshot.runtime).toBe('tauri-webview-dev');

    const sampledEvents = snapshot.events.filter(
      (event: any) => !baselineEventIds.includes(event.id),
    );
    const intent = sampledEvents.find(
      (event: any) => event.kind === 'contextmenu.intent',
    );
    const visible = sampledEvents.find(
      (event: any) => event.kind === 'overlay.visible',
    );
    expect(intent?.interactionId).toBeTruthy();
    expect(visible?.interactionId).toBe(intent.interactionId);

    const wrongRuntime = sampledEvents.filter(
      (e: any) => e.runtime !== 'tauri-webview-dev',
    );
    expect(wrongRuntime.length).toBe(0);

    writeReport({
      status: 'sampled',
      completionStatus: 'DONE',
      proofStatus: 'PROVEN',
      sampleEmissionAllowed: true,
      interactionId: intent.interactionId,
      readyShell: {
        status: 'pass',
        proofStatus: 'PROVEN',
        visible: true,
      },
      eventCount: sampledEvents.length,
      overlayIntentCount: sampledEvents.filter(
        (event: any) => event.kind === 'contextmenu.intent',
      ).length,
      overlayVisibleCount: sampledEvents.filter(
        (event: any) => event.kind === 'overlay.visible',
      ).length,
      events: sampledEvents.slice(0, 30),
    });
  });
});
