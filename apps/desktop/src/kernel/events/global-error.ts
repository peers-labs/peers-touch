import { log } from '../../utils/logger';

window.addEventListener('error', (e) => {
  const anyE = e as unknown as { error?: unknown };
  const err = anyE?.error;
  log.error('app', 'Uncaught error', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    // Preserve the embedded WebView stack when the event carries an Error.
    error: err instanceof Error ? { message: err.message, stack: err.stack } : undefined,
  });
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  log.error('app', 'Unhandled rejection', {
    reason: String(reason),
    error: reason instanceof Error
      ? { message: reason.message, stack: reason.stack }
      : undefined,
  });
});
