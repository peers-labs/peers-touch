import type { AvailableModel } from '../../services/desktop_api';
export type AgentCapabilityWarningKind =
  | 'model_unavailable'
  | 'image_input_unsupported';

export interface AgentCapabilityWarning {
  kind: AgentCapabilityWarningKind;
  messageKey: string;
  blocking: true;
}

export function selectAgentCapabilityWarning(
  model: AvailableModel | undefined,
  attachments: ReadonlyArray<{ mime_type: string }>,
): AgentCapabilityWarning | null {
  if (model && !model.enabled) {
    return {
      kind: 'model_unavailable',
      messageKey: 'chat.input.capabilityWarning.modelUnavailable',
      blocking: true,
    };
  }

  const hasImage = attachments.some((attachment) =>
    attachment.mime_type.toLowerCase().startsWith('image/'));
  if (hasImage && model?.vision === false) {
    return {
      kind: 'image_input_unsupported',
      messageKey: 'chat.input.capabilityWarning.imageUnsupported',
      blocking: true,
    };
  }

  return null;
}
