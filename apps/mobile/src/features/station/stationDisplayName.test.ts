import { describe, expect, it } from 'vitest';

import { stationDisplayName } from './stationDisplayName';

describe('stationDisplayName', () => {
  it('preserves friendly labels and replaces address-shaped labels', () => {
    expect(stationDisplayName(
      'Mobile Development',
      'http://192.0.2.30:18132',
      'Station',
    )).toBe('Mobile Development');
    expect(stationDisplayName(
      '192.0.2.30:18132',
      'http://192.0.2.30:18132',
      'Station',
    )).toBe('Station');
    expect(stationDisplayName(
      'http://192.0.2.30:18132',
      'http://192.0.2.30:18132',
      'Station',
    )).toBe('Station');
  });
});
