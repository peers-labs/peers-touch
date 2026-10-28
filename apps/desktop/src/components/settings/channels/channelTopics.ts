import type { ChannelBindingInfo } from '../../../services/desktop_api';
import type { ChannelDetailProjection } from '../../../store/channel';

// boundTopicAgentIds collects the distinct Agents whose Station
// conversations can appear in the Channel Topics read-only projection: the
// connection's default responder, every routing rule, and every automation.
export function boundTopicAgentIds(
  binding: ChannelBindingInfo,
  detail: ChannelDetailProjection | null,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (agentId: string | undefined | null) => {
    const id = agentId?.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  add(binding.agentId);
  for (const route of detail?.routes ?? []) {
    add(route.agentId);
  }
  for (const automation of detail?.automations ?? []) {
    add(automation.agentId);
  }
  return ids;
}

// formatTopicDate renders Station RFC3339 conversation timestamps; an
// unparseable value stays hidden rather than showing "Invalid Date".
export function formatTopicDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toLocaleString();
}
