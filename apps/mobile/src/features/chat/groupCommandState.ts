import type {
  MessagingCommandStatusProjection,
  MessagingConversationProjection,
} from '../../services/mobileCommands';

export type GroupCommandKind =
  | 'create'
  | 'update'
  | 'add-member'
  | 'remove-member'
  | 'update-member'
  | 'transfer-ownership'
  | 'leave'
  | 'dissolve';

export type GroupCommandVisibleState = 'pending' | 'uncertain' | 'failed';

export interface GroupCommandOutcome {
  readonly commandId: string;
  readonly conversationId: string;
  readonly kind: GroupCommandKind;
  readonly state: GroupCommandVisibleState;
  readonly targetPtid?: string;
  readonly expectedName?: string;
  readonly expectedDescription?: string;
  readonly expectedRole?: 'member' | 'admin';
  readonly expectedMuted?: boolean;
  readonly statusReadable: boolean;
  readonly lastErrorCode?: string;
}

export type GroupCommandOutcomes =
  Readonly<Record<string, GroupCommandOutcome>>;

export interface TrackGroupCommandInput {
  readonly commandId: string;
  readonly conversationId: string;
  readonly kind: GroupCommandKind;
  readonly targetPtid?: string;
  readonly expectedName?: string;
  readonly expectedDescription?: string;
  readonly expectedRole?: 'member' | 'admin';
  readonly expectedMuted?: boolean;
  readonly statusReadable?: boolean;
}

export function groupCommandOutcomeKey(
  conversationId: string,
  kind: GroupCommandKind,
  targetPtid = '',
): string {
  return `${conversationId}\u0000${kind}\u0000${targetPtid}`;
}

export function trackGroupCommand(
  outcomes: GroupCommandOutcomes,
  input: TrackGroupCommandInput,
): GroupCommandOutcomes {
  const commandId = input.commandId.trim();
  const conversationId = input.conversationId.trim();
  const targetPtid = input.targetPtid?.trim();
  if (!commandId || !conversationId) {
    throw new Error('mobile.messaging.commandProjectionInvalid');
  }
  return {
    ...outcomes,
    [groupCommandOutcomeKey(conversationId, input.kind, targetPtid)]: {
      ...input,
      commandId,
      conversationId,
      targetPtid,
      state: 'pending',
      statusReadable: input.statusReadable ?? true,
    },
  };
}

export async function refreshGroupCommandOutcomes(
  outcomes: GroupCommandOutcomes,
  conversations: readonly MessagingConversationProjection[],
  actorPtid: string,
  readStatus: (
    commandId: string,
  ) => Promise<MessagingCommandStatusProjection>,
): Promise<GroupCommandOutcomes> {
  const entries = await Promise.all(
    Object.entries(outcomes).map(async ([key, outcome]) => {
      if (isGroupCommandProjected(outcome, conversations, actorPtid)) {
        return [key, null] as const;
      }
      if (!outcome.statusReadable) return [key, outcome] as const;
      try {
        const status = await readStatus(outcome.commandId);
        return [key, outcomeFromStatus(outcome, status)] as const;
      } catch {
        return [
          key,
          { ...outcome, state: 'uncertain' as const },
        ] as const;
      }
    }),
  );

  return Object.fromEntries(
    entries.filter(
      (entry): entry is readonly [string, GroupCommandOutcome] =>
        entry[1] !== null,
    ),
  );
}

export function isGroupCommandProjected(
  outcome: GroupCommandOutcome,
  conversations: readonly MessagingConversationProjection[],
  actorPtid: string,
): boolean {
  const conversation = conversations.find(
    (candidate) =>
      candidate.conversationId === outcome.conversationId
      && candidate.active,
  );
  switch (outcome.kind) {
    case 'create':
      return Boolean(conversation);
    case 'update':
      return Boolean(
        conversation
        && (
          outcome.expectedName === undefined
          || conversation.name === outcome.expectedName
        )
        && (
          outcome.expectedDescription === undefined
          || (conversation.description ?? '') === outcome.expectedDescription
        ),
      );
    case 'add-member':
      return Boolean(
        conversation?.members.some(
          (member) =>
            member.ptid === outcome.targetPtid
            && (
              outcome.expectedRole === undefined
              || member.role === expectedMemberRole(outcome.expectedRole)
            ),
        ),
      );
    case 'remove-member':
      return !conversation || !conversation.memberPtids.includes(outcome.targetPtid ?? '');
    case 'update-member':
      return Boolean(
        conversation?.members.some(
          (member) =>
            member.ptid === outcome.targetPtid
            && (
              outcome.expectedRole === undefined
              || member.role === expectedMemberRole(outcome.expectedRole)
            )
            && (
              outcome.expectedMuted === undefined
              || member.muted === outcome.expectedMuted
            ),
        ),
      );
    case 'transfer-ownership':
      return conversation?.ownerPtid === outcome.targetPtid;
    case 'leave':
      return !conversation || !conversation.memberPtids.includes(actorPtid);
    case 'dissolve':
      return !conversation;
  }
}

export function isGroupCommandBusy(
  outcome: GroupCommandOutcome | undefined,
): boolean {
  return outcome?.state === 'pending' || outcome?.state === 'uncertain';
}

function expectedMemberRole(role: 'member' | 'admin'): number {
  return role === 'admin' ? 2 : 1;
}

function outcomeFromStatus(
  outcome: GroupCommandOutcome,
  status: MessagingCommandStatusProjection,
): GroupCommandOutcome {
  if (
    status.commandId !== outcome.commandId
    || status.conversationId !== outcome.conversationId
  ) {
    return {
      ...outcome,
      state: 'uncertain',
      lastErrorCode: 'mobile.messaging.commandProjectionBindingMismatch',
    };
  }
  switch (status.state) {
    case 'failed':
    case 'superseded':
      return {
        ...outcome,
        state: 'failed',
        lastErrorCode: status.lastErrorCode || undefined,
      };
    case 'retry_wait':
    case 'submitted':
      return {
        ...outcome,
        state: 'uncertain',
        lastErrorCode: status.lastErrorCode || undefined,
      };
    case 'pending':
    case 'committed':
      return {
        ...outcome,
        state: 'pending',
        lastErrorCode: status.lastErrorCode || undefined,
      };
  }
}
