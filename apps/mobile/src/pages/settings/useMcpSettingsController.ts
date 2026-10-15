import { create } from '@bufbuild/protobuf';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { ToolExecutionOwner } from '../../gen/proto/domain/agent/agent_pb';
import { McpServerSchema, McpTransport, type McpServer } from '../../gen/proto/domain/agent/capability_pb';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';
import { createMcpSettingsGateway } from '../../services/gateways/mcpSettingsGateway';
import { secureRandomUuid } from '../../utils/randomIdentity';
import type { SettingsDraftOwner } from './SettingsExitBoundary';
import { useSettingsRequests } from './useSettingsRequests';

export interface McpDraft {
  readonly name: string;
  readonly title: string;
  readonly url: string;
  readonly transport: McpTransport;
  readonly enabled: boolean;
}
const emptyDraft: McpDraft = { name: '', title: '', url: '', transport: McpTransport.HTTP, enabled: true };
const toDraft = (server: McpServer): McpDraft => ({
  name: server.name, title: server.title, url: server.url, transport: server.transport, enabled: server.enabled,
});
const sameDraft = (left: McpDraft, right: McpDraft) => JSON.stringify(left) === JSON.stringify(right);

export function useMcpSettingsController(session: MobileAuthSession | null) {
  const gateway = useMemo(() => session ? createMcpSettingsGateway(session) : null, [session]);
  const requests = useSettingsRequests(gateway);
  const [servers, setServers] = useState<readonly McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [headerDraft, setHeaderDraft] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');
  const readRevision = useRef(0);
  const newId = useRef('');
  const command = useRef<{ fingerprint: string; key: string } | null>(null);
  const selected = servers.find((entry) => entry.serverId === selectedId);
  const dirty = draft !== null && (headerDraft !== '' || !sameDraft(draft, selected ? toDraft(selected) : emptyDraft));
  const localRuntime = !!selected && (selected.transport === McpTransport.STDIO
    || selected.executionOwner === ToolExecutionOwner.CLIENT_CAPABILITY);

  const reload = useCallback(async () => {
    const revision = ++readRevision.current;
    setLoading(true);
    const result = gateway ? await requests.run((signal) => gateway.list(signal)) : null;
    if (revision !== readRevision.current) return;
    if (result) setServers(result.servers);
    setLoading(false);
  }, [gateway, requests.run]);
  useEffect(() => {
    void reload();
    return () => { readRevision.current += 1; };
  }, [reload]);
  const acceptServer = (server: McpServer) => {
    setServers((current) => [...current.filter((entry) => entry.serverId !== server.serverId), server]);
    setSelectedId(server.serverId);
    setDraft(toDraft(server));
    setHeaderDraft('');
    command.current = null;
    setSaveStatus('saved');
  };
  const commandKey = (fingerprint: string) => {
    if (command.current?.fingerprint !== fingerprint) command.current = {
      fingerprint, key: secureRandomUuid('mobile.settings.agent.requestFailed'),
    };
    return command.current.key;
  };
  const select = (id: string | null) => {
    if (requests.busy) return;
    setSelectedId(id);
    const server = servers.find((entry) => entry.serverId === id);
    setDraft(id === '' ? emptyDraft : server ? toDraft(server) : null);
    newId.current = id === '' ? secureRandomUuid('mobile.settings.agent.requestFailed') : '';
    setHeaderDraft('');
    command.current = null;
    setSaveStatus('idle');
    requests.clearError();
  };
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!gateway || !draft || localRuntime) return false;
    const intended = { ...draft, name: draft.name.trim(), title: draft.title.trim(), url: draft.url.trim() };
    const result = await requests.run(async (signal) => {
      let url: URL;
      try { url = new URL(intended.url); } catch { throw new AgentSettingsError(null, 'mobile.settings.mcp.invalidServer'); }
      if (!intended.name || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new AgentSettingsError(null, 'mobile.settings.mcp.invalidServer');
      }
      const headers = parseMcpHeaders(headerDraft);
      const serverId = selected?.serverId ?? newId.current;
      const server = create(McpServerSchema, selected);
      Object.assign(server, { serverId, ...intended, executionOwner: ToolExecutionOwner.STATION });
      const revision = selected?.revision ?? 0n;
      const idempotencyKey = commandKey(`save:${serverId}:${revision}:${JSON.stringify(intended)}:${headerDraft}`);
      try {
        await gateway.upsert({
          server, expectedRevision: revision, idempotencyKey,
          stationSecrets: headers ? { headers } : undefined,
        }, signal);
      } catch (failure) {
        // A lost reply is not evidence that the idempotent write failed.
        if (headers) throw failure;
        const recovered = await gateway.get(serverId, signal);
        if (!recovered.server || !sameDraft(toDraft(recovered.server), intended)) throw failure;
        return recovered.server;
      }
      const readback = await gateway.get(serverId, signal);
      if (!readback.server || !sameDraft(toDraft(readback.server), intended)) throw new AgentSettingsError(409);
      return readback.server;
    }, true);
    if (!result) { setSaveStatus('error'); return false; }
    acceptServer(result);
    return true;
  };
  const refresh = async () => {
    if (!gateway || !selected || dirty) return;
    const result = await requests.run(async (signal) => {
      const response = await gateway.refresh({
        serverId: selected.serverId, expectedRevision: selected.revision,
        idempotencyKey: commandKey(`refresh:${selected.serverId}:${selected.revision}`),
      }, signal);
      if (!response.server) throw new AgentSettingsError(null);
      return response.server;
    }, true);
    if (result) acceptServer(result);
  };
  const remove = async (): Promise<boolean> => {
    if (!gateway || !selected || dirty) return false;
    const result = await requests.run(async (signal) => {
      await gateway.delete({
        serverId: selected.serverId, expectedRevision: selected.revision,
        idempotencyKey: commandKey(`delete:${selected.serverId}:${selected.revision}`),
      }, signal);
      const readback = await gateway.list(signal);
      if (readback.servers.some((entry) => entry.serverId === selected.serverId)) throw new AgentSettingsError(null);
      return readback.servers;
    }, true);
    if (!result) return false;
    setServers(result);
    setSelectedId(null);
    setDraft(null);
    setHeaderDraft('');
    command.current = null;
    return true;
  };
  const owner: SettingsDraftOwner = {
    dirty, conflict: requests.conflict, saveStatus: requests.busy ? 'saving' : saveStatus,
    saveError: requests.error, save, discard: () => select(selectedId === '' ? null : selectedId), reload,
  };
  return { servers, selected, draft, headerDraft, setHeaderDraft, selectedId, loading,
    localRuntime, error: requests.error, busy: requests.busy, owner, select, reload, refresh, remove,
    patch: (patch: Partial<McpDraft>) => {
      if (requests.busy) return;
      setDraft((current) => current ? { ...current, ...patch } : null);
      setSaveStatus('idle');
      requests.clearError();
    },
  };
}

function parseMcpHeaders(value: string): Record<string, string> | null {
  if (!value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const headers: Record<string, string> = {};
    for (const [name, content] of Object.entries(parsed)) {
      if (typeof content !== 'string' || !name.trim() || /[\r\n]/.test(name + content)) throw new Error();
      headers[name] = content;
    }
    return headers;
  } catch { throw new AgentSettingsError(null, 'mobile.settings.mcp.invalidHeaders'); }
}
