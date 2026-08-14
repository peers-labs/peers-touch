// Evaluation system store — manages datasets and benchmark runs for agent quality testing.
// Part of P3-M4 "Evaluation System".

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { api } from '../services/desktop_api';

// ── Domain types ──

export interface EvalDatasetItem {
  id: string;
  input: string;
  expectedOutput: string;
  tags: string[];
}

export interface EvalDataset {
  id: string;
  name: string;
  description: string;
  items: EvalDatasetItem[];
  createdAt: number;
}

export interface EvalRunResult {
  itemId: string;
  actualOutput: string;
  passed: boolean;
  latencyMs: number;
}

export interface EvalRun {
  id: string;
  datasetId: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: EvalRunResult[];
  startedAt: number;
  completedAt?: number;
  metrics: { accuracy: number; avgLatency: number };
}

// ── Persistence helpers ──

const STORAGE_KEY = 'peers-eval-datasets';

function loadDatasetsFromStorage(): EvalDataset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EvalDataset[];
  } catch {
    log.warn('evaluation', 'failed to parse stored datasets');
    return [];
  }
}

function saveDatasetsToStorage(datasets: EvalDataset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
  } catch {
    log.warn('evaluation', 'failed to persist datasets');
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Store interface ──

interface EvaluationState {
  datasets: EvalDataset[];
  runs: EvalRun[];
  activeRunId: string | null;

  // Dataset CRUD
  loadDatasets: () => void;
  createDataset: (name: string, description: string) => EvalDataset;
  updateDataset: (id: string, updates: Partial<Pick<EvalDataset, 'name' | 'description'>>) => void;
  deleteDataset: (id: string) => void;
  addItem: (datasetId: string, item: Omit<EvalDatasetItem, 'id'>) => void;
  removeItem: (datasetId: string, itemId: string) => void;
  updateItem: (datasetId: string, itemId: string, updates: Partial<Omit<EvalDatasetItem, 'id'>>) => void;

  // Run management
  startRun: (datasetId: string, agentId: string) => Promise<void>;
  cancelRun: (runId: string) => void;
}

export const useEvaluationStore = createDesktopStore<EvaluationState>('evaluation', (set, get) => ({
  datasets: [],
  runs: [],
  activeRunId: null,

  loadDatasets: () => {
    const datasets = loadDatasetsFromStorage();
    set({ datasets });
  },

  createDataset: (name, description) => {
    const dataset: EvalDataset = {
      id: generateId(),
      name,
      description,
      items: [],
      createdAt: Date.now(),
    };
    const datasets = [...get().datasets, dataset];
    set({ datasets });
    saveDatasetsToStorage(datasets);
    return dataset;
  },

  updateDataset: (id, updates) => {
    const datasets = get().datasets.map((d) => (d.id === id ? { ...d, ...updates } : d));
    set({ datasets });
    saveDatasetsToStorage(datasets);
  },

  deleteDataset: (id) => {
    const datasets = get().datasets.filter((d) => d.id !== id);
    set({ datasets });
    saveDatasetsToStorage(datasets);
  },

  addItem: (datasetId, item) => {
    const newItem: EvalDatasetItem = { ...item, id: generateId() };
    const datasets = get().datasets.map((d) =>
      d.id === datasetId ? { ...d, items: [...d.items, newItem] } : d,
    );
    set({ datasets });
    saveDatasetsToStorage(datasets);
  },

  removeItem: (datasetId, itemId) => {
    const datasets = get().datasets.map((d) =>
      d.id === datasetId ? { ...d, items: d.items.filter((i) => i.id !== itemId) } : d,
    );
    set({ datasets });
    saveDatasetsToStorage(datasets);
  },

  updateItem: (datasetId, itemId, updates) => {
    const datasets = get().datasets.map((d) =>
      d.id === datasetId
        ? { ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)) }
        : d,
    );
    set({ datasets });
    saveDatasetsToStorage(datasets);
  },

  startRun: async (datasetId, agentId) => {
    const dataset = get().datasets.find((d) => d.id === datasetId);
    if (!dataset || dataset.items.length === 0) {
      log.warn('evaluation', 'cannot start run: dataset empty or not found', { datasetId });
      return;
    }

    const run: EvalRun = {
      id: generateId(),
      datasetId,
      agentId,
      status: 'running',
      results: [],
      startedAt: Date.now(),
      metrics: { accuracy: 0, avgLatency: 0 },
    };

    set({ runs: [...get().runs, run], activeRunId: run.id });

    const results: EvalRunResult[] = [];

    for (const item of dataset.items) {
      // Check if run was cancelled
      const currentRun = get().runs.find((r) => r.id === run.id);
      if (!currentRun || currentRun.status === 'failed') break;

      const start = performance.now();
      try {
        const actualOutput = await api.quickCompletion(agentId, item.input);
        const latencyMs = Math.round(performance.now() - start);
        const passed = actualOutput.trim().toLowerCase().includes(item.expectedOutput.trim().toLowerCase());

        results.push({ itemId: item.id, actualOutput, passed, latencyMs });
      } catch (err) {
        const latencyMs = Math.round(performance.now() - start);
        results.push({
          itemId: item.id,
          actualOutput: err instanceof Error ? err.message : 'unknown error',
          passed: false,
          latencyMs,
        });
      }

      // Update run results incrementally
      const passedCount = results.filter((r) => r.passed).length;
      const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
      const updatedRun: EvalRun = {
        ...run,
        results: [...results],
        metrics: {
          accuracy: results.length > 0 ? passedCount / results.length : 0,
          avgLatency: results.length > 0 ? Math.round(totalLatency / results.length) : 0,
        },
      };
      set({ runs: get().runs.map((r) => (r.id === run.id ? updatedRun : r)) });
    }

    // Mark completed
    const passedCount = results.filter((r) => r.passed).length;
    const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
    const completedRun: EvalRun = {
      ...run,
      status: 'completed',
      results,
      completedAt: Date.now(),
      metrics: {
        accuracy: results.length > 0 ? passedCount / results.length : 0,
        avgLatency: results.length > 0 ? Math.round(totalLatency / results.length) : 0,
      },
    };
    set({
      runs: get().runs.map((r) => (r.id === run.id ? completedRun : r)),
      activeRunId: null,
    });
    log.info('evaluation', 'run completed', { runId: run.id, accuracy: completedRun.metrics.accuracy });
  },

  cancelRun: (runId) => {
    const runs = get().runs.map((r) =>
      r.id === runId && r.status === 'running' ? { ...r, status: 'failed' as const, completedAt: Date.now() } : r,
    );
    set({ runs, activeRunId: get().activeRunId === runId ? null : get().activeRunId });
  },
}));
