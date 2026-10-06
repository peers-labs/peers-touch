import type {
  PrivateCommentIntent,
  PrivateCommentPage,
  PrivateCommentSubmitResult,
  PrivateMomentFileIntent,
  PrivateMomentProjection,
  PrivateMomentReadProjection,
  PrivateSocialWorkerReport,
} from '../../services/mobileCommands';
import type {
  CommandOutcome,
} from '../../services/gateways/gatewayTypes';
import type {
  CommentCreatedResult,
  CommentsPage,
  MomentCreatedResult,
  ReactionToggleResult,
} from '../../services/gateways/momentsGateway';
import type { MobileMomentDraft } from './socialApiTypes';

export interface SocialMomentPublishIntent {
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draft: MobileMomentDraft;
  readonly privateFiles?: readonly PrivateMomentFileIntent[];
}

export type SocialMomentPublishResult =
  | {
    readonly route: 'PUBLIC';
    readonly outcome: CommandOutcome<MomentCreatedResult>;
  }
  | {
    readonly route: 'PRIVATE';
    readonly projection: PrivateMomentProjection;
  };

export interface SocialIntentPort {
  refreshPublicFeed(scope?: 'home' | 'explore'): Promise<boolean>;
  publishMoment(intent: SocialMomentPublishIntent): Promise<SocialMomentPublishResult>;
  setPublicReaction(
    postId: string,
    reactionKind: number,
    active: boolean,
  ): Promise<CommandOutcome<ReactionToggleResult>>;
  createPublicComment(
    postId: string,
    content: string,
    replyToCommentId?: string,
  ): Promise<CommandOutcome<CommentCreatedResult>>;
  readPublicComments(
    postId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CommandOutcome<CommentsPage>>;
  react(postId: string, reactionKind: number): Promise<boolean>;
  comment(
    postId: string,
    content: string,
    replyToCommentId?: string,
  ): Promise<boolean>;
  deleteComment(postId: string, commentId: string): Promise<boolean>;
  retry(): Promise<boolean>;

  readPrivate(postId: string): Promise<PrivateMomentReadProjection>;
  openPrivateMedia(
    postId: string,
    objectId: string,
  ): Promise<PrivateMomentReadProjection>;
  recoverPrivate(postId: string): Promise<PrivateMomentReadProjection>;
  submitPrivateComment(
    intent: PrivateCommentIntent,
  ): Promise<PrivateCommentSubmitResult>;
  readPrivateComments(
    postId: string,
    cursor?: string,
    limit?: number,
  ): Promise<PrivateCommentPage>;
  storeRecoveryPhrase(recoveryPhrase: string, recoveryEpoch?: number): Promise<void>;
  reconcilePrivate(): Promise<PrivateSocialWorkerReport | null>;
}
