/// <reference types="vite/client" />
import packageJson from '../package.json';
import {
  emptyAdvancedProjection,
  type AdvancedSettingsProjection,
  type StorageMeasurement,
} from './advancedSettingsAdapter';

declare const __PT_PROTOTYPE_SOURCE_COMMIT__: string;

/** Explicit QA fixture. Default entry has no invented installed inventory. */
export function advancedSettingsScenario(): {
  projection: AdvancedSettingsProjection;
  failFirstCommand: boolean;
  cleanupMeasurement?: StorageMeasurement;
} {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('settings-fixture') ?? 'empty';
  const projection = emptyAdvancedProjection({
    version: packageJson.version,
    platform: navigator.platform || 'unknown',
    runtime: 'browser',
    buildMode: import.meta.env.DEV ? 'development' : 'production',
    sourceCommit: typeof __PT_PROTOTYPE_SOURCE_COMMIT__ === 'string'
      ? __PT_PROTOTYPE_SOURCE_COMMIT__ : 'unknown',
  });
  if (scenario === 'loading' || scenario === 'error') {
    for (const section of Object.keys(projection.states)) {
      projection.states[section as keyof typeof projection.states] = scenario;
    }
  }
  if (scenario !== 'sample' && scenario !== 'failure') {
    return { projection, failFirstCommand: false };
  }
  projection.storage = {
    revision: 'fixture-measurement-1', measuredAt: '2026-10-16T00:00:00Z',
    physicalTotalBytes: 8192, messageBytes: 4096, mediaBytes: 2048,
    cacheBytes: 1024, systemBytes: 1024, retention: 'forever',
  };
  projection.files = [
    { id: 'fixture-file-1', name: 'Meeting notes with a long multilingual title · 工作记录.txt', size: 2048, visibility: 'private', expires_at: '2026-12-01T00:00:00Z', deleted_at: null },
    { id: 'fixture-file-2', name: 'Archived.txt', size: 512, visibility: 'private', expires_at: null, deleted_at: '2026-10-15T00:00:00Z' },
  ];
  projection.logs = [
    { id: 1, raw: 'level=info pkg=storage msg="Measurement completed"', level: 'info', source: 'storage', message: 'Measurement completed' },
    { id: 2, raw: 'level=error pkg=channels msg="Connection unavailable"', level: 'error', source: 'channels', message: 'Connection unavailable' },
  ];
  projection.logCursor = 2;
  // Recovery cannot be synthesized without its encrypted runtime.
  projection.memoryExport = { available: true, records: [] };
  return {
    projection,
    failFirstCommand: scenario === 'failure',
    cleanupMeasurement: {
      ...projection.storage, revision: 'fixture-measurement-2',
      physicalTotalBytes: 7168, cacheBytes: 0,
    },
  };
}
