import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MobileLaunchState,
  RuntimeBootstrapStatus,
  RuntimeEntry,
} from '../app/lifecycle/types';
import { setMomentsSurfaceFixture } from '../acceptance/momentsSurfaceFixture';

const lifecycle = vi.hoisted(() => ({
  launchState: 'shell' as MobileLaunchState,
  phase: 'ACTIVE' as const,
  runtimes: new Map<string, RuntimeEntry>(),
}));
const restartRuntimeGraph = vi.hoisted(() => vi.fn());

vi.mock('../app/lifecycle', async () => ({
  ...await import('../app/lifecycle/runtimeAvailability'),
  getMobileLifecycleKernel: () => ({ restartRuntimeGraph }),
  useLifecycleKernel: () => lifecycle,
}));
vi.mock('../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

import { MobileRouteBoundary } from './MobileRouteBoundary';

afterEach(() => {
  setMomentsSurfaceFixture(null);
});

function entry(id: string, status: RuntimeBootstrapStatus): RuntimeEntry {
  return {
    status,
    lastError: null,
    readiness: null,
    descriptor: {
      id, title: id, responsibility: id, dependsOn: [],
      bootstrap: async () => undefined,
      suspend: async () => undefined,
      resume: async () => undefined,
      teardown: async () => ({ runtimeId: id, success: true, durationMs: 0 }),
    },
  };
}

function render(
  status: RuntimeBootstrapStatus | null,
  routeId = 'tab:chat',
  dependencyStatus?: 'pending' | 'failed',
  launchState: MobileLaunchState = 'shell',
) {
  lifecycle.launchState = launchState;
  lifecycle.runtimes.clear();
  if (status) {
    let social = entry('social', status);
    if (dependencyStatus) {
      const messaging = entry('messaging', 'ready');
      messaging.readiness = { status: dependencyStatus, errorKey: null };
      lifecycle.runtimes.set('messaging', messaging);
      social = { ...social, descriptor: { ...social.descriptor, dependsOn: ['messaging'] } };
    }
    lifecycle.runtimes.set('social', social);
  }
  lifecycle.runtimes.set('auth', entry('auth', 'ready'));
  return renderToStaticMarkup(
    <MobileRouteBoundary routeId={routeId} onBack={() => undefined}>
      <span>domain-content</span>
    </MobileRouteBoundary>,
  );
}

describe('Mobile route owner readiness', () => {
  it('does not present empty domain data when its owner failed', () => {
    const html = render('failed');
    expect(html).toContain('mobile-route-unavailable');
    expect(html).toContain('mobile.tab.chat');
    expect(html).toContain('mobile.route.unavailableTitle');
    expect(html).toContain('mobile.route.unavailableBody');
    expect(html).toContain('mobile-route-retry');
    expect(html).toContain('data-route-state="unavailable"');
    expect(html).not.toContain('domain-content');
    expect(html).not.toContain('aria-busy="true"');
  });

  it('renders the domain only when its declared owner is ready', () => {
    expect(render('ready')).toBe('<span>domain-content</span>');
  });

  it('renders an explicit acceptance fixture without weakening production fail-closed state', () => {
    setMomentsSurfaceFixture('moments.feed');
    expect(render('failed', 'tab:moments')).toBe('<span>domain-content</span>');
    setMomentsSurfaceFixture(null);
    expect(render('failed', 'tab:moments')).not.toContain('domain-content');
  });

  it('shows preparation without mounting domain content', () => {
    const html = render('bootstrapping');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('mobile.route.preparingTitle');
    expect(html).toContain('mobile.route.preparingBody');
    expect(html).toContain('data-route-state="preparing"');
    expect(html).not.toContain('mobile-route-retry');
    expect(html).not.toContain('domain-content');
  });

  it.each([
    ['suspended', 'background'],
    ['resuming', 'resume'],
  ] as const)(
    'preserves the active tree while the native app is %s',
    (status, launchState) => {
      expect(render(status, 'tab:chat', undefined, launchState))
        .toBe('<span>domain-content</span>');
      expect(render(status)).not.toContain('domain-content');
    },
  );

  it('keeps auth-owned settings available while Social failed', () => {
    expect(render('failed', 'tab:settings')).toBe('<span>domain-content</span>');
  });

  it('preserves back navigation for an unavailable detail route', () => {
    const html = render('failed', 'detail:contact-profile');
    expect(html).toContain('common.action.back');
    expect(html).not.toContain('domain-content');
  });

  it('fails closed for an absent runtime or unknown route', () => {
    expect(render(null)).not.toContain('domain-content');
    expect(render('ready', 'tab:unknown')).not.toContain('domain-content');
    expect(render(null)).not.toContain('mobile-route-retry');
    expect(render('ready', 'tab:unknown')).not.toContain('mobile-route-retry');
  });

  it.each(['pending', 'failed'] as const)(
    'does not mount a ready resource with a %s dependency',
    (status) => {
      expect(render('ready', 'tab:chat', status)).not.toContain('domain-content');
      expect(render('ready', 'tab:settings', status)).toBe('<span>domain-content</span>');
    },
  );
});
