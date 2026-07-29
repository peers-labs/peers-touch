import type {
  BrowserPageAdapter,
  TauriPage,
} from '@srsholmes/tauri-playwright';

export type PerformancePage = TauriPage | BrowserPageAdapter;

export type PerformanceRuntime =
  | 'browser-gateway'
  | 'tauri-webview-dev'
  | 'tauri-webview-packaged';

export type PerformanceScenario =
  | 'text-input'
  | 'primary-nav'
  | 'secondary-tab'
  | 'overlay';

type TelemetryEvent = {
  id: string;
  interactionId?: string;
  kind: string;
  runtime: string;
  data?: Record<string, unknown>;
  durationMs?: number;
};

export type ScenarioSample = {
  scenario: PerformanceScenario;
  interactionId: string;
  events: TelemetryEvent[];
};

const READY_SHELL = "[data-pt-primary-nav]";
const TEXT_INPUT = '[data-pt-text-input="chat-composer"]';

async function baselineEventIds(page: PerformancePage): Promise<string[]> {
  return page.evaluate<string[]>(
    'window.__PT_FRONTEND_TELEMETRY__?.getEvents?.().map((event) => event.id) ?? []',
  );
}

async function eventsAfter(
  page: PerformancePage,
  baseline: readonly string[],
): Promise<TelemetryEvent[]> {
  return page.evaluate<TelemetryEvent[]>(`
    (() => {
      const baseline = new Set(${JSON.stringify(baseline)});
      return (window.__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? [])
        .filter((event) => !baseline.has(event.id));
    })()
  `);
}

async function waitForLinkedEvents(
  page: PerformancePage,
  baseline: readonly string[],
  requiredKinds: readonly string[],
): Promise<ScenarioSample['events']> {
  const baselineLiteral = JSON.stringify(baseline);
  const kindsLiteral = JSON.stringify(requiredKinds);
  try {
    await page.waitForFunction(`
      (() => {
        const baseline = new Set(${baselineLiteral});
        const required = ${kindsLiteral};
        const events = (window.__PT_FRONTEND_TELEMETRY__?.getEvents?.() ?? [])
          .filter((event) => !baseline.has(event.id));
        return events.some((candidate) => candidate.interactionId
          && required.every((kind) => events.some(
            (event) => event.interactionId === candidate.interactionId && event.kind === kind
          )));
      })()
    `, 10_000);
  } catch (error) {
    const events = await eventsAfter(page, baseline);
    throw new Error(
      `missing linked events ${requiredKinds.join(',')}; observed=${JSON.stringify(
        events.map((event) => ({
          durationMs: event.durationMs,
          interactionId: event.interactionId,
          kind: event.kind,
        })),
      )}; cause=${String(error)}`,
    );
  }
  return eventsAfter(page, baseline);
}

function linkedSample(
  scenario: PerformanceScenario,
  events: TelemetryEvent[],
  requiredKinds: readonly string[],
): ScenarioSample {
  const interactionId = events.find((candidate) => candidate.interactionId
    && requiredKinds.every((kind) => events.some(
      (event) => event.interactionId === candidate.interactionId && event.kind === kind
    )))?.interactionId;
  if (!interactionId) {
    throw new Error(`${scenario} did not emit one interaction-linked event window`);
  }
  return {
    scenario,
    interactionId,
    events: events.filter((event) => event.interactionId === interactionId),
  };
}

async function ensurePrimaryPage(page: PerformancePage, pageId: string): Promise<void> {
  const pageAnchors: Record<string, string> = {
    chat: '[data-pt-context-menu-trigger]',
    settings: '[data-pt-secondary-tab]',
  };
  const pageAnchor = pageAnchors[pageId];
  if (!pageAnchor) throw new Error(`no page anchor is defined for ${pageId}`);
  await page.click(`[data-pt-primary-nav="${pageId}"] [role="button"]`);
  await page.waitForSelector(pageAnchor, 10_000);
}

