import { DevctlError, ERROR_CODES } from './errors.mjs';
import { isPortListening } from './process-adapter.mjs';

export async function probeHttp(url, timeoutMs = 3_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForPort(
  port,
  {
    host = '127.0.0.1',
    timeoutMs = 300_000,
    intervalMs = 500,
    processAlive,
    label = 'runtime',
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processAlive && !processAlive()) {
      throw new DevctlError(
        ERROR_CODES.START_TIMEOUT,
        `${label} exited before opening port ${port}`,
        { host, port },
      );
    }
    if (await isPortListening(port, host)) {
      return { ok: true, host, port };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new DevctlError(
    ERROR_CODES.START_TIMEOUT,
    `${label} did not open port ${port} within ${timeoutMs}ms`,
    { host, port },
  );
}

export async function waitForHttp(
  url,
  {
    timeoutMs = 120_000,
    intervalMs = 500,
    processAlive,
    label = 'runtime',
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    if (processAlive && !processAlive()) {
      throw new DevctlError(
        ERROR_CODES.START_TIMEOUT,
        `${label} exited before becoming ready`,
        { url },
      );
    }
    lastProbe = await probeHttp(url);
    if (lastProbe.ok) {
      return lastProbe;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new DevctlError(
    ERROR_CODES.START_TIMEOUT,
    `${label} did not become ready within ${timeoutMs}ms`,
    { url, lastProbe },
  );
}
