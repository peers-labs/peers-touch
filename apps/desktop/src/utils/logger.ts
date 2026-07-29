import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  tag: string;
  message: string;
  data?: string;
}

const FLUSH_INTERVAL_MS = 150;
const MAX_BUFFER_SIZE = 64;

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

function serializeForLog(data: unknown): string | undefined {
  if (data === undefined) return undefined;
  if (data instanceof Error) {
    return JSON.stringify({
      name: data.name,
      message: data.message,
      stack: data.stack,
    });
  }
  if (typeof data === 'object' && data !== null) {
    return JSON.stringify(data, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  }
  return JSON.stringify(data);
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

function flush(): void {
  flushTimer = null;
  if (buffer.length === 0 || flushInFlight) return;

  const batch = buffer;
  buffer = [];
  flushInFlight = true;

  try {
    invoke('frontend_log_batch', { input: { entries: batch } })
      .catch(() => {
        // Fallback: send individually if batch command not available
        for (const entry of batch) {
          invoke('frontend_log', { input: entry }).catch(() => {});
        }
      })
      .finally(() => {
        flushInFlight = false;
        if (buffer.length > 0) scheduleFlush();
      });
  } catch {
    // Fallback for non-Tauri env
    flushInFlight = false;
    for (const entry of batch) {
      try {
        invoke('frontend_log', { input: entry }).catch(() => {});
      } catch {
        // noop
      }
    }
  }
}

function send(level: LogLevel, tag: string, message: string, data?: unknown) {
  const entry: LogEntry = {
    level,
    tag,
    message,
    data: serializeForLog(data),
  };

  buffer.push(entry);

  if (buffer.length >= MAX_BUFFER_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

export const log = {
  debug: (tag: string, msg: string, data?: unknown) => send('debug', tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => send('info', tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => send('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => send('error', tag, msg, data),
};
