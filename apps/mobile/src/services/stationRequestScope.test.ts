import { describe, expect, it } from 'vitest';

import { createStationRequestScope } from './stationTransport';

describe('runtime Station request cancellation', () => {
  it('cancels the old foreground, renews only on resume, and never renews a closed scope', () => {
    const requests = createStationRequestScope();
    const foreground = requests.signal();
    expect(foreground.aborted).toBe(false);

    requests.suspend();
    expect(foreground.aborted).toBe(true);
    expect(requests.signal().aborted).toBe(true);

    requests.resume();
    const resumed = requests.signal();
    expect(resumed).not.toBe(foreground);
    expect(resumed.aborted).toBe(false);
    expect(foreground.aborted).toBe(true);

    requests.close();
    requests.resume();
    expect(resumed.aborted).toBe(true);
    expect(requests.signal()).toBe(resumed);
  });
});
