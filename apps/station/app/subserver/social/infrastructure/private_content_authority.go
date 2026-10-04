package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GORMPrivateAudienceAuthority struct {
	db *gorm.DB
}

func NewGORMPrivateAudienceAuthority(
	db *gorm.DB,
) (*GORMPrivateAudienceAuthority, error) {
	if db == nil {
		return nil, fmt.Errorf("Social private audience authority requires a database")
	}
	return &GORMPrivateAudienceAuthority{db: db}, nil
}

// ResolveAcceptedFriendFederation returns the immutable Federation identity
// carried by the accepted Social relationship between two remote peers.
func (a *GORMPrivateAudienceAuthority) ResolveAcceptedFriendFederation(
	ctx context.Context,
	authorPTID string,
	recipientPTID string,
	sourceStationPeerID string,
	targetStationPeerID string,
) (string, error) {
	const operation = "social.private_content.resolve_friend_federation"
	for field, value := range map[string]string{
		"author_ptid":                    authorPTID,
		"recipient_ptid":                 recipientPTID,
		"source_home_station_peer_id":    sourceStationPeerID,
		"recipient_home_station_peer_id": targetStationPeerID,
	} {
		if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) {
			return "", socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				field,
				"must be canonical",
			)
		}
	}
	var relationship federatedRelationshipProjectionModel
	if err := a.db.WithContext(ctx).
		Where("owner_ptid = ? AND peer_ptid = ?", authorPTID, recipientPTID).
		First(&relationship).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				"recipient_ptid",
				"is not an accepted friend",
			)
		}
		return "", err
	}
	var request federatedFriendRequestProjectionModel
	if err := a.db.WithContext(ctx).
		Where(
			"request_id = ? AND state = ? AND authority_confirmed = ?",
			relationship.RequestID,
			friendRequestPolicyRelationshipAccepted,
			true,
		).
		First(&request).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				"friend_request",
				"is not authoritatively accepted",
			)
		}
		return "", err
	}
	direct := request.SenderPTID == authorPTID &&
		request.ReceiverPTID == recipientPTID &&
		request.SenderHomeStationPeerID == sourceStationPeerID &&
		request.ReceiverHomeStationPeerID == targetStationPeerID
	reverse := request.ReceiverPTID == authorPTID &&
		request.SenderPTID == recipientPTID &&
		request.ReceiverHomeStationPeerID == sourceStationPeerID &&
		request.SenderHomeStationPeerID == targetStationPeerID
	if (!direct && !reverse) ||
		strings.TrimSpace(request.FederationID) == "" ||
		request.FederationID != strings.TrimSpace(request.FederationID) {
		return "", socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			"friend_request",
			"does not bind the selected actor and Station pair",
		)
	}
	return request.FederationID, nil
}

func (a *GORMPrivateAudienceAuthority) ResolveFriendsPostSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
) (socialdomain.FriendsSnapshot, error) {
	database, err := a.database(transaction)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	if transaction != nil {
		if err := lockSocialRelationshipAuthority(database, authorPTID); err != nil {
			return socialdomain.FriendsSnapshot{}, err
		}
	}
	return loadFriendsSnapshot(ctx, database, authorPTID)
}

