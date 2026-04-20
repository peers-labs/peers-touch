import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
    // Ensure we don't lose Error fields nested inside objects.
    return JSON.stringify(data, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  }
  return JSON.stringify(data);
}

function send(level: LogLevel, tag: string, message: string, data?: unknown) {
  // Project rule: do not use console.* for logging. Use the unified logger pipeline.
  const payload = {
    level,
    tag,
    message,
    data: serializeForLog(data),
  };
  try {
    invoke('frontend_log', { input: payload }).catch(() => {});
  } catch {
    // noop: non-Tauri env or invoke not available
  }
}

export const log = {
  debug: (tag: string, msg: string, data?: unknown) => send('debug', tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => send('info', tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => send('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => send('error', tag, msg, data),
};
