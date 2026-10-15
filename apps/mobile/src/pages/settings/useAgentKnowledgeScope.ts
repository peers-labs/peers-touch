import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { Agent } from '../../gen/proto/domain/agent/agent_pb';
import { createAgentKnowledgeGateway } from '../../services/gateways/agentKnowledgeGateway';
import { useSettingsRequests } from './useSettingsRequests';

export function useAgentKnowledgeScope(session: MobileAuthSession | null) {
  const gateway = useMemo(() => session ? createAgentKnowledgeGateway(session) : null, [session]);
  const requests = useSettingsRequests(gateway);
  const [agents, setAgents] = useState<readonly Agent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [loading, setLoading] = useState(true);
  const readRevision = useRef(0);
  const loadAgents = useCallback(async () => {
    const revision = ++readRevision.current;
    setLoading(true);
    if (!gateway) { setLoading(false); return; }
    const result = await requests.run(async (signal) => {
      const entries: Agent[] = [];
      for (let page = 1; ; page += 1) {
        const response = await gateway.listAgents(page, signal);
        entries.push(...response.agents);
        if (entries.length >= response.total || response.agents.length === 0) break;
      }
      return entries;
    });
    if (revision !== readRevision.current) return;
    if (result) {
      setAgents(result);
      setAgentId((current) => result.some((entry) => entry.agentId === current) ? current : result[0]?.agentId ?? '');
    }
    setLoading(false);
  }, [gateway, requests.run]);
  useEffect(() => {
    void loadAgents();
    return () => { readRevision.current += 1; };
  }, [loadAgents]);
  return { gateway, agents, agentId, setAgentId, loading, loadAgents, requests };
}