func (a *GORMPrivateAudienceAuthority) ResolvePrivateCommentSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	postID string,
	replyToCommentID string,
	commentAuthorPTID string,
) (socialdomain.FriendsSnapshot, error) {
	database, err := a.database(transaction)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	var post dbmodel.SocialPrivateContentPost
	err = database.WithContext(ctx).
		Where(
			"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
			strings.TrimSpace(postID),
			privateContentLifecycleActive,
		).
		First(&post).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentNotFound,
					"social.private_content.comment_snapshot",
					"post_id",
					"does not identify a readable private Post",
				)
		}
		return socialdomain.FriendsSnapshot{}, err
	}
	if transaction != nil {
		if err := lockSocialRelationshipAuthorities(
			database,
			[]string{post.AuthorPTID, commentAuthorPTID},
		); err != nil {
			return socialdomain.FriendsSnapshot{}, err
		}
		query := database.WithContext(ctx)
		if database.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.
			Where(
				"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
				strings.TrimSpace(postID),
				privateContentLifecycleActive,
			).
			First(&post).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return socialdomain.FriendsSnapshot{},
					socialdomain.NewPrivateContentError(
						socialdomain.PrivateContentStalePlan,
						"social.private_content.comment_snapshot",
						"post_id",
						"was deleted after prepare",
					)
			}
			return socialdomain.FriendsSnapshot{}, err
		}
	}
	blocked, err := NewBlockGraphRepository(database).IsBlockedBetween(
		ctx,
		post.AuthorPTID,
		commentAuthorPTID,
	)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	if blocked {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentStalePlan,
				"social.private_content.comment_snapshot",
				"comment_author",
				"is blocked from the parent Post",
			)
	}
	if replyToCommentID != "" {
		query := database.WithContext(ctx)
		if transaction != nil &&
			database.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var parentComment dbmodel.SocialPrivateContentComment
		if err := query.Where(
			"comment_id = ? AND post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
			replyToCommentID,
			post.PostID,
			privateContentLifecycleActive,
		).First(&parentComment).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return socialdomain.FriendsSnapshot{},
					socialdomain.NewPrivateContentError(
						socialdomain.PrivateContentStalePlan,
						"social.private_content.comment_snapshot",
						"reply_to_comment_id",
						"is missing or belongs to another Post",
					)
			}
			return socialdomain.FriendsSnapshot{}, err
		}
		if parentComment.ReplyToCommentID != "" {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentInvalidArgument,
					"social.private_content.comment_snapshot",
					"reply_to_comment_id",
					"must identify a top-level private Comment",
				)
		}
	}

	var parentSnapshot dbmodel.SocialPrivateAudienceSnapshot
	if err := database.WithContext(ctx).
		Where("snapshot_id = ?", post.AudienceSnapshotID).
		First(&parentSnapshot).Error; err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	var grants []dbmodel.SocialPrivateRecipientGrant
	if err := database.WithContext(ctx).
		Where(
			"snapshot_id = ? AND revoked_at IS NULL",
			post.AudienceSnapshotID,
		).
		Order("recipient_ptid ASC").
		Find(&grants).Error; err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}

	parentRecipients := make(map[string]struct{}, len(grants)+1)
	parentRecipients[post.AuthorPTID] = struct{}{}
	for _, grant := range grants {
		parentRecipients[grant.RecipientPTID] = struct{}{}
	}
	if _, allowed := parentRecipients[commentAuthorPTID]; !allowed {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				"social.private_content.comment_snapshot",
				"comment_author",
				"is not authorized for the parent Post",
			)
	}

	friendSnapshot, err := loadFriendsSnapshot(
		ctx,
		database,
		commentAuthorPTID,
	)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	friendSet := make(
		map[string]struct{},
		len(friendSnapshot.RecipientPTIDs),
	)
	for _, friendPTID := range friendSnapshot.RecipientPTIDs {
		friendSet[friendPTID] = struct{}{}
	}
	recipients := make([]string, 0, len(parentRecipients))
	for recipientPTID := range parentRecipients {
		if recipientPTID == commentAuthorPTID {
			continue
		}
		if recipientPTID == post.AuthorPTID {
			recipients = append(recipients, recipientPTID)
			continue
		}
		if _, isFriend := friendSet[recipientPTID]; isFriend {
			recipients = append(recipients, recipientPTID)
		}
	}
	sort.Strings(recipients)
	if len(recipients) == 0 {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentStalePlan,
				"social.private_content.comment_snapshot",
				"recipients",
				"contains no currently authorized interaction recipient",
			)
	}

	head := sha256.New()
	writeSnapshotField(head, "comment")
	writeSnapshotField(head, post.PostID)
	writeSnapshotField(head, commentAuthorPTID)
	writeSnapshotBytes(head, parentSnapshot.CanonicalSnapshotSHA256)
	writeSnapshotBytes(head, friendSnapshot.SourceHeadSHA256)
	for _, recipientPTID := range recipients {
		writeSnapshotField(head, recipientPTID)
	}
	revision := parentSnapshot.SourceRevision + friendSnapshot.SourceRevision
	if revision == 0 {
		revision = 1
	}
	return socialdomain.FriendsSnapshot{
		Audience: &actormodel.Audience{
			Kind:       actormodel.Audience_CUSTOM_ALLOW,
			ActorPtids: append([]string(nil), recipients...),
		},
		SourceRevision:   revision,
		SourceHeadSHA256: head.Sum(nil),
		RecipientPTIDs:   recipients,
	}, nil
}

func (a *GORMPrivateAudienceAuthority) ResolveFollowersPostSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
) (socialdomain.FriendsSnapshot, error) {
	database, err := a.database(transaction)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	if transaction != nil {
		if err := lockSocialRelationshipAuthority(database, authorPTID); err != nil {
			return socialdomain.FriendsSnapshot{}, err
		}
	}
	return loadFollowersSnapshot(ctx, database, authorPTID)
}

func (a *GORMPrivateAudienceAuthority) ResolveCirclePostSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
	targetID uint64,
) (socialdomain.FriendsSnapshot, error) {
	database, err := a.database(transaction)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	if transaction != nil {
		if err := lockSocialRelationshipAuthority(database, authorPTID); err != nil {
			return socialdomain.FriendsSnapshot{}, err
		}
	}
	return loadCircleSnapshot(ctx, database, authorPTID, targetID)
}

func (a *GORMPrivateAudienceAuthority) ResolveGroupPostSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
	group socialdomain.GroupRecipientSnapshot,
) (socialdomain.FriendsSnapshot, error) {
	database, err := a.database(transaction)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}

	return loadGroupSnapshot(ctx, database, authorPTID, group)
}

func (a *GORMPrivateAudienceAuthority) ResolveCustomAllowPostSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
	actorPTIDs []string,
) (socialdomain.FriendsSnapshot, error) {
	database, err := a.database(transaction)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	if transaction != nil {
		if err := lockSocialRelationshipAuthority(database, authorPTID); err != nil {
			return socialdomain.FriendsSnapshot{}, err
		}
	}
	return loadCustomAllowSnapshot(ctx, database, authorPTID, actorPTIDs)
}

func (a *GORMPrivateAudienceAuthority) ResolveCustomDenyPostSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
	actorPTIDs []string,
	baseKind actormodel.Audience_Kind,
) (socialdomain.FriendsSnapshot, error) {
	database, err := a.database(transaction)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	if transaction != nil {
		if err := lockSocialRelationshipAuthority(database, authorPTID); err != nil {
			return socialdomain.FriendsSnapshot{}, err
		}
	}
	return loadCustomDenySnapshot(ctx, database, authorPTID, actorPTIDs, baseKind)
}

