/**
 * Draft interaction wireflow only. No vendor requests or real credentials.
 * Dashboard, Settings and the Shell Agent route consume this single graph.
 */
export type WireActor = 'alice' | 'bob';
export type Connection = 'disconnected' | 'stored' | 'connected' | 'expired';
export interface WireService {
  id: string;
  label: string;
  vendor: string;
  kind: 'cli' | 'api';
  owner: 'station' | WireActor;
  configured: boolean;
  connection: Connection;
  generation: number;
  attempt: 'none' | 'waiting' | 'failed' | 'cancelled' | 'expired';
  deadline: number | null;
  models: { id: string; label: string; verifiedAt: number | null }[];
  grants: Record<WireActor, string[]>;
  issue: string;
  backendId?: string;
  runtime?: { model: string; prompt: string; args: string; environment: string; timeout: number };
}
export interface WireGraph {
  services: WireService[];
  installed: string[];
  installations: Record<string, number>;
  aiActors: WireActor[];
  personalAllowed: boolean;
  offline: boolean;
  defaults: Record<WireActor, string | null>;
  drafts: Record<WireActor, string>;
  replies: Record<WireActor, string>;
  revision: number;
  profileDefaults: Record<string, string>;
}
const KEY = 'peers-model-service-wireflow-draft-v2';
const EVENT = 'peers-model-service-wireflow-changed';
const model = (id: string, label: string) => ({ id, label, verifiedAt: null });
function service(id: string, label: string, vendor: string, kind: 'cli' | 'api'): WireService {
  return {
    id, label, vendor, kind, owner: 'station', configured: kind === 'cli',
    connection: 'disconnected', generation: 1, attempt: 'none', deadline: null,
    models: [], grants: { alice: [], bob: [] }, issue: '',
  };
}
export function initialWireGraph(): WireGraph {
  return {
    services: [
      service('codex', 'Codex', 'codex', 'cli'),
      service('cursor', 'Cursor', 'cursor', 'cli'),
      service('trae', 'TRAE', 'trae', 'cli'),
      service('claude', 'Claude', 'claude', 'cli'),
      service('ark', 'ByteDance Ark', 'ark', 'api'),
    ],
    installed: ['codex', 'trae', 'claude'], installations: {}, aiActors: ['alice', 'bob'], personalAllowed: false, offline: false,
    defaults: { alice: null, bob: null }, drafts: { alice: '', bob: '' },
    replies: { alice: '', bob: '' }, revision: 0, profileDefaults: {},
  };
}
export function isModelWireflow(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('wireflow') === 'model-service';
}
export function loadWireGraph(): WireGraph {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as WireGraph | null;
    if (parsed && Array.isArray(parsed.services) && parsed.defaults && parsed.drafts) return { ...parsed, installations: parsed.installations ?? {}, profileDefaults: parsed.profileDefaults ?? {} };
  } catch { /* A damaged draft is reset, never read as an available service. */ }
  return initialWireGraph();
}
export function changeWireGraph(change: (graph: WireGraph) => WireGraph): void {
  const previous = loadWireGraph();
  const next = { ...change(previous), revision: previous.revision + 1 };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}
