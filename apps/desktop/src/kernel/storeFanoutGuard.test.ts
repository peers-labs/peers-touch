import { describe, it, expect, beforeEach } from 'vitest';
import { recordDispatch, getRecentDispatches, getExceededDispatches, getFanoutStats, _resetGuard } from './storeFanoutGuard';

describe('StoreFanoutGuard', () => {
  beforeEach(() => {
    _resetGuard();
  });

  describe('recordDispatch', () => {
    it('records dispatch with fanout count', () => {
      const record = recordDispatch('chat', 'sendMessage', 2);
      expect(record.store).toBe('chat');
      expect(record.action).toBe('sendMessage');
      expect(record.fanoutCount).toBe(2);
      expect(record.exceeded).toBe(false);
    });

    it('marks exceeded when fanout > 3', () => {
      const record = recordDispatch('provider', 'updateList', 5);
      expect(record.exceeded).toBe(true);
    });

    it('does not mark exceeded when fanout = 3', () => {
      const record = recordDispatch('provider', 'updateList', 3);
      expect(record.exceeded).toBe(false);
    });
  });

  describe('getRecentDispatches', () => {
    it('returns all recorded dispatches', () => {
      recordDispatch('a', 'x', 1);
      recordDispatch('b', 'y', 2);
      expect(getRecentDispatches()).toHaveLength(2);
    });

    it('limits history to 200 entries', () => {
      for (let i = 0; i < 210; i++) {
        recordDispatch('store', `action${i}`, 1);
      }
      expect(getRecentDispatches()).toHaveLength(200);
    });
  });

  describe('getExceededDispatches', () => {
    it('filters only exceeded dispatches', () => {
      recordDispatch('a', 'x', 2);
      recordDispatch('b', 'y', 5);
      recordDispatch('c', 'z', 8);
      expect(getExceededDispatches()).toHaveLength(2);
    });
  });

  describe('getFanoutStats', () => {
    it('computes correct stats', () => {
      recordDispatch('a', 'x', 2);
      recordDispatch('b', 'y', 5);
      recordDispatch('c', 'z', 3);
      const stats = getFanoutStats();
      expect(stats.total).toBe(3);
      expect(stats.exceeded).toBe(1);
      expect(stats.maxFanout).toBe(5);
    });

    it('returns zeros for empty history', () => {
      const stats = getFanoutStats();
      expect(stats.total).toBe(0);
      expect(stats.exceeded).toBe(0);
      expect(stats.maxFanout).toBe(0);
    });
  });
});
