import { createHash } from 'node:crypto';

export const SNAPSHOT_INTERVAL_MS = 2_000;
export const KEEP_ALIVE_INTERVAL_MS = 10_000;
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_SSE_CLIENTS = 32;

function snapshotDigest(snapshot) {
  return (
    snapshot.digest ??
    createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  );
}

function serializedSnapshot(snapshot, maximumBytes) {
  const payload = JSON.stringify(snapshot);
  if (Buffer.byteLength(payload) > maximumBytes) {
    const error = new Error('Workflow snapshot exceeds the SSE payload budget');
    error.code = 'DEV_SNAPSHOT_TOO_LARGE';
    throw error;
  }
  return payload;
}

function writeEvent(response, event, payload) {
  response.write(`event: ${event}\ndata: ${payload}\n\n`);
}

export function createSnapshotBroker(options) {
  const buildSnapshot = options.buildSnapshot;
  const maximumBytes = options.maximumBytes ?? MAX_SNAPSHOT_BYTES;
  const maximumClients = options.maximumClients ?? MAX_SSE_CLIENTS;
  const intervalMs = options.intervalMs ?? SNAPSHOT_INTERVAL_MS;
  const keepAliveMs = options.keepAliveMs ?? KEEP_ALIVE_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const clients = new Set();
  let inFlight = null;
  let latest = null;
  let latestDigest = null;
  let lastSuccessAt = null;
  let lastErrorCode = null;
  let refreshTimer = null;
  let keepAliveTimer = null;

  function broadcast(event, payload) {
    for (const response of [...clients]) {
      if (response.destroyed || response.writableEnded) {
        clients.delete(response);
        continue;
      }
      try {
        writeEvent(response, event, payload);
      } catch {
        clients.delete(response);
        response.destroy();
      }
    }
  }

  function withStreamState(snapshot, state, errorCode = null) {
    return {
      ...snapshot,
      stream: {
        state,
        lastSuccessAt,
        lastAttemptAt: now().toISOString(),
        errorCode,
      },
    };
  }

  async function refresh() {
    if (inFlight !== null) return inFlight;
    inFlight = Promise.resolve()
      .then(buildSnapshot)
      .then((snapshot) => {
        const digest = snapshotDigest(snapshot);
        const recovering =
          latest?.stream?.state === 'stale' || lastErrorCode !== null;
        lastSuccessAt = now().toISOString();
        lastErrorCode = null;
        latest = withStreamState(snapshot, 'live');
        const payload = serializedSnapshot(latest, maximumBytes);
        if (digest !== latestDigest || recovering) {
          latestDigest = digest;
          broadcast('snapshot', payload);
        }
        return latest;
      })
      .catch((error) => {
        lastErrorCode = error?.code ?? 'DEV_STATUS_UNAVAILABLE';
        if (latest === null) throw error;
        latest = withStreamState(latest, 'stale', lastErrorCode);
        broadcast('snapshot', serializedSnapshot(latest, maximumBytes));
        return latest;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function startTimers() {
    if (refreshTimer !== null) return;
    refreshTimer = setInterval(() => {
      refresh().catch(() => {});
    }, intervalMs);
    keepAliveTimer = setInterval(() => {
      for (const response of [...clients]) {
        if (response.destroyed || response.writableEnded) {
          clients.delete(response);
        } else {
          try {
            response.write(': keep-alive\n\n');
          } catch {
            clients.delete(response);
            response.destroy();
          }
        }
      }
      stopTimersIfIdle();
    }, keepAliveMs);
    refreshTimer.unref?.();
    keepAliveTimer.unref?.();
  }

  function stopTimersIfIdle() {
    if (clients.size > 0) return;
    if (refreshTimer !== null) clearInterval(refreshTimer);
    if (keepAliveTimer !== null) clearInterval(keepAliveTimer);
    refreshTimer = null;
    keepAliveTimer = null;
  }

  async function subscribe(request, response) {
    if (clients.size >= maximumClients) return false;
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.write('retry: 5000\n\n');
    clients.add(response);
    const remove = () => {
      clients.delete(response);
      stopTimersIfIdle();
    };
    request.once('aborted', remove);
    response.once('close', remove);
    const digestBeforeRefresh = latestDigest;
    try {
      const snapshot = await refresh();
      if (
        !response.writableEnded &&
        !response.destroyed &&
        latestDigest === digestBeforeRefresh
      ) {
        writeEvent(
          response,
          'snapshot',
          serializedSnapshot(snapshot, maximumBytes),
        );
      }
    } catch (error) {
      writeEvent(
        response,
        'error',
        JSON.stringify({ code: error?.code ?? 'DEV_STATUS_UNAVAILABLE' }),
      );
      response.end();
      return true;
    }
    startTimers();
    return true;
  }

  function close() {
    for (const response of clients) response.end();
    clients.clear();
    stopTimersIfIdle();
  }

  return {
    close,
    refresh,
    snapshot: refresh,
    subscribe,
    state() {
      return {
        clientCount: clients.size,
        hasSnapshot: latest !== null,
        digest: latestDigest,
        lastSuccessAt,
        lastErrorCode,
      };
    },
  };
}