func (a *GORMPrivateAudienceAuthority) ValidatePrepare(
	ctx context.Context,
	repostAuthorPTID string,
	target socialdomain.FriendsSnapshot,
	authority *privatecontentpb.PrivateRepostAuthority,
) error {
	return a.validateRepostSource(
		ctx,
		nil,
		repostAuthorPTID,
		target,
		authority,
		false,
	)
}

func (a *GORMPrivateAudienceAuthority) ValidateSubmit(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	repostAuthorPTID string,
	target socialdomain.FriendsSnapshot,
	authority *privatecontentpb.PrivateRepostAuthority,
) error {
	if transaction == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.repost_source_submit",
			"transaction",
			"is required",
		)
	}
	return a.validateRepostSource(
		ctx,
		transaction,
		repostAuthorPTID,
		target,
		authority,
		true,
	)
}

func (a *GORMPrivateAudienceAuthority) validateRepostSource(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	repostAuthorPTID string,
	target socialdomain.FriendsSnapshot,
	authority *privatecontentpb.PrivateRepostAuthority,
	submit bool,
) error {
	const operation = "social.private_content.repost_source"
	if err := socialdomain.ValidatePrivateRepostAuthority(
		authority,
		operation,
	); err != nil {
		return err
	}
	database, err := a.database(transaction)
	if err != nil {
		return err
	}
	switch proof := authority.GetSourceProof().(type) {
	case *privatecontentpb.PrivateRepostAuthority_PublicSource:
		return validatePublicRepostSource(
			ctx,
			database,
			repostAuthorPTID,
			target,
			authority,
			proof.PublicSource,
			submit,
		)
	case *privatecontentpb.PrivateRepostAuthority_PrivateSource:
		return validatePrivateRepostSource(
			ctx,
			database,
			repostAuthorPTID,
			target,
			authority,
			proof.PrivateSource,
			submit,
		)
	default:
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"repost_authority.source_proof",
			"is required",
		)
	}
}

func (a *GORMPrivateAudienceAuthority) database(
	transaction federationdelivery.Transaction,
) (*gorm.DB, error) {
	if transaction == nil {
		return a.db, nil
	}
	if transaction.DB() == nil {
		return nil, fmt.Errorf("Social private audience transaction has no database")
	}
	return transaction.DB(), nil
}

func validatePublicRepostSource(
	ctx context.Context,
	database *gorm.DB,
	repostAuthorPTID string,
	target socialdomain.FriendsSnapshot,
	authority *privatecontentpb.PrivateRepostAuthority,
	proof *privatecontentpb.PublicRepostSourceProof,
	submit bool,
) error {
	const operation = "social.private_content.public_repost_source"
	sourceID, err := strconv.ParseUint(authority.GetSource().GetPostId(), 10, 64)
	if err != nil ||
		sourceID == 0 ||
		strconv.FormatUint(sourceID, 10) != authority.GetSource().GetPostId() {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"source.post_id",
			"must identify a canonical public Post",
		)
	}
	query := database.WithContext(ctx)
	if submit && database.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var row dbmodel.SocialPublicPost
	if err := query.Where(
		"id = ? AND deleted_at IS NULL",
		sourceID,
	).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return repostSourceFailure(
				submit,
				socialdomain.PrivateContentNotFound,
				operation,
				"source.post_id",
				"does not identify a live public Post",
			)
		}
		return err
	}
	if row.Type == actormodel.PostType_REPOST.String() {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentUnsupported,
			operation,
			"source.kind",
			"nested repost snapshots are not supported",
		)
	}
	var author dbmodel.Actor
	if err := database.WithContext(ctx).
		Where("id = ?", row.AuthorID).
		First(&author).Error; err != nil {
		return err
	}
	sourceAuthor := touchactor.ProtoActorRef(&author)
	if sourceAuthor == nil ||
		sourceAuthor.GetPtid() == "" ||
		sourceAuthor.GetAcct() == "" ||
		sourceAuthor.GetKind() == actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			operation,
			"source_author",
			"persisted ActorRef is not canonical",
		)
	}
	if !proto.Equal(authority.GetSourceAuthor(), sourceAuthor) {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"source_author",
			"does not match the authoritative public Post author",
		)
	}
	viewers := append(
		[]string{repostAuthorPTID},
		target.RecipientPTIDs...,
	)
	for _, viewerPTID := range viewers {
		if err := authorizePrivateBlockBoundary(
			database,
			sourceAuthor.GetPtid(),
			viewerPTID,
		); err != nil {
			return repostSourceFailure(
				submit,
				socialdomain.PrivateContentUnauthorized,
				operation,
				"target.recipients",
				"contains an actor blocked from the public source",
			)
		}
	}
	snapshot, err := publicRenderedSourceSnapshot(
		&row,
		sourceAuthor,
	)
	if err != nil {
		return err
	}
	canonical, err := socialdomain.CanonicalProtoBytes(snapshot)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(canonical)
	if proof == nil ||
		!bytes.Equal(
			proof.GetCanonicalPublicPostSha256(),
			digest[:],
		) {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"public_source.canonical_public_post_sha256",
			"does not match the authoritative public source snapshot",
		)
	}
	return nil
}

