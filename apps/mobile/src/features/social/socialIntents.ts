import type {
  PrivateCommentIntent,
  PrivateCommentPage,
  PrivateCommentSubmitResult,
  PrivateMomentProjection,
  PrivateMomentReadProjection,
  PrivateSocialMomentIntent,
  PrivateSocialTextIntent,
  PrivateSocialWorkerReport,
} from '../../services/mobileCommands';
import type {
  CommandOutcome,
} from '../../services/gateways/gatewayTypes';
import type {
  MomentCreatedResult,
} from '../../services/gateways/momentsGateway';
import type { MobileMomentDraft } from './socialApiTypes';

export interface SocialIntentPort {
  publishPublic(
    draft: MobileMomentDraft,
  ): Promise<CommandOutcome<MomentCreatedResult>>;
  react(postId: string, reactionKind: number): Promise<boolean>;
  comment(
    postId: string,
    content: string,
    replyToCommentId?: string,
  ): Promise<boolean>;
  deleteComment(postId: string, commentId: string): Promise<boolean>;
  retry(): Promise<boolean>;

  publishPrivateText(
    intent: PrivateSocialTextIntent,
  ): Promise<PrivateMomentProjection>;
  publishPrivate(
    intent: PrivateSocialMomentIntent,
  ): Promise<PrivateMomentProjection>;
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