async function setTextInput(page: PerformancePage, value: string): Promise<void> {
  await page.evaluate(`
    (() => {
      const element = document.querySelector(${JSON.stringify(TEXT_INPUT)});
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error('chat composer textarea is missing');
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      if (!setter) throw new Error('textarea value setter is unavailable');
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: ${JSON.stringify(value)},
        inputType: 'insertText',
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
}

export async function runtimePreflight(
  page: PerformancePage,
  expectedRuntime: PerformanceRuntime,
  expectedActorId: string,
): Promise<{ actualActorId: string; runtime: string }> {
  await page.waitForFunction(
    `document.querySelectorAll('${READY_SHELL}').length > 0`,
    30_000,
  );
  await page.waitForFunction(
    "typeof window.__PT_ACCEPTANCE__?.getRealtimeDevice === 'function'",
    10_000,
  );
  const observed = await page.evaluate<{ actualActorId: string; runtime: string }>(`
    (async () => {
      const identity = await window.__PT_ACCEPTANCE__.getRealtimeDevice();
      return {
        actualActorId: identity.actorId ?? '',
        runtime: window.__PT_FRONTEND_TELEMETRY__?.snapshot?.().runtime ?? 'unknown',
      };
    })()
  `);
  if (observed.runtime !== expectedRuntime) {
    throw new Error(`runtime mismatch got=${observed.runtime} want=${expectedRuntime}`);
  }
  if (observed.actualActorId !== expectedActorId) {
    throw new Error(`actual actor mismatch got=${observed.actualActorId} want=${expectedActorId}`);
  }
  return observed;
}

export async function sampleTextInput(page: PerformancePage): Promise<ScenarioSample> {
  await ensurePrimaryPage(page, 'chat');
  if (await page.count(TEXT_INPUT) === 0) {
    await page.click('[data-pt-context-menu-trigger]');
  }
  await page.waitForSelector(TEXT_INPUT, 10_000);
  await setTextInput(page, '');
  const baseline = await baselineEventIds(page);
  await setTextInput(page, 'x');
  const required = ['input.intent', 'input.visible'] as const;
  const events = await waitForLinkedEvents(page, baseline, required);
  await setTextInput(page, '');
  return linkedSample('text-input', events, required);
}

export async function samplePrimaryNavigation(page: PerformancePage): Promise<ScenarioSample> {
  await ensurePrimaryPage(page, 'chat');
  const baseline = await baselineEventIds(page);
  await page.click('[data-pt-primary-nav="settings"] [role="button"]');
  const required = ['interaction.started', 'route.requested', 'route.visible'] as const;
  const events = await waitForLinkedEvents(page, baseline, required);
  return linkedSample('primary-nav', events, required);
}

export async function sampleSecondaryTab(page: PerformancePage): Promise<ScenarioSample> {
  await ensurePrimaryPage(page, 'settings');
  const target = await page.evaluate<string>(`
    Array.from(document.querySelectorAll('[data-pt-secondary-tab]'))
      .find((element) => element.getAttribute('aria-selected') !== 'true')
      ?.getAttribute('data-pt-secondary-tab') ?? ''
  `);
  if (!target) throw new Error('no inactive secondary tab is available');
  const baseline = await baselineEventIds(page);
  await page.click(`[data-pt-secondary-tab="${target}"]`);
  const required = ['interaction.started', 'route.requested', 'route.visible'] as const;
  const events = await waitForLinkedEvents(page, baseline, required);
  return linkedSample('secondary-tab', events, required);
}

export async function sampleOverlay(page: PerformancePage): Promise<ScenarioSample> {
  await ensurePrimaryPage(page, 'chat');
  await page.waitForSelector('[data-pt-context-menu-trigger]', 10_000);
  await page.keyboard.press('Escape');
  const baseline = await baselineEventIds(page);
  await page.evaluate(`
    (() => {
      const element = document.querySelector('[data-pt-context-menu-trigger]');
      if (!element) throw new Error('context menu trigger is missing');
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        button: 2,
        buttons: 2,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        view: window,
      }));
    })()
  `);
  const required = ['contextmenu.intent', 'overlay.visible'] as const;
  const events = await waitForLinkedEvents(page, baseline, required);
  await page.keyboard.press('Escape');
  return linkedSample('overlay', events, required);
}

export async function warmAllSecondaryTabs(page: PerformancePage): Promise<void> {
  await ensurePrimaryPage(page, 'settings');
  const allTabs = await page.evaluate<string[]>(`
    Array.from(document.querySelectorAll('[data-pt-secondary-tab]'))
      .map((element) => element.getAttribute('data-pt-secondary-tab') ?? '')
      .filter(Boolean)
  `);
  for (const tab of allTabs) {
    await page.click(`[data-pt-secondary-tab="${tab}"]`);
    await page.waitForFunction(
      `document.querySelector('[data-pt-secondary-tab="${tab}"][aria-selected="true"]') !== null`,
      5_000,
    );
  }
}

export const SCENARIO_SAMPLERS = {
  'text-input': sampleTextInput,
  'primary-nav': samplePrimaryNavigation,
  'secondary-tab': sampleSecondaryTab,
  overlay: sampleOverlay,
} satisfies Record<
  PerformanceScenario,
  (page: PerformancePage) => Promise<ScenarioSample>
>;

export async function collectLongTasksDuringInteraction(
  page: PerformancePage,
  interactionFn: () => Promise<void>,
): Promise<TelemetryEvent[]> {
  const baseline = await baselineEventIds(page);
  await interactionFn();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const events = await eventsAfter(page, baseline);
  return events.filter((e) => e.kind === 'longtask.detected');
}