func validatePrivateRepostSource(
	ctx context.Context,
	database *gorm.DB,
	repostAuthorPTID string,
	target socialdomain.FriendsSnapshot,
	authority *privatecontentpb.PrivateRepostAuthority,
	proof *privatecontentpb.PrivateRepostSourceProof,
	submit bool,
) error {
	const operation = "social.private_content.private_repost_source"
	query := database.WithContext(ctx)
	if submit && database.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var post dbmodel.SocialPrivateContentPost
	if err := query.Where(
		"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
		authority.GetSource().GetPostId(),
		privateContentLifecycleActive,
	).First(&post).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return repostSourceFailure(
				submit,
				socialdomain.PrivateContentNotFound,
				operation,
				"source.post_id",
				"does not identify a live private Post",
			)
		}
		return err
	}
	if post.Kind == actormodel.PostType_REPOST.String() {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentUnsupported,
			operation,
			"source.kind",
			"nested repost snapshots are not supported",
		)
	}
	if submit {
		if err := lockSocialRelationshipAuthority(
			database,
			post.AuthorPTID,
		); err != nil {
			return err
		}
	}
	if err := authorizePrivatePostViewer(
		database,
		post,
		repostAuthorPTID,
	); err != nil {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentUnauthorized,
			operation,
			"repost_author",
			"is not authorized for the private source",
		)
	}
	var sourceSnapshot dbmodel.SocialPrivateAudienceSnapshot
	if err := database.WithContext(ctx).
		Where("snapshot_id = ?", post.AudienceSnapshotID).
		First(&sourceSnapshot).Error; err != nil {
		return err
	}
	grantsQuery := database.WithContext(ctx)
	if submit && database.Dialector.Name() == "postgres" {
		grantsQuery = grantsQuery.Clauses(
			clause.Locking{Strength: "UPDATE"},
		)
	}
	var grants []dbmodel.SocialPrivateRecipientGrant
	if err := grantsQuery.Where(
		"snapshot_id = ? AND revoked_at IS NULL",
		post.AudienceSnapshotID,
	).Order("recipient_ptid ASC").Find(&grants).Error; err != nil {
		return err
	}
	authorized := make(map[string]struct{}, len(grants)+1)
	authorized[post.AuthorPTID] = struct{}{}
	for _, grant := range grants {
		authorized[grant.RecipientPTID] = struct{}{}
	}
	for _, recipientPTID := range target.RecipientPTIDs {
		if _, ok := authorized[recipientPTID]; !ok {
			return repostSourceFailure(
				submit,
				socialdomain.PrivateContentUnauthorized,
				operation,
				"target.recipients",
				"must be a subset of the private source grant",
			)
		}
		if recipientPTID != post.AuthorPTID {
			if err := authorizePrivatePostViewer(
				database,
				post,
				recipientPTID,
			); err != nil {
				return repostSourceFailure(
					submit,
					socialdomain.PrivateContentUnauthorized,
					operation,
					"target.recipients",
					"contains an actor no longer authorized for the private source",
				)
			}
		}
	}
	var sourceAuthor dbmodel.Actor
	if err := database.WithContext(ctx).
		Where("ptid = ?", post.AuthorPTID).
		First(&sourceAuthor).Error; err != nil {
		return err
	}
	sourceAuthorRef := touchactor.ProtoActorRef(&sourceAuthor)
	if sourceAuthorRef == nil ||
		sourceAuthorRef.GetPtid() == "" ||
		sourceAuthorRef.GetAcct() == "" ||
		sourceAuthorRef.GetKind() ==
			actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED ||
		!proto.Equal(authority.GetSourceAuthor(), sourceAuthorRef) {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"source_author",
			"does not match the authoritative private Post author",
		)
	}
	var commitProof dbmodel.SocialPrivateCommitProof
	if err := database.WithContext(ctx).Where(
		"content_id = ? AND generation = ?",
		post.ContentID,
		post.Generation,
	).First(&commitProof).Error; err != nil {
		return err
	}
	source := authority.GetSource()
	resource := proof.GetSourceResource()
	if proof == nil ||
		source.GetPrivateContentId() != post.ContentID ||
		source.GetPrivateGeneration() != post.Generation ||
		resource.GetOwnerDomain() !=
			securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		resource.GetContentId() != post.ContentID ||
		resource.GetGeneration() != post.Generation ||
		!bytes.Equal(
			proof.GetSourceAuthorizationSnapshotSha256(),
			sourceSnapshot.CanonicalSnapshotSHA256,
		) ||
		!bytes.Equal(
			proof.GetSourceEncryptedPayloadSha256(),
			post.EncryptedPayloadSHA256,
		) ||
		!bytes.Equal(
			proof.GetSourceCommitProofSha256(),
			commitProof.CanonicalProofSHA256,
		) {
		return repostSourceFailure(
			submit,
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"private_source",
			"does not match the authoritative private source commitments",
		)
	}
	return nil
}

