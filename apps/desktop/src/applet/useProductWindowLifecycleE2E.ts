import { useEffect, useRef } from 'react';
import { api } from '../services/desktop_api';
import type { AppletProductWindowLaunchContext } from '../services/desktop_api';
import type { Navigation } from '../types/navigation';
import { log } from '../utils/logger';
import { getAppletProductWindowLaunchContext } from './productWindowE2E';

interface RouteEvent {
  step: string;
  hash: string;
  at: number;
}

function now(): number {
  return Math.round(performance.now());
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor<T>(label: string, probe: () => T | null | undefined | false, timeoutMs = 20000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  let lastError: unknown;
  while (performance.now() < deadline) {
    try {
      const value = probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

function clickElement(element: Element): void {
  (element as HTMLElement).click();
}

function collectLauncherState(): Record<string, unknown> {
  return {
    hash: window.location.hash,
    text: document.body?.innerText.slice(0, 1200) ?? '',
    tiles: Array.from(document.querySelectorAll('[data-applet-open]')).map((element) => ({
      id: element.getAttribute('data-applet-open'),
      status: element.getAttribute('data-applet-status'),
      text: (element.textContent ?? '').trim(),
    })),
  };
}

function isLifecycleContext(
  context: AppletProductWindowLaunchContext | null,
): context is AppletProductWindowLaunchContext & { appletId: string; secondaryAppletId: string } {
  return (context?.mode === 'lifecycle-smoothness' || context?.startPage === 'applets')
    && Boolean(context.appletId)
    && Boolean(context.secondaryAppletId);
}

async function resolveLifecycleContext(): Promise<AppletProductWindowLaunchContext | null> {
  const cached = getAppletProductWindowLaunchContext();
  if (isLifecycleContext(cached)) return cached;

  try {
    return await api.appletsProductWindowLaunchContext();
  } catch (error) {
    log.warn('applets', 'product-window lifecycle context unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function useProductWindowLifecycleE2E(navigation: Navigation): void {
  const startedRef = useRef(false);

  useEffect(() => {
    return startProductWindowLifecycleE2E(navigation, () => startedRef.current, () => {
      startedRef.current = true;
    });
  }, [navigation]);
}

let productWindowLifecycleStarted = false;

export function startProductWindowLifecycleE2E(
  navigation: Navigation,
  isAlreadyStarted = () => productWindowLifecycleStarted,
  markStarted = () => {
    productWindowLifecycleStarted = true;
  },
): () => void {
  if (isAlreadyStarted()) return () => {};

  let cancelled = false;
  let observer: PerformanceObserver | null = null;

  const bootstrap = async () => {
    const context = await resolveLifecycleContext();
    log.info('applets', 'product-window lifecycle context resolved', {
      enabled: context?.enabled ?? false,
      mode: context?.mode,
      startPage: context?.startPage,
      appletId: context?.appletId,
      secondaryAppletId: context?.secondaryAppletId,
    });
    if (cancelled || !isLifecycleContext(context) || isAlreadyStarted()) return;
    markStarted();

    const routeEvents: RouteEvent[] = [];
    const longTasks: Array<{ start: number; duration: number }> = [];
    observer = typeof PerformanceObserver !== 'undefined'
      ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
        }
      })
      : null;
    try {
      observer?.observe({ entryTypes: ['longtask'] });
    } catch {
      // Long task observation is best-effort; absence should not fail older WebViews.
    }

    const mark = (step: string) => {
      routeEvents.push({ step, hash: window.location.hash, at: now() });
    };

    const run = async () => {
      const primaryAppletId = context.appletId;
      const secondaryAppletId = context.secondaryAppletId;
      log.info('applets', 'product-window lifecycle smoothness started', { primaryAppletId, secondaryAppletId });

      navigation.navigateTo('applets');
      mark('launcher-requested');
      const primaryTile = await waitFor(
        `primary applet tile ${primaryAppletId}`,
        () => document.querySelector(`[data-applet-open="${primaryAppletId}"]`),
      );
      const secondaryTile = await waitFor(
        `secondary applet tile ${secondaryAppletId}`,
        () => document.querySelector(`[data-applet-open="${secondaryAppletId}"]`),
      );
      if (cancelled) return;
      mark('launcher-ready');

      clickElement(primaryTile);
      await waitFor('primary applet route', () => window.location.hash.includes(`applet:${primaryAppletId}`));
      await waitFor('primary applet runtime shell', () => document.querySelector(`[data-applet-runtime="${primaryAppletId}"]`));
      mark('primary-opened');

      navigation.navigateTo('applets');
      await waitFor('launcher after primary', () => window.location.hash.includes('applets'));
      await waitFor('primary still marked active', () => (
        document.querySelector(`[data-applet-open="${primaryAppletId}"][data-applet-status="active"]`)
      ));
      mark('launcher-after-primary');

      clickElement(secondaryTile);
      await waitFor('secondary applet route', () => window.location.hash.includes(`applet:${secondaryAppletId}`));
      await waitFor('secondary applet runtime shell', () => document.querySelector(`[data-applet-runtime="${secondaryAppletId}"]`));
      mark('secondary-opened');

      const closeButton = await waitFor('secondary applet close button', () => (
        Array.from(document.querySelectorAll('button')).find((button) => (
          (button.textContent ?? '').toLowerCase().includes('close')
          || (button.textContent ?? '').includes('关闭')
        ))
      ));
      clickElement(closeButton);
      await waitFor('launcher after close', () => window.location.hash.includes('applets'));
      mark('closed-to-launcher');

      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(500);
      const launcherState = collectLauncherState();
      const fullscreenLoading = Boolean(document.querySelector('.ant-spin-spinning')) && !document.querySelector('[data-applet-open]');
      mark('wakeup-sampled');

      const evidence = {
        primaryAppletId,
        secondaryAppletId,
        routeEvents,
        launcherState,
        fullscreenLoading,
        longTasks,
        ok: !fullscreenLoading,
      };
      await api.appletsProductWindowReportLifecycle({ evidence });
      log.info('applets', 'product-window lifecycle smoothness reported', evidence);
    };

    await run().catch((error) => {
      log.warn('applets', 'product-window lifecycle smoothness failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      void api.appletsProductWindowReportLifecycle({
        evidence: {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          routeEvents,
          launcherState: collectLauncherState(),
          longTasks,
        },
      });
    }).finally(() => {
      observer?.disconnect();
    });
  };

  void bootstrap();

  return () => {
    cancelled = true;
    observer?.disconnect();
  };
}
