import { invoke } from '@tauri-apps/api/core';
import { redactJsonValue } from '../security/redaction';

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
  const serialized = JSON.stringify(data, (_key, value) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
  });
  if (serialized === undefined) return undefined;
  return JSON.stringify(redactJsonValue(JSON.parse(serialized)));
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