func publicRenderedSourceSnapshot(
	row *dbmodel.SocialPublicPost,
	author *actormodel.ActorRef,
) (*privatecontentpb.PublicRenderedSourceSnapshot, error) {
	const operation = "social.private_content.public_repost_snapshot"
	post := socialdomain.NewPostConverter().PublicDBToDomain(row)
	post.AuthorPTID = author.GetPtid()
	wire, err := socialdomain.NewPostConverter().DomainToProto(post)
	if err != nil {
		return nil, err
	}
	snapshot := &privatecontentpb.PublicRenderedSourceSnapshot{
		Source: &privatecontentpb.SocialPostSourceRef{
			PostId: strconv.FormatUint(row.ID, 10),
		},
		Author:    proto.Clone(author).(*actormodel.ActorRef),
		CreatedAt: timestamppb.New(row.CreatedAt.UTC()),
		Kind: privatecontentpb.
			PrivateRenderedSourceKind_PRIVATE_RENDERED_SOURCE_KIND_UNSPECIFIED,
	}
	for _, mention := range wire.GetTypedMentions() {
		snapshot.TypedMentions = append(
			snapshot.TypedMentions,
			proto.Clone(mention).(*actormodel.Mention),
		)
	}
	switch wire.GetType() {
	case actormodel.PostType_TEXT:
		if wire.GetTextPost() == nil {
			break
		}
		snapshot.Kind = privatecontentpb.
			PrivateRenderedSourceKind_PRIVATE_RENDERED_SOURCE_KIND_TEXT
		snapshot.Body =
			&privatecontentpb.PublicRenderedSourceSnapshot_Text{
				Text: proto.Clone(
					wire.GetTextPost(),
				).(*actormodel.TextPost),
			}
	case actormodel.PostType_IMAGE:
		if wire.GetImagePost() == nil {
			break
		}
		snapshot.Kind = privatecontentpb.
			PrivateRenderedSourceKind_PRIVATE_RENDERED_SOURCE_KIND_IMAGE
		snapshot.Body =
			&privatecontentpb.PublicRenderedSourceSnapshot_Image{
				Image: proto.Clone(
					wire.GetImagePost(),
				).(*actormodel.ImagePost),
			}
	case actormodel.PostType_VIDEO:
		if wire.GetVideoPost() == nil {
			break
		}
		snapshot.Kind = privatecontentpb.
			PrivateRenderedSourceKind_PRIVATE_RENDERED_SOURCE_KIND_VIDEO
		snapshot.Body =
			&privatecontentpb.PublicRenderedSourceSnapshot_Video{
				Video: proto.Clone(
					wire.GetVideoPost(),
				).(*actormodel.VideoPost),
			}
	case actormodel.PostType_LINK:
		if wire.GetLinkPost() == nil {
			break
		}
		snapshot.Kind = privatecontentpb.
			PrivateRenderedSourceKind_PRIVATE_RENDERED_SOURCE_KIND_LINK
		snapshot.Body =
			&privatecontentpb.PublicRenderedSourceSnapshot_Link{
				Link: proto.Clone(
					wire.GetLinkPost(),
				).(*actormodel.LinkPost),
			}
	case actormodel.PostType_POLL:
		if wire.GetPollPost() == nil {
			break
		}
		snapshot.Kind = privatecontentpb.
			PrivateRenderedSourceKind_PRIVATE_RENDERED_SOURCE_KIND_POLL
		snapshot.Body =
			&privatecontentpb.PublicRenderedSourceSnapshot_Poll{
				Poll: proto.Clone(
					wire.GetPollPost(),
				).(*actormodel.PollPost),
			}
	case actormodel.PostType_LOCATION:
		if wire.GetLocationPost() == nil {
			break
		}
		snapshot.Kind = privatecontentpb.
			PrivateRenderedSourceKind_PRIVATE_RENDERED_SOURCE_KIND_LOCATION
		snapshot.Body =
			&privatecontentpb.PublicRenderedSourceSnapshot_Location{
				Location: proto.Clone(
					wire.GetLocationPost(),
				).(*actormodel.LocationPost),
			}
	default:
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			operation,
			"source.kind",
			"does not support a non-recursive rendered snapshot",
		)
	}
	if snapshot.Body == nil ||
		snapshot.GetCreatedAt() == nil ||
		!snapshot.GetCreatedAt().IsValid() {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"source",
			"is incomplete",
		)
	}
	return snapshot, nil
}

func repostSourceFailure(
	submit bool,
	prepareCode socialdomain.PrivateContentErrorCode,
	operation string,
	field string,
	message string,
) error {
	code := prepareCode
	if submit {
		code = socialdomain.PrivateContentStalePlan
	}
	return socialdomain.NewPrivateContentError(
		code,
		operation,
		field,
		message,
	)
}

func loadFriendsSnapshot(
	ctx context.Context,
	database *gorm.DB,
	authorPTID string,
) (socialdomain.FriendsSnapshot, error) {
	authorPTID = strings.TrimSpace(authorPTID)
	if authorPTID == "" {
		return socialdomain.FriendsSnapshot{}, fmt.Errorf(
			"Social FRIENDS snapshot requires an author PTID",
		)
	}
	var rows []federatedRelationshipProjectionModel
	if err := database.WithContext(ctx).
		Where("owner_ptid = ?", authorPTID).
		Order("peer_ptid ASC").
		Find(&rows).Error; err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	peers := make([]string, 0, len(rows))
	for _, row := range rows {
		peers = append(peers, row.PeerPTID)
	}
	blocked, err := NewBlockGraphRepository(database).
		BlockedActorPTIDs(ctx, authorPTID, peers)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}

	head := sha256.New()
	writeSnapshotField(head, "friends")
	writeSnapshotField(head, authorPTID)
	recipients := make([]string, 0, len(rows))
	for _, row := range rows {
		if blocked[row.PeerPTID] {
			continue
		}
		recipients = append(recipients, row.PeerPTID)
		writeSnapshotField(head, row.PeerPTID)
		writeSnapshotField(head, row.RequestID)
		writeSnapshotField(head, row.AcceptedEventID)
		writeSnapshotBytes(head, row.AcceptedEventHash)
		writeSnapshotField(head, row.AcceptedAt.UTC().Format(time.RFC3339Nano))
	}
	if len(recipients) == 0 {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.friends_snapshot",
				"recipients",
				"contains no accepted, unblocked FRIENDS recipients",
			)
	}
	return socialdomain.FriendsSnapshot{
		Audience:         &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
		SourceRevision:   uint64(len(rows)),
		SourceHeadSHA256: head.Sum(nil),
		RecipientPTIDs:   recipients,
	}, nil
}

