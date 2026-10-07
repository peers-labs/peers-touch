// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it, vi } from 'vitest';

import {
  createSocialEventIngress,
  type SocialIngressEvent,
} from './socialEventIngress';

function socialEvent(cursor: string): SocialIngressEvent {
  return {
    domain: 'social',
    kind: 'relationship-changed',
    payload: {},
    cursor,
    timestampMs: 1,
  };
}

function notificationEvent(cursor: string): SocialIngressEvent {
  return {
    domain: 'notification',
    kind: 'notification-received',
    payload: {},
    cursor,
    timestampMs: 1,
  };
}

describe('social event ingress', () => {
  it('deduplicates within a domain while allowing one stream cursor to fan out', async () => {
    const handled: SocialIngressEvent[] = [];
    const ingress = createSocialEventIngress({
      onEvent: (event) => {
        handled.push(event);
      },
    });

    expect(ingress.ingestDataEvent(socialEvent('cursor-1'))).toBe(true);
    expect(ingress.ingestDataEvent(socialEvent('cursor-1'))).toBe(true);
    expect(ingress.ingestDataEvent(notificationEvent('cursor-1'))).toBe(true);
    await ingress.drain();

    expect(handled.map((event) => event.domain)).toEqual(['social', 'notification']);
    expect(ingress.state().cursors.social.lastCursor).toBe('cursor-1');
    expect(ingress.state().cursors.notification.lastCursor).toBe('cursor-1');
    expect(ingress.state().streamCursor).toBe('cursor-1');
  });

  it('marks an overflowing data domain stale and requests reconciliation', async () => {
    let release: (() => void) | undefined;
    const firstDelivery = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reconcile = vi.fn();
    const ingress = createSocialEventIngress(
      {
        onEvent: () => firstDelivery,
        onReconcileRequired: reconcile,
      },
      { dataCapacity: 1 },
    );

    expect(ingress.ingestDataEvent(socialEvent('cursor-1'))).toBe(true);
    expect(ingress.ingestDataEvent(socialEvent('cursor-2'))).toBe(false);
    expect(ingress.state().staleness.social).toMatchObject({
      stale: true,
      reason: 'data_capacity_overflow',
    });
    expect(ingress.state().cursors.social.gapDetected).toBe(true);
    expect(reconcile).toHaveBeenCalledWith({
      domains: ['social'],
      reason: 'data_capacity_overflow',
      checkpointCursor: 'cursor-2',
    });

    release?.();
    await ingress.drain();
  });

  it('keeps writes closed across suspend until every projection is repaired', async () => {
    const reconcile = vi.fn();
    const admission = vi.fn();
    const ingress = createSocialEventIngress({
      onEvent: () => undefined,
      onAdmissionChange: admission,
      onReconcileRequired: reconcile,
    });

    ingress.suspend();
    expect(ingress.state().lifecycle).toBe('suspended');
    expect(ingress.state().writeAdmission.open).toBe(false);

    ingress.resume();
    expect(reconcile).toHaveBeenCalledWith({
      domains: ['social', 'moments', 'notification', 'profile'],
      reason: 'runtime_resume',
      checkpointCursor: '',
    });
    for (const domain of ['social', 'moments', 'notification', 'profile'] as const) {
      ingress.repairCursor(domain, '');
    }
    ingress.reopenAdmission();

    expect(ingress.state().lifecycle).toBe('active');
    expect(ingress.state().writeAdmission).toEqual({ open: true });
    expect(admission).toHaveBeenLastCalledWith({ open: true });
  });

  it('closes admission and requests session revalidation after control loss', async () => {
    let release: (() => void) | undefined;
    const firstDelivery = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revalidate = vi.fn();
    const reconcile = vi.fn();
    const ingress = createSocialEventIngress(
      {
        onEvent: () => firstDelivery,
        onReconcileRequired: reconcile,
        onSessionRevalidationRequired: revalidate,
      },
      {
        controlCapacity: 1,
      },
    );
    const control = (cursor: string): SocialIngressEvent => ({
      domain: 'control',
      kind: 'heartbeat',
      payload: {},
      cursor,
      timestampMs: 1,
    });

    expect(ingress.ingestControlEvent(control('cursor-1'))).toBe(true);
    expect(ingress.ingestControlEvent(control('cursor-2'))).toBe(false);

    expect(revalidate).toHaveBeenCalledWith('control_event_lost');
    expect(ingress.state().writeAdmission).toMatchObject({
      open: false,
      reason: 'control_event_lost',
    });
    expect(reconcile).toHaveBeenCalledWith({
      domains: ['social', 'moments', 'notification', 'profile'],
      reason: 'control_event_lost',
      checkpointCursor: 'cursor-2',
    });

    release?.();
    await ingress.drain();
  });

  it('rejects queued work after teardown', async () => {
    const handler = vi.fn();
    const ingress = createSocialEventIngress({ onEvent: handler });

    ingress.teardown();

    expect(ingress.ingestDataEvent(socialEvent('cursor-1'))).toBe(false);
    expect(ingress.ingestControlEvent({
      domain: 'control',
      kind: 'heartbeat',
      payload: {},
      cursor: 'cursor-2',
      timestampMs: 1,
    })).toBe(false);
    await ingress.drain();
    expect(handler).not.toHaveBeenCalled();
    expect(ingress.state().lifecycle).toBe('torn');
  });
});
