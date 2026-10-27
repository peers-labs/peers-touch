import type { CronScheduleParsed } from './desktop_api';

// Local deterministic natural-language schedule parser ported from the
// Settings prototype. It intentionally takes no cron library dependency:
// Chinese and English interval/time/weekday phrases map to the same
// Station-supported schedule kinds (cron / interval / once).

const WEEKDAY_ZH: Record<string, number> = {
  日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
};

const WEEKDAY_EN: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function clockFromEnglish(input: string): { hour: number; minute: number } | null {
  const match = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3] === 'pm') hour += 12;
  return { hour, minute: match[2] ? Number(match[2]) : 0 };
}

function clockFromChinese(input: string): { hour: number; minute: number } | null {
  const match = input.match(/(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:：](\d{1,2}))?\s*(点|时)(半)?/);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = match[3] ? Number(match[3]) : match[5] ? 30 : 0;
  const period = match[1] ?? '';
  if (/下午|晚上/.test(period) && hour < 12) hour += 12;
  if (/中午/.test(period) && hour < 12) hour = 12;
  if (/凌晨|早上|上午/.test(period) && hour === 12) hour = 0;
  return { hour, minute };
}

// parseOnceAt recognizes "tomorrow at 9am" / "明天下午3点" and emits the
// RFC3339 instant in the local timezone.
function parseOnceAt(input: string, clock: { hour: number; minute: number }): string | null {
  const isTomorrow = /tomorrow|明天|明晚|明早/.test(input);
  const isToday = /today|今晚|今天|今日/.test(input);
  if (!isTomorrow && !isToday) return null;
  const date = new Date();
  if (isTomorrow) date.setDate(date.getDate() + 1);
  date.setHours(clock.hour, clock.minute, 0, 0);
  return date.toISOString();
}

/**
 * Parse a free-form schedule phrase. Returns null when no schedule can be
 * recognized. The optional `task` field carries the non-schedule remainder
 * that the drawer can prefill as the job prompt/name.
 */
export function parseSchedulePhrase(raw: string): (CronScheduleParsed & { task?: string }) | null {
  const input = raw.trim().toLowerCase();
  if (!input) return null;

  const interval = input.match(/(?:every|each|每)\s*(\d+)?\s*(minutes?|mins?|hours?|分钟|小时)/);
  if (interval) {
    const step = interval[1] ? Number(interval[1]) : 1;
    const seconds = (/hour|小时/.test(interval[2]) ? step * 3600 : step * 60);
    if (seconds < 60) return null;
    return {
      scheduleKind: 'interval',
      intervalSec: seconds,
      timezone: 'UTC',
    };
  }

  const clock = clockFromEnglish(input) ?? clockFromChinese(input);
  if (!clock) return null;

  const onceAt = parseOnceAt(input, clock);
  if (onceAt) {
    return { scheduleKind: 'once', runAt: onceAt, timezone: 'UTC' };
  }

  const weekdays = /weekday|work ?day|每个?工作日/.test(input);
  const namedDay = input.match(
    /(?:every\s*)?(?:on\s*)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/,
  );
  const zhDay = input.match(/周([日一二三四五六])|星期([日一二三四五六])/);
  let dow = '*';
  if (weekdays) dow = '1-5';
  else if (namedDay) dow = String(WEEKDAY_EN[namedDay[1]]);
  else if (zhDay) dow = String(WEEKDAY_ZH[zhDay[1] ?? zhDay[2] ?? '']);

  const minute = String(clock.minute).padStart(2, '0');
  const hour = String(clock.hour).padStart(2, '0');
  return {
    scheduleKind: 'cron',
    cronExpr: `${minute} ${hour} * * ${dow}`,
    timezone: 'UTC',
  };
}