func loadFollowersSnapshot(
	ctx context.Context,
	database *gorm.DB,
	authorPTID string,
) (socialdomain.FriendsSnapshot, error) {
	authorID, err := NewActorIdentity(database).RequireID(ctx, authorPTID)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	type followerRow struct {
		FollowID  uint64    `gorm:"column:follow_id"`
		PTID      string    `gorm:"column:ptid"`
		CreatedAt time.Time `gorm:"column:created_at"`
	}
	var rows []followerRow
	if err := database.WithContext(ctx).
		Table("follows AS follow").
		Select(
			"follow.id AS follow_id, actor.ptid AS ptid, follow.created_at AS created_at",
		).
		Joins("JOIN touch_actor AS actor ON actor.id = follow.follower_id").
		Where("follow.following_id = ?", authorID).
		Order("actor.ptid ASC").
		Find(&rows).Error; err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	peers := make([]string, 0, len(rows))
	for _, row := range rows {
		peers = append(peers, row.PTID)
	}
	blocked, err := NewBlockGraphRepository(database).
		BlockedActorPTIDs(ctx, authorPTID, peers)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	head := sha256.New()
	writeSnapshotField(head, "followers")
	writeSnapshotField(head, authorPTID)
	recipients := make([]string, 0, len(rows))
	for _, row := range rows {
		writeSnapshotField(head, strconv.FormatUint(row.FollowID, 10))
		writeSnapshotField(head, row.PTID)
		writeSnapshotField(head, row.CreatedAt.UTC().Format(time.RFC3339Nano))
		if blocked[row.PTID] {
			writeSnapshotField(head, "blocked")
			continue
		}
		recipients = append(recipients, row.PTID)
	}
	return requireNonEmptyAudienceSnapshot(
		"social.private_content.followers_snapshot",
		socialdomain.FriendsSnapshot{
			Audience:         &actormodel.Audience{Kind: actormodel.Audience_FOLLOWERS},
			SourceRevision:   uint64(len(rows)) + 1,
			SourceHeadSHA256: head.Sum(nil),
			RecipientPTIDs:   recipients,
		},
	)
}

func loadCircleSnapshot(
	ctx context.Context,
	database *gorm.DB,
	authorPTID string,
	targetID uint64,
) (socialdomain.FriendsSnapshot, error) {
	ownerID, err := NewActorIdentity(database).RequireID(ctx, authorPTID)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	var circle dbmodel.SocialCircle
	if err := database.WithContext(ctx).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", targetID, ownerID).
		First(&circle).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentUnauthorized,
					"social.private_content.circle_snapshot",
					"target_id",
					"does not identify an active Circle owned by the author",
				)
		}
		return socialdomain.FriendsSnapshot{}, err
	}
	var rows []dbmodel.SocialCircleMember
	if err := database.WithContext(ctx).
		Where("circle_id = ?", targetID).
		Order("actor_ptid ASC").
		Find(&rows).Error; err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	peers := make([]string, 0, len(rows))
	for _, row := range rows {
		peers = append(peers, row.ActorPtid)
	}
	blocked, err := NewBlockGraphRepository(database).
		BlockedActorPTIDs(ctx, authorPTID, peers)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	head := sha256.New()
	writeSnapshotField(head, "circle")
	writeSnapshotField(head, authorPTID)
	writeSnapshotField(head, strconv.FormatUint(targetID, 10))
	writeSnapshotField(head, circle.UpdatedAt.UTC().Format(time.RFC3339Nano))
	recipients := make([]string, 0, len(rows))
	for _, row := range rows {
		writeSnapshotField(head, row.ActorPtid)
		writeSnapshotField(head, row.AddedAt.UTC().Format(time.RFC3339Nano))
		if row.ActorPtid == authorPTID || blocked[row.ActorPtid] {
			continue
		}
		recipients = append(recipients, row.ActorPtid)
	}
	return requireNonEmptyAudienceSnapshot(
		"social.private_content.circle_snapshot",
		socialdomain.FriendsSnapshot{
			Audience: &actormodel.Audience{
				Kind: actormodel.Audience_CIRCLE,
				Target: &actormodel.Audience_CircleId{
					CircleId: targetID,
				},
			},
			SourceRevision:   uint64(len(rows)) + 1,
			SourceHeadSHA256: head.Sum(nil),
			RecipientPTIDs:   recipients,
		},
	)
}

