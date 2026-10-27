import { describe, expect, it } from 'vitest';
import { parseSchedulePhrase } from './scheduled-task-parser';

describe('parseSchedulePhrase', () => {
  it('parses English and Chinese intervals', () => {
    expect(parseSchedulePhrase('every 30 minutes')).toMatchObject({
      scheduleKind: 'interval',
      intervalSec: 1800,
    });
    expect(parseSchedulePhrase('每 2 小时总结收件箱')).toMatchObject({
      scheduleKind: 'interval',
      intervalSec: 7200,
    });
  });

  it('parses daily times with weekdays', () => {
    expect(parseSchedulePhrase('every weekday at 9am')).toMatchObject({
      scheduleKind: 'cron',
      cronExpr: '00 09 * * 1-5',
    });
    expect(parseSchedulePhrase('every monday at 5:30 pm')).toMatchObject({
      scheduleKind: 'cron',
      cronExpr: '30 17 * * 1',
    });
    expect(parseSchedulePhrase('每天下午3点')).toMatchObject({
      scheduleKind: 'cron',
      cronExpr: '00 15 * * *',
    });
    expect(parseSchedulePhrase('周一早上9点半')).toMatchObject({
      scheduleKind: 'cron',
      cronExpr: '30 09 * * 1',
    });
  });

  it('parses tomorrow one-shot as a future RFC3339 instant', () => {
    const parsed = parseSchedulePhrase('tomorrow at 8am');
    expect(parsed?.scheduleKind).toBe('once');
    expect(parsed?.runAt).toBeTruthy();
    const instant = new Date(parsed!.runAt!).getTime();
    expect(instant).toBeGreaterThan(Date.now());
    expect(instant).toBeLessThan(Date.now() + 36 * 3600_000);
  });

  it('rejects unsupported phrases and sub-minute intervals', () => {
    expect(parseSchedulePhrase('whenever you feel like it')).toBeNull();
    expect(parseSchedulePhrase('every 30 seconds')).toBeNull();
    expect(parseSchedulePhrase('')).toBeNull();
  });
});
