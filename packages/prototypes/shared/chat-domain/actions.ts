/**
 * Message action catalog — the protocol-aligned vocabulary every surface
 * derives its menu (desktop) or action sheet (mobile) from. Presentation
 * groups and icons stay with each surface; this module only owns:
 *
 *  - which actions exist and how they map to model/domain/chat commands
 *  - ownership (own message / peer message / group moderator)
 *  - grouping and danger semantics
 *  - the i18n label key and the peers-ui semantic glyph id
 *
 * Protocol annotations reference model/domain/chat/command.proto oneof.
 * `localOnly` marks actions with no protocol object (pure client behavior).
 */
import type { ReactionKind } from './reactions';

export type MessageActionId =
  | 'reply'
  | 'thread'
  | 'forward'
  | 'copy'
  | 'pin'
  | 'multiselect'
  | 'mark-later'
  | 'edit'
  | 'recall'
  | 'report'
  | 'moderate'
  | 'hide';

/** Groups render in this order; a surface inserts dividers between them. */
export type MessageActionGroup = 'primary' | 'organize' | 'mutate' | 'safety';

export interface MessageActionDescriptor {
  readonly id: MessageActionId;
  readonly group: MessageActionGroup;
  /** Available on messages the viewer sent. */
  readonly own: boolean;
  /** Available on peer messages. */
  readonly peer: boolean;
  readonly danger?: boolean;
  /** Proto command oneof member; absent for pure-client actions. */
  readonly protocol?: string;
  /** Action changes this device only and has no wire command. */
  readonly localOnly?: boolean;
  /** Requires group moderation capability in the conversation. */
  readonly moderatorOnly?: boolean;
  readonly labelKey: string;
  /** Registered peers-ui glyph id; desktop maps it to its own icon set. */
  readonly iconId: string;
}

export const MESSAGE_ACTION_CATALOG: readonly MessageActionDescriptor[] = [
  { id: 'thread', group: 'primary', own: true, peer: true, localOnly: true,
    labelKey: 'action.thread', iconId: 'message-square' },
  { id: 'pin', group: 'organize', own: true, peer: false, protocol: 'PinMessageCommand',
    labelKey: 'action.pinMsg', iconId: 'pin' },
  { id: 'copy', group: 'organize', own: true, peer: true, localOnly: true,
    labelKey: 'action.copyText', iconId: 'copy' },
  { id: 'multiselect', group: 'organize', own: true, peer: true, localOnly: true,
    labelKey: 'action.multiselect', iconId: 'list-checks' },
  {
    /** Personal "mark for later": local-only, visible to nobody else. */
    id: 'mark-later', group: 'organize', own: true, peer: true, localOnly: true,
    labelKey: 'action.markLater', iconId: 'bookmark',
  },
  { id: 'edit', group: 'mutate', own: true, peer: false, protocol: 'EditMessageIntent',
    labelKey: 'action.edit', iconId: 'edit-note' },
  { id: 'recall', group: 'mutate', own: true, peer: false, protocol: 'RetractMessageIntent',
    labelKey: 'action.recall', iconId: 'rotate-ccw' },
  { id: 'report', group: 'safety', own: false, peer: true, protocol: 'ModerateMessageIntent',
    labelKey: 'action.report', iconId: 'flag' },
  { id: 'moderate', group: 'safety', own: false, peer: true, moderatorOnly: true,
    protocol: 'ModerateMessageIntent', labelKey: 'action.moderate', iconId: 'shield-x' },
  { id: 'hide', group: 'safety', own: true, peer: true, danger: true, localOnly: true,
    protocol: 'HideMessageForActorIntent', labelKey: 'action.hideForMe', iconId: 'eye-off' },
];

/** Quick reply/forward actions live outside the long-tail catalog (both own+peer). */
export const QUICK_ACTION_IDS = ['reply', 'forward'] as const;
export type QuickActionId = (typeof QUICK_ACTION_IDS)[number];

export interface MessageActionContext {
  readonly mine: boolean;
  readonly canModerate: boolean;
  readonly hasText: boolean;
  /** Edit/recall only inside the protocol mutation window. */
  readonly inMutationWindow: boolean;
}

export interface ResolvedAction extends MessageActionDescriptor {
  /** When false the action renders disabled with this reason key. */
  readonly enabled: boolean;
  readonly disabledReasonKey?: string;
}

export const GROUP_ORDER: readonly MessageActionGroup[] = ['primary', 'organize', 'mutate', 'safety'];

/**
 * Resolve the ordered, grouped action list for one message. Both surfaces
 * consume this so neither can grow a private action or drift in ownership.
 */
export function messageActionGroups(context: MessageActionContext): {
  readonly group: MessageActionGroup;
  readonly actions: readonly ResolvedAction[];
}[] {
  const resolve = (descriptor: MessageActionDescriptor): ResolvedAction | null => {
    if (context.mine && !descriptor.own) return null;
    if (!context.mine && !descriptor.peer) return null;
    if (descriptor.moderatorOnly && !context.canModerate) return null;
    let enabled = true;
    let disabledReasonKey: string | undefined;
    if (descriptor.id === 'copy' && !context.hasText) {
      enabled = false;
      disabledReasonKey = 'action.noText';
    }
    if ((descriptor.id === 'edit' || descriptor.id === 'recall') && !context.inMutationWindow) {
      enabled = false;
      disabledReasonKey = 'action.windowReason';
    }
    if (descriptor.id === 'edit' && context.inMutationWindow && !context.hasText) {
      enabled = false;
      disabledReasonKey = 'action.textOnly';
    }
    return { ...descriptor, enabled, disabledReasonKey };
  };

  return GROUP_ORDER
    .map(group => ({
      group,
      actions: MESSAGE_ACTION_CATALOG
        .filter(descriptor => descriptor.group === group)
        .map(resolve)
        .filter((action): action is ResolvedAction => action !== null),
    }))
    .filter(entry => entry.actions.length > 0);
}

/** ModerateMessageIntent reason codes, shared by desktop dialog and mobile sheet. */
export const REPORT_REASONS = ['spam', 'abuse', 'misinfo', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const reportReasonKey = (reason: ReportReason): string => `report.reason.${reason}`;

export type { ReactionKind };