func loadGroupSnapshot(
	ctx context.Context,
	database *gorm.DB,
	authorPTID string,
	group socialdomain.GroupRecipientSnapshot,
) (socialdomain.FriendsSnapshot, error) {
	const operation = "social.private_content.group_snapshot"
	if strings.TrimSpace(group.FederationID) == "" ||
		group.FederationID != strings.TrimSpace(group.FederationID) ||
		strings.TrimSpace(group.ConversationID) == "" ||
		group.ConversationID != strings.TrimSpace(group.ConversationID) ||
		group.AuthorPTID != authorPTID ||
		group.MembershipEpoch == 0 ||
		len(group.AuthorityHeadSHA256) != sha256.Size ||
		len(group.Members) == 0 {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"group_snapshot",
				"is incomplete or does not belong to the author",
			)
	}

	memberPTIDs := make([]string, 0, len(group.Members))
	authorActive := false
	authorHomeStationPeerID := ""
	previous := ""
	for _, member := range group.Members {
		if strings.TrimSpace(member.ActorPTID) == "" ||
			member.ActorPTID != strings.TrimSpace(member.ActorPTID) ||
			strings.TrimSpace(member.HomeStationPeerID) == "" ||
			member.HomeStationPeerID != strings.TrimSpace(member.HomeStationPeerID) ||
			member.ActorPTID <= previous {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentInvalidArgument,
					operation,
					"group_snapshot.members",
					"must be canonical, unique, and ordered",
				)
		}
		if member.ActorPTID == authorPTID {
			authorActive = true
			authorHomeStationPeerID = member.HomeStationPeerID
		} else {
			memberPTIDs = append(memberPTIDs, member.ActorPTID)
		}
		previous = member.ActorPTID
	}
	if !authorActive {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				"author_ptid",
				"is not an active Group member",
			)
	}
	for _, member := range group.Members {
		remote := member.HomeStationPeerID != authorHomeStationPeerID
		if (!remote && member.FederationID != "") ||
			(remote && member.FederationID != group.FederationID) {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentConflict,
					operation,
					"group_snapshot.members",
					"must bind each remote member to the Group Federation",
				)
		}
	}

	blocked, err := NewBlockGraphRepository(database).BlockedActorPTIDs(
		ctx,
		authorPTID,
		memberPTIDs,
	)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}

	head := sha256.New()
	writeSnapshotField(head, "group")
	writeSnapshotField(head, group.FederationID)
	writeSnapshotField(head, group.ConversationID)
	writeSnapshotField(head, authorPTID)
	writeSnapshotField(head, strconv.FormatUint(group.MembershipEpoch, 10))
	writeSnapshotBytes(head, group.AuthorityHeadSHA256)
	recipients := make([]string, 0, len(memberPTIDs))
	localities := make(
		[]socialdomain.RecipientLocality,
		0,
		len(memberPTIDs),
	)
	for _, member := range group.Members {
		writeSnapshotField(head, member.ActorPTID)
		writeSnapshotField(head, member.HomeStationPeerID)
		if member.ActorPTID == authorPTID || blocked[member.ActorPTID] {
			continue
		}
		recipients = append(recipients, member.ActorPTID)
		localities = append(localities, member)
	}

	return requireNonEmptyAudienceSnapshot(
		operation,
		socialdomain.FriendsSnapshot{
			Audience: &actormodel.Audience{
				Kind: actormodel.Audience_GROUP,
				Target: &actormodel.Audience_GroupConversationId{
					GroupConversationId: group.ConversationID,
				},
			},
			SourceRevision:      group.MembershipEpoch,
			SourceHeadSHA256:    head.Sum(nil),
			RecipientPTIDs:      recipients,
			RecipientLocalities: localities,
		},
	)
}

// loadCustomAllowSnapshot resolves the explicitly listed actors as the audience.
func loadCustomAllowSnapshot(
	ctx context.Context,
	database *gorm.DB,
	authorPTID string,
	actorPTIDs []string,
) (socialdomain.FriendsSnapshot, error) {
	if len(actorPTIDs) == 0 {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.custom_allow_snapshot",
				"actor_ptids",
				"CUSTOM_ALLOW requires non-empty actor list",
			)
	}
	blocked, err := NewBlockGraphRepository(database).
		BlockedActorPTIDs(ctx, authorPTID, actorPTIDs)
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	head := sha256.New()
	writeSnapshotField(head, "custom_allow")
	writeSnapshotField(head, authorPTID)
	sorted := append([]string(nil), actorPTIDs...)
	sort.Strings(sorted)
	recipients := make([]string, 0, len(sorted))
	previous := ""
	for _, ptid := range sorted {
		if strings.TrimSpace(ptid) == "" ||
			ptid != strings.TrimSpace(ptid) ||
			ptid == authorPTID ||
			ptid == previous {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentInvalidArgument,
					"social.private_content.custom_allow_snapshot",
					"actor_ptids",
					"must contain unique canonical recipients other than the author",
				)
		}
		if blocked[ptid] {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentUnauthorized,
					"social.private_content.custom_allow_snapshot",
					"actor_ptids",
					"contains a blocked recipient",
				)
		}
		recipients = append(recipients, ptid)
		writeSnapshotField(head, ptid)
		previous = ptid
	}
	if len(recipients) == 0 {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.custom_allow_snapshot",
				"recipients",
				"no unblocked recipients remain after filtering",
			)
	}
	return socialdomain.FriendsSnapshot{
		Audience: &actormodel.Audience{
			Kind:       actormodel.Audience_CUSTOM_ALLOW,
			ActorPtids: sorted,
		},
		SourceRevision:   1,
		SourceHeadSHA256: head.Sum(nil),
		RecipientPTIDs:   recipients,
	}, nil
}

