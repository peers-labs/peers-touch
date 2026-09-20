import { parentPort, workerData } from 'node:worker_threads';

import { buildDevSnapshot } from './status.mjs';

try {
  parentPort.postMessage({
    ok: true,
    snapshot: await buildDevSnapshot(workerData),
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: error.code ?? 'DEV_STATUS_UNAVAILABLE',
      message: 'Development status is unavailable',
    },
  });
}
