import type { ReactNode } from 'react';
import type { Agent, ChannelBindingInfo } from '../../../services/desktop_api';
import { channelAgentLabel } from './channelLabels';

export function ChannelAgentMark({
  agents,
  agentId,
  large = false,
}: {
  agents: Agent[];
  agentId: string;
  large?: boolean;
}) {
  const label = channelAgentLabel(agents, agentId);
  const initials = agentId
    ? label
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
    : '--';
  return (
    <span
      className={`pt-channel-agent-mark${large ? ' is-large' : ''}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function ChannelStatus({
  binding,
  children,
}: {
  binding?: ChannelBindingInfo;
  children?: ReactNode;
}) {
  const state = binding?.enabled === false
    ? 'paused'
    : binding?.connectionState || 'unknown';
  const tone = state === 'connected'
    ? 'positive'
    : state === 'connecting' || state === 'reconnecting'
      ? 'progress'
      : state === 'paused' || state === 'stopped'
        ? 'neutral'
        : 'warning';
  return (
    <span className={`pt-channel-status is-${tone}`} role="status">
      <span aria-hidden="true" />
      {children ?? state}
    </span>
  );
}
