package infrastructure

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sort"
	"strings"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
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
		Where("post_id = ? AND deleted_at IS NULL", strings.TrimSpace(postID)).
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
				"post_id = ? AND deleted_at IS NULL",
				strings.TrimSpace(postID),
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
			"comment_id = ? AND post_id = ? AND deleted_at IS NULL",
			replyToCommentID,
			post.PostID,
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
		SourceRevision:   revision,
		SourceHeadSHA256: head.Sum(nil),
		RecipientPTIDs:   recipients,
	}, nil
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
		SourceRevision:   uint64(len(rows)),
		SourceHeadSHA256: head.Sum(nil),
		RecipientPTIDs:   recipients,
	}, nil
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