export function resetWireGraph(): void {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}
export function subscribeWireGraph(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
function editService(id: string, edit: (item: WireService) => WireService): void {
  changeWireGraph((graph) => ({
    ...graph, services: graph.services.map((item) => item.id === id ? edit(item) : item),
  }));
}
export function serviceStep(graph: WireGraph, item: WireService): number {
  item = resolveWireService(graph, item);
  if (item.kind === 'cli' && !graph.installed.includes(item.vendor)) return 0;
  if (!item.configured || item.connection !== 'connected') return 1;
  if (!item.models.some((entry) => entry.verifiedAt !== null)) return 2;
  if (item.owner === 'station' && !Object.values(item.grants).some((ids) => ids.length > 0)) return 3;
  return 4;
}
export function visibleModels(graph: WireGraph, actor: WireActor) {
  if (!graph.aiActors.includes(actor)) return [];
  return graph.services.flatMap((record) => {
    const item = resolveWireService(graph, record);
    const source = graph.services.find((entry) => entry.id === item.backendId);
    if (item.owner !== 'station' && (item.owner !== actor || !graph.personalAllowed)) return [];
    if (item.connection !== 'connected' || (item.kind === 'cli' && !graph.installed.includes(item.vendor))) return [];
    return item.models.filter((entry) => entry.verifiedAt !== null
      && (item.owner === actor || item.grants[actor].includes(entry.id))
      && (!item.backendId || source?.grants[actor].includes(entry.id)))
      .map((entry) => ({ ...entry, key: `${item.id}:${entry.id}`, serviceId: item.id,
        serviceLabel: item.label, personal: item.owner !== 'station' }));
  });
}
export function installWireRuntime(vendor: string): void {
  const graph = loadWireGraph();
  if (graph.offline || graph.installed.includes(vendor) || graph.installations[vendor]) return;
  changeWireGraph((current) => ({ ...current, installations: { ...current.installations, [vendor]: Date.now() } }));
}
export function advanceWireInstallations(): void {
  const graph = loadWireGraph();
  if (graph.offline || !Object.keys(graph.installations).length) return;
  changeWireGraph((current) => {
    const completed = Object.entries(current.installations)
      .filter(([, started]) => Date.now() - started >= 6000).map(([vendor]) => vendor);
    return { ...current, installed: [...new Set([...current.installed, ...completed])],
      installations: Object.fromEntries(Object.entries(current.installations).filter(([vendor]) => !completed.includes(vendor))) };
  });
}
export function saveWireAPI(id: string): void {
  editService(id, (item) => ({ ...item, configured: true, connection: 'stored',
    generation: item.generation + 1, models: [], issue: '' }));
}
export function beginWireLogin(id: string): void {
  editService(id, (item) => ({ ...item, attempt: 'waiting', deadline: Date.now() + 90_000, issue: '' }));
}
export function finishWireLogin(id: string, result: 'success' | 'failed' | 'cancelled' | 'expired'): void {
  editService(id, (item) => {
    if (item.attempt !== 'waiting' && !(result === 'success' && item.connection === 'stored')) return item;
    if (result !== 'success') return { ...item, attempt: result, deadline: null,
      issue: result === 'failed' ? '授权未完成，请在本服务重试。'
        : result === 'expired' ? '授权已过期，请重新开始。' : '本次授权已取消。' };
    if (item.deadline !== null && Date.now() > item.deadline) return {
      ...item, attempt: 'expired', deadline: null, issue: '授权已过期，请重新开始。',
    };
    return {
      ...item, connection: 'connected', generation: item.generation + 1,
      attempt: 'none', deadline: null, issue: '',
      models: item.kind === 'api'
        ? [model('model-01', '模型 A（目录模拟）'), model('model-02', '模型 B（目录模拟）')]
        : [model('default', '账号默认模型（服务商自动选择）')],
    };
  });
}
export function verifyWireModel(id: string, modelId: string, succeed = true): void {
  editService(id, (item) => {
    item = resolveWireService(loadWireGraph(), item);
    if (item.connection !== 'connected') return item;
    return { ...item, issue: succeed ? '' : '调用失败：演示额度不足。输入与连接已保留，可以重试。',
      models: item.models.map((entry) => entry.id === modelId
        ? { ...entry, verifiedAt: succeed ? Date.now() : null } : entry) };
  });
}
export function resolveWireService(graph: WireGraph, item: WireService): WireService {
  if (!item.backendId) return item;
  const source = graph.services.find((entry) => entry.id === item.backendId && entry.kind === 'api' && entry.owner === item.owner);
  return { ...item, connection: source?.connection === 'connected' ? 'connected' : 'disconnected',
    models: (source?.models || []).map((entry) => ({ ...entry,
      verifiedAt: item.models.find((stored) => stored.id === entry.id)?.verifiedAt ?? null })),
    issue: source?.connection === 'connected' ? item.issue : '模型连接不可用，请管理连接或显式选择其他来源。' };
}
export function addWireProfile(adapter: string, name: string): string {
  const id = `${adapter}-${Date.now()}`;
  changeWireGraph((graph) => ({ ...graph, services: [...graph.services, service(id, name, adapter, 'cli')] }));
  return id;
}
export function saveWireProfile(id: string, label: string, backendId: string, runtime: NonNullable<WireService['runtime']>, revision: number): boolean {
  if (loadWireGraph().services.find((item) => item.id === id)?.generation !== revision) return false;
  editService(id, (item) => ({ ...item, label, backendId, runtime, generation: item.generation + 1,
    models: item.backendId === backendId ? item.models : [], issue: '' }));
  return true;
}
export function defaultWireProfile(adapter: string, id: string): void {
  changeWireGraph((graph) => ({ ...graph, profileDefaults: { ...graph.profileDefaults, [adapter]: id } }));
}
export function removeWireProfile(id: string): void {
  changeWireGraph((graph) => ({ ...graph, services: graph.services.filter((item) => item.id !== id),
    profileDefaults: Object.fromEntries(Object.entries(graph.profileDefaults).filter(([, value]) => value !== id)) }));
}
export function publishWireModels(id: string, actors: WireActor[], ids: string[]): void {
  editService(id, (item) => {
    item = resolveWireService(loadWireGraph(), item);
    const allowed = ids.filter((modelId) => item.models.some((entry) =>
      entry.id === modelId && entry.verifiedAt !== null));
    if (item.owner !== 'station' || item.connection !== 'connected' || !allowed.length) return item;
    return { ...item, grants: {
      alice: actors.includes('alice') ? [...new Set([...item.grants.alice, ...allowed])] : item.grants.alice,
      bob: actors.includes('bob') ? [...new Set([...item.grants.bob, ...allowed])] : item.grants.bob,
    }, issue: '' };
  });
}
export function revokeWireActor(id: string, actor: WireActor): void {
  editService(id, (item) => ({ ...item, grants: { ...item.grants, [actor]: [] } }));
}
export function disconnectWireService(id: string, expired = false): void {
  editService(id, (item) => ({ ...item, connection: expired ? 'expired' : 'disconnected',
    generation: item.generation + 1, attempt: 'none', deadline: null,
    models: item.models.map((entry) => ({ ...entry, verifiedAt: null })),
    issue: expired ? '账号连接已过期，需要所有者重新连接并验证。' : '' }));
}
export function addPersonalWireService(actor: WireActor, vendor: string): string {
  const id = `${vendor}-${actor}`;
  changeWireGraph((graph) => {
    if (!graph.personalAllowed || graph.services.some((item) => item.id === id)) return graph;
    const template = graph.services.find((item) => item.vendor === vendor && item.owner === 'station');
    if (!template) return graph;
    return { ...graph, services: [...graph.services, {
      ...service(id, `${template.label} · 我的账号`, vendor, template.kind), owner: actor,
    }] };
  });
  return id;
}
export function invokeWireModel(actor: WireActor, key: string): void {
  changeWireGraph((graph) => {
    const selected = visibleModels(graph, actor).find((entry) => entry.key === key);
    const reply = graph.offline ? 'Station 暂时离线，请恢复连接后重试。'
      : !selected ? '模型不可用或权限已撤销，请显式选择可用模型。'
      : !graph.drafts[actor].trim() ? '请先输入消息。'
      : `模拟回答：${selected.serviceLabel} 已通过 ${actor === 'alice' ? 'Alice' : 'Bob'} 的当前权限完成调用。`;
    return { ...graph, replies: { ...graph.replies, [actor]: reply } };
  });
}
