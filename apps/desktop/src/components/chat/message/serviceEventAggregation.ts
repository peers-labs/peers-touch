import type { DesktopServiceMessage } from '../../../store/socialProjection';
import type { ChatMessage } from './chatMessageModel';

const TERMINAL_STATES = new Set([4, 5, 6]);

export interface ServiceEventAggregation {
  key: string;
  knownCount: number;
  conflicting: boolean;
  knownHistoryOnly: true;
  expanded: boolean;
  effective: DesktopServiceMessage;
}

export interface AggregatedChatMessage<T extends ChatMessage = ChatMessage> {
  message: T;
  aggregation?: ServiceEventAggregation;
}

export function serviceAggregationKey(message: ChatMessage): string {
  const service = message.serviceMessage;
  const primary = service?.content?.primary;
  const subject = primary?.subject;
  if (
    !service
    ||
    primary?.kind !== 'event'
    || !primary.taskState
    || !subject?.kind
    || !subject.id
    || !subject.executionId
  ) return '';
  return [
    service.senderPtid,
    service.sourceNamespace,
    subject.kind,
    subject.id,
    subject.executionId,
  ].join('\u0000');
}

function effectiveServiceMessage(messages: readonly ChatMessage[]): {
  effective: DesktopServiceMessage;
  conflicting: boolean;
} {
  const services = messages
    .map(message => message.serviceMessage)
    .filter((service): service is DesktopServiceMessage => Boolean(service));
  let effective = services[0];
  let effectiveRevision = BigInt(effective.content?.primary?.taskState?.revision ?? '0');
  let terminalSeen = TERMINAL_STATES.has(
    effective.content?.primary?.taskState?.state ?? 0,
  );
  let conflicting = false;
  const statesByRevision = new Map<string, number>();

  for (const service of services) {
    const task = service.content?.primary?.taskState;
    if (!task) continue;
    const prior = statesByRevision.get(task.revision);
    if (prior !== undefined && prior !== task.state) conflicting = true;
    statesByRevision.set(task.revision, task.state);

    const revision = BigInt(task.revision);
    if (TERMINAL_STATES.has(task.state)) {
      terminalSeen = true;
    } else if (terminalSeen) {
      conflicting = true;
      continue;
    }
    if (revision > effectiveRevision) {
      effective = service;
      effectiveRevision = revision;
    }
  }
  return { effective, conflicting };
}

export function aggregateServiceEvents<T extends ChatMessage>(
  messages: readonly T[],
  expandedKeys: ReadonlySet<string> = new Set(),
): AggregatedChatMessage<T>[] {
  const groups = new Map<string, T[]>();
  for (const message of messages) {
    const key = serviceAggregationKey(message);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(message);
    groups.set(key, group);
  }

  const result: AggregatedChatMessage<T>[] = [];
  for (const message of messages) {
    const key = serviceAggregationKey(message);
    const group = key ? groups.get(key) : undefined;
    if (!group || group.length < 2) {
      result.push({ message });
      continue;
    }
    const latest = group[group.length - 1];
    const expanded = expandedKeys.has(key);
    if (!expanded && message !== latest) continue;
    let aggregation: ServiceEventAggregation | undefined;
    if (message === latest) {
      const resolved = effectiveServiceMessage(group);
      aggregation = {
        key,
        knownCount: group.length,
        conflicting: resolved.conflicting,
        knownHistoryOnly: true as const,
        expanded,
        effective: resolved.effective,
      };
    }
    result.push({ message, aggregation });
  }
  return result;
}
