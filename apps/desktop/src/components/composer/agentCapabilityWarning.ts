import type { CapabilityReadinessSnapshot } from '../../gen/proto/domain/agent/capability_pb';

export type AgentCapabilityWarningKind = 'image_input_unsupported';

export interface AgentCapabilityWarning {
  kind: AgentCapabilityWarningKind;
  messageKey: string;
  blocking: true;
}

export function selectAgentCapabilityWarning(
  readiness: CapabilityReadinessSnapshot | undefined,
  attachments: ReadonlyArray<{ mime_type: string }>,
): AgentCapabilityWarning | null {
  const hasImage = attachments.some((attachment) =>
    attachment.mime_type.toLowerCase().startsWith('image/'));
  if (hasImage && readiness?.modelCapabilities?.input?.image === false) {
    return {
      kind: 'image_input_unsupported',
      messageKey: 'chat.input.capabilityWarning.imageUnsupported',
      blocking: true,
    };
  }

  return null;
}
