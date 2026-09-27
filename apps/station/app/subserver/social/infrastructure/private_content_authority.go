package infrastructure

import (
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
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
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
	return loadGroupSnapshot(ctx, database, authorPTID, targetID)
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
				Kind:     actormodel.Audience_CIRCLE,
				TargetId: targetID,
			},
			SourceRevision:   uint64(len(rows)) + 1,
			SourceHeadSHA256: head.Sum(nil),
			RecipientPTIDs:   recipients,
		},
	)
}

func loadGroupSnapshot(
	_ context.Context,
	_ *gorm.DB,
	_ string,
	targetID uint64,
) (socialdomain.FriendsSnapshot, error) {
	return socialdomain.FriendsSnapshot{},
		socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.group_snapshot",
			"target_id",
			fmt.Sprintf(
				"DESIGN_AMENDMENT_REQUIRED: Audience.GROUP target_id %d is uint64 but canonical Conversation IDs are string identities",
				targetID,
			),
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
				socialdomain.PrivateContentIntegrationGap,
				"social.private_content.custom_deny_snapshot",
				"base_kind",
				"DESIGN_AMENDMENT_REQUIRED: Social has no complete federated PUBLIC actor authority for freezing CUSTOM_DENY recipients",
			)
	default:
		return socialdomain.FriendsSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.custom_deny_snapshot",
				"base_kind",
				"must be PUBLIC or FOLLOWERS",
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
