/**
 * AI Settings view models for the Agent prototype (frontend-eles · desktop).
 *
 * The eight sections mirror the production Settings AI group exactly:
 * providers, models, discover, memory, skills, mcp, voice, cron. Shapes follow
 * the real transports (provider store, capability catalog, STT prefs,
 * CronJob) but stay local and deterministic — no Station or device calls.
 */

export type AiSectionId =
  | 'providers' | 'models' | 'discover' | 'memory'
  | 'skills' | 'mcp' | 'voice' | 'cron';

/* ---- providers + models ---------------------------------------------- */

export type ProviderKind = 'direct' | 'cli';
export type ModelKind = 'chat' | 'image' | 'embedding';

export interface ModelRecord {
  id: string;
  name: string;
  kind: ModelKind;
  enabled: boolean;
}

export interface ProviderRecord {
  id: string;
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  models: ModelRecord[];
}

export type Reachability = 'idle' | 'testing' | 'ok' | 'fail';

/* ---- discover / skills / mcp ----------------------------------------- */

export type CatalogPackageType = 'Agent' | 'Skill' | 'MCP';

export interface CatalogPackage {
  id: string;
  name: string;
  publisher: string;
  type: CatalogPackageType;
  installed: boolean;
}

export type SkillSource = 'builtin' | 'peers' | 'user';
export type ScanState = 'passed' | 'warning';

export interface SkillRecord {
  id: string;
  name: string;
  desc: string;
  source: SkillSource;
  scan: ScanState;
  enabled: boolean;
  installed: boolean;
}

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServerRecord {
  id: string;
  name: string;
  transport: McpTransport;
  endpoint: string;
  enabled: boolean;
  toolCount: number;
  tools: string[];
  reachable: Reachability;
}

/* ---- memory ----------------------------------------------------------- */

export type MemoryBackend = 'sqlite' | 'postgres';

/* ---- voice ------------------------------------------------------------ */

export type SttProvider = 'browser' | 'openai';
export type SttLanguage = 'auto' | 'en' | 'zh' | 'ja' | 'ko' | 'fr' | 'de' | 'es';

/* ---- cron ------------------------------------------------------------- */

export type CronScheduleKind = 'cron' | 'interval' | 'once';
export type CronRunStatus = 'ok' | 'error' | 'running' | 'never';

export interface CronJobRecord {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: CronScheduleKind;
  /** Present for scheduleKind === 'cron'. */
  cronExpr: string;
  /** Present for scheduleKind === 'interval', in seconds. */
  intervalSec: number;
  timezone: string;
  prompt: string;
  /** ISO timestamp of the next scheduled run. */
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: CronRunStatus;
  lastError: string;
  consecErrors: number;
}
