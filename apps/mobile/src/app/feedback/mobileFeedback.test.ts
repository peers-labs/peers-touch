import { describe, expect, it, vi } from 'vitest';

import {
  confirm,
  confirmDestructive,
  mobileFeedbackChannel,
  notify,
  notifyError,
  notifySuccess,
} from './mobileFeedback';

describe('mobile feedback seam', () => {
  it('confirm resolves true/false from the shared channel queue', async () => {
    const pending = confirm({ title: 'Sure?' });
    let queued = mobileFeedbackChannel.getSnapshot();
    expect(queued).toHaveLength(1);
    const id = queued[0].id;
    mobileFeedbackChannel.finish(id, true);
    await expect(pending).resolves.toBe(true);
    expect(mobileFeedbackChannel.getSnapshot()).toHaveLength(0);

    const cancelled = confirmDestructive({ title: 'Delete?' });
    queued = mobileFeedbackChannel.getSnapshot();
    expect(queued[0].tone).toBe('danger');
    mobileFeedbackChannel.finish(queued[0].id, false);
    await expect(cancelled).resolves.toBe(false);
  });

  it('notify publishes a toned notice on the shared toast channel and returns a dismiss fn', () => {
    const listener = vi.fn();
    const unsubscribe = mobileFeedbackChannel.notices.subscribe(listener);
    const dismiss = notify({ message: 'hi', tone: 'info' });
    expect(typeof dismiss).toBe('function');
    const published = listener.mock.calls[0][0];
    expect(published.message).toBe('hi');
    expect(published.tone).toBe('info');
    unsubscribe();
  });

  it('success/error helpers carry their tone', () => {
    const seen: unknown[] = [];
    const unsubscribe = mobileFeedbackChannel.notices.subscribe(e => seen.push(e));
    notifySuccess('ok');
    notifyError('bad');
    expect(seen.map((e: any) => e.tone)).toEqual(['success', 'danger']);
    unsubscribe();
  });
});
