import { log } from '../../utils/logger';

window.addEventListener('error', (e) => {
  log.error('app', 'Uncaught error', { message: e.message, filename: e.filename, lineno: e.lineno });
});

window.addEventListener('unhandledrejection', (e) => {
  log.error('app', 'Unhandled rejection', { reason: String(e.reason) });
});