// loadCustomDenySnapshot resolves the base audience minus the denied actors.
func loadCustomDenySnapshot(
	ctx context.Context,
	database *gorm.DB,
	authorPTID string,
	denyPTIDs []string,
	baseKind actormodel.Audience_Kind,
) (socialdomain.FriendsSnapshot, error) {
	var (
		base socialdomain.FriendsSnapshot
		err  error
	)
	switch baseKind {
	case actormodel.Audience_FOLLOWERS:
		base, err = loadFollowersSnapshot(ctx, database, authorPTID)
	case actormodel.Audience_PUBLIC:
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnsupported,
				"social.private_content.custom_deny_snapshot",
				"base_kind",
				"CUSTOM_DENY(PUBLIC) is unsupported in v1",
			)
	default:
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.custom_deny_snapshot",
				"base_kind",
				"must be FOLLOWERS",
			)
	}
	if err != nil {
		return socialdomain.FriendsSnapshot{}, err
	}
	denySet := make(map[string]struct{}, len(denyPTIDs))
	sortedDeny := append([]string(nil), denyPTIDs...)
	sort.Strings(sortedDeny)
	previous := ""
	for _, ptid := range sortedDeny {
		if strings.TrimSpace(ptid) == "" ||
			ptid != strings.TrimSpace(ptid) ||
			ptid == authorPTID ||
			ptid == previous {
			return socialdomain.FriendsSnapshot{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentInvalidArgument,
					"social.private_content.custom_deny_snapshot",
					"actor_ptids",
					"must contain unique canonical actors other than the author",
				)
		}
		denySet[ptid] = struct{}{}
		previous = ptid
	}
	head := sha256.New()
	writeSnapshotField(head, "custom_deny")
	writeSnapshotField(head, authorPTID)
	writeSnapshotField(head, baseKind.String())
	writeSnapshotBytes(head, base.SourceHeadSHA256)
	for _, ptid := range sortedDeny {
		writeSnapshotField(head, ptid)
	}
	recipients := make([]string, 0, len(base.RecipientPTIDs))
	for _, ptid := range base.RecipientPTIDs {
		if _, denied := denySet[ptid]; denied {
			continue
		}
		recipients = append(recipients, ptid)
		writeSnapshotField(head, ptid)
	}
	if len(recipients) == 0 {
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.custom_deny_snapshot",
				"recipients",
				"all recipients were denied",
			)
	}
	return socialdomain.FriendsSnapshot{
		Audience: &actormodel.Audience{
			Kind:       actormodel.Audience_CUSTOM_DENY,
			BaseKind:   baseKind,
			ActorPtids: sortedDeny,
		},
		SourceRevision:   base.SourceRevision,
		SourceHeadSHA256: head.Sum(nil),
		RecipientPTIDs:   recipients,
	}, nil
}

func requireNonEmptyAudienceSnapshot(
	operation string,
	snapshot socialdomain.FriendsSnapshot,
) (socialdomain.FriendsSnapshot, error) {
	if len(snapshot.RecipientPTIDs) != 0 {
		return snapshot, nil
	}
	return socialdomain.FriendsSnapshot{},
		socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"recipients",
			"contains no unblocked recipients",
		)
}

func lockSocialRelationshipAuthority(
	database *gorm.DB,
	ownerPTID string,
) error {
	return lockSocialRelationshipAuthorities(database, []string{ownerPTID})
}

func lockSocialRelationshipAuthorities(
	database *gorm.DB,
	ownerPTIDs []string,
) error {
	ownerPTIDs = append([]string(nil), ownerPTIDs...)
	sort.Strings(ownerPTIDs)
	previous := ""
	for _, ownerPTID := range ownerPTIDs {
		if ownerPTID == previous {
			continue
		}
		if err := lockOneSocialRelationshipAuthority(
			database,
			ownerPTID,
		); err != nil {
			return err
		}
		previous = ownerPTID
	}
	return nil
}

func lockOneSocialRelationshipAuthority(
	database *gorm.DB,
	ownerPTID string,
) error {
	if database == nil || strings.TrimSpace(ownerPTID) == "" {
		return fmt.Errorf("Social relationship authority lock requires an owner")
	}
	if database.Dialector.Name() != "postgres" {
		return nil
	}
	digest := sha256.Sum256(
		[]byte("social-relationship-authority\x00" + ownerPTID),
	)
	lockID := int64(binary.BigEndian.Uint64(digest[:8]))
	if err := database.Exec(
		"SELECT pg_advisory_xact_lock(?)",
		lockID,
	).Error; err != nil {
		return fmt.Errorf("lock Social relationship authority: %w", err)
	}
	return nil
}

func writeSnapshotField(destination interface{ Write([]byte) (int, error) }, value string) {
	writeSnapshotBytes(destination, []byte(value))
}

func writeSnapshotBytes(destination interface{ Write([]byte) (int, error) }, value []byte) {
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(value)))
	_, _ = destination.Write(length[:])
	_, _ = destination.Write(value)
}
