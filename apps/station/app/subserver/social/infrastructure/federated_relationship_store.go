package infrastructure

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FederatedRelationshipTransaction interface {
	VerifySocialRelationshipCommandSignature(
		ctx context.Context,
		device *model.ActorDeviceRef,
		claimedHomeStationPeerID string,
		localStationPeerID string,
		actorKeys FriendRequestActorKeyResolver,
		signingKeyID string,
		canonicalSigningBytes []byte,
		signature []byte,
	) error
	ValidateRelationshipActorHome(
		ctx context.Context,
		actorPTID string,
		expectedHomeStationPeerID string,
		localStationPeerID string,
	) error
	LoadSocialRelationshipCommand(
		ctx context.Context,
		actorPTID string,
		commandID string,
	) (*domain.SocialRelationshipCommandRecord, error)
	PutSocialRelationshipCommand(
		ctx context.Context,
		record domain.SocialRelationshipCommandRecord,
	) (domain.SocialRelationshipCommandRecord, bool, error)
	LoadDirectionalRelationship(
		ctx context.Context,
		actorPTID string,
		targetActorPTID string,
	) (*domain.DirectionalRelationshipState, error)
	SaveDirectionalRelationship(
		ctx context.Context,
		state domain.DirectionalRelationshipState,
		expectedRevision *int64,
	) error
	ApplyBlockedRelationshipEffects(
		ctx context.Context,
		actorPTID string,
		targetActorPTID string,
	) error
	RelationshipProjection(
		ctx context.Context,
		actorPTID string,
		targetActorPTID string,
	) (*model.SocialRelationshipProjection, error)
	AfterCommit(callback delivery.AfterCommitFunc) error
	Outbox() delivery.OutboxWriter
}

type FederatedRelationshipStore interface {
	ExecuteRelationship(
		ctx context.Context,
		fn func(FederatedRelationshipTransaction) error,
	) error
	LoadSocialRelationshipCommand(
		ctx context.Context,
		actorPTID string,
		commandID string,
	) (*domain.SocialRelationshipCommandRecord, error)
	LoadDirectionalRelationship(
		ctx context.Context,
		actorPTID string,
		targetActorPTID string,
	) (*domain.DirectionalRelationshipState, error)
	ListOutgoingBlockedRelationships(
		ctx context.Context,
		actorPTID string,
		cursor string,
		limit int32,
	) ([]domain.DirectionalRelationshipState, string, int64, error)
	RelationshipProjection(
		ctx context.Context,
		actorPTID string,
		targetActorPTID string,
	) (*model.SocialRelationshipProjection, error)
}

func (s *GORMFederatedFriendRequestStore) MigrateRelationshipAuthority(
	ctx context.Context,
) error {
	if err := s.db.WithContext(ctx).AutoMigrate(
		&socialRelationshipCommandModel{},
		&socialDirectionalRelationshipModel{},
	); err != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.migrate_relationship_authority",
			err,
		)
	}
	return s.migrateLegacyBlockedRelationships(ctx)
}

func (s *GORMFederatedFriendRequestStore) migrateLegacyBlockedRelationships(
	ctx context.Context,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var legacy []friendshipModel
		if err := tx.
			Where("status = ?", friendshipStatusBlocked).
			Find(&legacy).Error; err != nil {
			return err
		}
		now := s.clock.Now().UTC()
		for _, item := range legacy {
			state := socialDirectionalRelationshipModel{
				ActorPTID:       item.ActorPTID,
				TargetActorPTID: item.PeerPTID,
				Blocked:         true,
				Revision:        1,
				BlockedAt:       cloneTime(&item.UpdatedAt),
				UpdatedAt:       now,
			}
			if state.BlockedAt == nil || state.BlockedAt.IsZero() {
				state.BlockedAt = cloneTime(&now)
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&state).Error; err != nil {
				return err
			}
		}
		return tx.
			Where("status = ?", friendshipStatusBlocked).
			Delete(&friendshipModel{}).Error
	})
}

func (s *GORMFederatedFriendRequestStore) ExecuteRelationship(
	ctx context.Context,
	fn func(FederatedRelationshipTransaction) error,
) error {
	if fn == nil {
		return domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.execute_relationship_transaction",
			"callback",
			"is required",
		)
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		outbox, err := delivery.NewGORMRepository(tx, s.clock)
		if err != nil {
			return err
		}
		return fn(&federatedFriendRequestTransaction{
			db:     tx,
			outbox: outbox,
		})
	})
	if err != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.execute_relationship_transaction",
			err,
		)
	}
	return nil
}

func (s *GORMFederatedFriendRequestStore) LoadSocialRelationshipCommand(
	ctx context.Context,
	actorPTID string,
	commandID string,
) (*domain.SocialRelationshipCommandRecord, error) {
	return (&federatedFriendRequestTransaction{db: s.db}).
		LoadSocialRelationshipCommand(ctx, actorPTID, commandID)
}

func (s *GORMFederatedFriendRequestStore) LoadDirectionalRelationship(
	ctx context.Context,
	actorPTID string,
	targetActorPTID string,
) (*domain.DirectionalRelationshipState, error) {
	return (&federatedFriendRequestTransaction{db: s.db}).
		LoadDirectionalRelationship(ctx, actorPTID, targetActorPTID)
}

func (s *GORMFederatedFriendRequestStore) ListOutgoingBlockedRelationships(
	ctx context.Context,
	actorPTID string,
	cursor string,
	limit int32,
) ([]domain.DirectionalRelationshipState, string, int64, error) {
	const operation = "social.list_outgoing_blocked_relationships"
	if actorPTID == "" || actorPTID != strings.TrimSpace(actorPTID) {
		return nil, "", 0, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"actor_ptid",
			"is required and canonical",
		)
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	decoded, err := decodeRelationshipCursor(cursor)
	if err != nil {
		return nil, "", 0, err
	}
	query := s.db.WithContext(ctx).
		Where("actor_ptid = ? AND blocked = ?", actorPTID, true).
		Order("blocked_at DESC, target_actor_ptid DESC")
	if decoded != nil {
		query = query.Where(
			"(blocked_at < ?) OR (blocked_at = ? AND target_actor_ptid < ?)",
			decoded.BlockedAt,
			decoded.BlockedAt,
			decoded.TargetActorPTID,
		)
	}
	var persisted []socialDirectionalRelationshipModel
	if err := query.Limit(int(limit) + 1).Find(&persisted).Error; err != nil {
		return nil, "", 0, mapFederatedFriendRequestPersistenceError(operation, err)
	}
	hasMore := len(persisted) > int(limit)
	if hasMore {
		persisted = persisted[:limit]
	}
	states := make([]domain.DirectionalRelationshipState, 0, len(persisted))
	var maxRevision int64
	for _, item := range persisted {
		state := directionalRelationshipFromModel(item)
		states = append(states, state)
		if state.Revision > maxRevision {
			maxRevision = state.Revision
		}
	}
	nextCursor := ""
	if hasMore && len(states) > 0 {
		last := states[len(states)-1]
		blockedAt := last.UpdatedAt
		if last.BlockedAt != nil {
			blockedAt = last.BlockedAt.UTC()
		}
		nextCursor, err = encodeRelationshipCursor(relationshipCursor{
			BlockedAt:       blockedAt,
			TargetActorPTID: last.TargetActorPTID,
		})
		if err != nil {
			return nil, "", 0, err
		}
	}
	return states, nextCursor, maxRevision, nil
}

func (s *GORMFederatedFriendRequestStore) RelationshipProjection(
	ctx context.Context,
	actorPTID string,
	targetActorPTID string,
) (*model.SocialRelationshipProjection, error) {
	return relationshipProjectionWithDB(
		ctx,
		s.db,
		actorPTID,
		targetActorPTID,
	)
}

func (t *federatedFriendRequestTransaction) RelationshipProjection(
	ctx context.Context,
	actorPTID string,
	targetActorPTID string,
) (*model.SocialRelationshipProjection, error) {
	return relationshipProjectionWithDB(
		ctx,
		t.db,
		actorPTID,
		targetActorPTID,
	)
}

func relationshipProjectionWithDB(
	ctx context.Context,
	database *gorm.DB,
	actorPTID string,
	targetActorPTID string,
) (*model.SocialRelationshipProjection, error) {
	const operation = "social.load_relationship_projection"
	if actorPTID == "" ||
		targetActorPTID == "" ||
		actorPTID == targetActorPTID ||
		actorPTID != strings.TrimSpace(actorPTID) ||
		targetActorPTID != strings.TrimSpace(targetActorPTID) {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"actor_pair",
			"must contain distinct canonical PTIDs",
		)
	}
	transaction := &federatedFriendRequestTransaction{db: database}
	outgoing, err := transaction.LoadDirectionalRelationship(
		ctx,
		actorPTID,
		targetActorPTID,
	)
	if err != nil {
		return nil, err
	}
	incoming, err := transaction.LoadDirectionalRelationship(
		ctx,
		targetActorPTID,
		actorPTID,
	)
	if err != nil {
		return nil, err
	}
	following, followedBy, err := followDirectionsWithDB(
		ctx,
		database,
		actorPTID,
		targetActorPTID,
	)
	if err != nil {
		return nil, err
	}
	revision := int64(0)
	blockedByViewer := outgoing != nil && outgoing.Blocked
	blockedByPeer := incoming != nil && incoming.Blocked
	if outgoing != nil && outgoing.Revision > revision {
		revision = outgoing.Revision
	}
	targetHomeStationPeerID := ""
	if outgoing != nil {
		targetHomeStationPeerID = outgoing.TargetHomeStationPeerID
	}
	if targetHomeStationPeerID == "" && incoming != nil {
		targetHomeStationPeerID = incoming.ActorHomeStationPeerID
	}
	return domain.SocialRelationshipProjectionFromState(
		humanActorReference(targetActorPTID),
		targetHomeStationPeerID,
		following,
		followedBy,
		blockedByViewer,
		!blockedByViewer && !blockedByPeer,
		revision,
	), nil
}

func followDirectionsWithDB(
	ctx context.Context,
	database *gorm.DB,
	actorPTID string,
	targetActorPTID string,
) (bool, bool, error) {
	var rows []struct {
		FollowerPTID  string `gorm:"column:follower_ptid"`
		FollowingPTID string `gorm:"column:following_ptid"`
	}
	err := database.WithContext(ctx).Raw(
		"SELECT follower.ptid AS follower_ptid, following.ptid AS following_ptid "+
			"FROM follows "+
			"JOIN touch_actor AS follower ON follower.id = follows.follower_id "+
			"JOIN touch_actor AS following ON following.id = follows.following_id "+
			"WHERE (follower.ptid = ? AND following.ptid = ?) "+
			"OR (follower.ptid = ? AND following.ptid = ?)",
		actorPTID,
		targetActorPTID,
		targetActorPTID,
		actorPTID,
	).Scan(&rows).Error
	if err != nil {
		return false, false, mapFederatedFriendRequestPersistenceError(
			"social.load_follow_directions",
			err,
		)
	}
	var following bool
	var followedBy bool
	for _, row := range rows {
		if row.FollowerPTID == actorPTID && row.FollowingPTID == targetActorPTID {
			following = true
		}
		if row.FollowerPTID == targetActorPTID && row.FollowingPTID == actorPTID {
			followedBy = true
		}
	}
	return following, followedBy, nil
}

func (t *federatedFriendRequestTransaction) VerifySocialRelationshipCommandSignature(
	ctx context.Context,
	device *model.ActorDeviceRef,
	claimedHomeStationPeerID string,
	localStationPeerID string,
	actorKeys FriendRequestActorKeyResolver,
	signingKeyID string,
	canonicalSigningBytes []byte,
	signature []byte,
) error {
	return verifyFriendRequestCommandSignature(
		ctx,
		t,
		device,
		claimedHomeStationPeerID,
		localStationPeerID,
		actorKeys,
		signingKeyID,
		canonicalSigningBytes,
		signature,
	)
}

func (t *federatedFriendRequestTransaction) AfterCommit(
	callback delivery.AfterCommitFunc,
) error {
	if t.afterCommit == nil {
		return domain.NewFederationError(
			domain.FederationErrorPersistence,
			"social.register_relationship_after_commit",
			"transaction",
			"does not expose post-commit callbacks",
		)
	}
	return t.afterCommit.AfterCommit(callback)
}

func (t *federatedFriendRequestTransaction) ValidateRelationshipActorHome(
	ctx context.Context,
	actorPTID string,
	expectedHomeStationPeerID string,
	localStationPeerID string,
) error {
	const operation = "social.validate_relationship_actor_home"
	var actor dbmodel.Actor
	err := t.db.WithContext(ctx).
		Select("ptid", "origin", "home_station_peer_id").
		Where("ptid = ?", actorPTID).
		First(&actor).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		var projectedCount int64
		if projectionErr := t.db.WithContext(ctx).
			Model(&federatedFriendRequestProjectionModel{}).
			Where(
				"(sender_ptid = ? AND sender_home_station_peer_id = ?) OR "+
					"(receiver_ptid = ? AND receiver_home_station_peer_id = ?)",
				actorPTID,
				expectedHomeStationPeerID,
				actorPTID,
				expectedHomeStationPeerID,
			).
			Count(&projectedCount).Error; projectionErr != nil {
			return mapFederatedFriendRequestPersistenceError(
				operation,
				projectionErr,
			)
		}
		if projectedCount > 0 {
			return nil
		}
		return domain.NewFederationError(
			domain.FederationErrorIdentityUnavailable,
			operation,
			"actor_ptid",
			"is not present in the verified Actor directory",
		)
	}
	if err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	actualHomeStationPeerID := strings.TrimSpace(actor.HomeStationPeerID)
	if actualHomeStationPeerID == "" && actor.Origin != "remote_cached" {
		actualHomeStationPeerID = localStationPeerID
	}
	if actualHomeStationPeerID == "" ||
		actualHomeStationPeerID != expectedHomeStationPeerID {
		return domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			operation,
			"home_station_peer_id",
			"does not match the verified Actor directory",
		)
	}
	return nil
}

func (t *federatedFriendRequestTransaction) LoadSocialRelationshipCommand(
	ctx context.Context,
	actorPTID string,
	commandID string,
) (*domain.SocialRelationshipCommandRecord, error) {
	const operation = "social.load_relationship_command"
	var persisted socialRelationshipCommandModel
	err := t.db.WithContext(ctx).
		Where("actor_ptid = ? AND command_id = ?", actorPTID, commandID).
		First(&persisted).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, mapFederatedFriendRequestPersistenceError(operation, err)
	}
	record := socialRelationshipCommandFromModel(persisted)
	return &record, nil
}

func (t *federatedFriendRequestTransaction) PutSocialRelationshipCommand(
	ctx context.Context,
	record domain.SocialRelationshipCommandRecord,
) (domain.SocialRelationshipCommandRecord, bool, error) {
	const operation = "social.put_relationship_command"
	if record.ActorPTID == "" ||
		record.CommandID == "" ||
		len(record.CommandBytes) == 0 ||
		len(record.CommandPayloadSHA256) != 32 ||
		len(record.ResultBytes) == 0 ||
		record.CreatedAt.IsZero() ||
		record.ResolvedAt == nil {
		return domain.SocialRelationshipCommandRecord{}, false,
			domain.NewFederationError(
				domain.FederationErrorInvalidArgument,
				operation,
				"record",
				"is incomplete",
			)
	}
	persisted := socialRelationshipCommandModelFromDomain(record)
	create := t.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&persisted)
	if create.Error != nil {
		return domain.SocialRelationshipCommandRecord{}, false,
			mapFederatedFriendRequestPersistenceError(operation, create.Error)
	}
	if create.RowsAffected == 1 {
		return cloneSocialRelationshipCommandRecord(record), true, nil
	}
	existing, err := t.LoadSocialRelationshipCommand(
		ctx,
		record.ActorPTID,
		record.CommandID,
	)
	if err != nil {
		return domain.SocialRelationshipCommandRecord{}, false, err
	}
	if existing == nil {
		return domain.SocialRelationshipCommandRecord{}, false,
			domain.NewFederationError(
				domain.FederationErrorPersistence,
				operation,
				"record",
				"conflicting row disappeared",
			)
	}
	return *existing, false, nil
}

func (t *federatedFriendRequestTransaction) LoadDirectionalRelationship(
	ctx context.Context,
	actorPTID string,
	targetActorPTID string,
) (*domain.DirectionalRelationshipState, error) {
	const operation = "social.load_directional_relationship"
	var persisted socialDirectionalRelationshipModel
	err := t.db.WithContext(ctx).
		Where(
			"actor_ptid = ? AND target_actor_ptid = ?",
			actorPTID,
			targetActorPTID,
		).
		First(&persisted).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, mapFederatedFriendRequestPersistenceError(operation, err)
	}
	state := directionalRelationshipFromModel(persisted)
	return &state, nil
}

func (t *federatedFriendRequestTransaction) SaveDirectionalRelationship(
	ctx context.Context,
	state domain.DirectionalRelationshipState,
	expectedRevision *int64,
) error {
	const operation = "social.save_directional_relationship"
	persisted := directionalRelationshipModelFromDomain(state)
	if expectedRevision == nil {
		create := t.db.WithContext(ctx).
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&persisted)
		if create.Error != nil {
			return mapFederatedFriendRequestPersistenceError(operation, create.Error)
		}
		if create.RowsAffected != 1 {
			return domain.NewFederationError(
				domain.FederationErrorStateConflict,
				operation,
				"revision",
				"relationship head was created concurrently",
			)
		}
		return nil
	}
	update := t.db.WithContext(ctx).
		Model(&socialDirectionalRelationshipModel{}).
		Where(
			"actor_ptid = ? AND target_actor_ptid = ? AND revision = ?",
			state.ActorPTID,
			state.TargetActorPTID,
			*expectedRevision,
		).
		Updates(map[string]any{
			"actor_home_station_peer_id":  state.ActorHomeStationPeerID,
			"target_home_station_peer_id": state.TargetHomeStationPeerID,
			"blocked":                     state.Blocked,
			"revision":                    state.Revision,
			"last_event_hash":             append([]byte(nil), state.LastEventHash...),
			"last_event_bytes":            append([]byte(nil), state.LastEventBytes...),
			"blocked_at":                  cloneTime(state.BlockedAt),
			"updated_at":                  state.UpdatedAt.UTC(),
		})
	if update.Error != nil {
		return mapFederatedFriendRequestPersistenceError(operation, update.Error)
	}
	if update.RowsAffected != 1 {
		return domain.NewFederationError(
			domain.FederationErrorStateConflict,
			operation,
			"revision",
			"relationship head changed concurrently",
		)
	}
	return nil
}

func (t *federatedFriendRequestTransaction) ApplyBlockedRelationshipEffects(
	ctx context.Context,
	actorPTID string,
	targetActorPTID string,
) error {
	const operation = "social.apply_blocked_relationship_effects"
	if err := t.db.WithContext(ctx).Exec(
		"DELETE FROM follows WHERE "+
			"(follower_id IN (SELECT id FROM touch_actor WHERE ptid = ?) "+
			"AND following_id IN (SELECT id FROM touch_actor WHERE ptid = ?)) "+
			"OR (follower_id IN (SELECT id FROM touch_actor WHERE ptid = ?) "+
			"AND following_id IN (SELECT id FROM touch_actor WHERE ptid = ?))",
		actorPTID,
		targetActorPTID,
		targetActorPTID,
		actorPTID,
	).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	if err := t.db.WithContext(ctx).
		Where(
			"(owner_ptid = ? AND peer_ptid = ?) OR "+
				"(owner_ptid = ? AND peer_ptid = ?)",
			actorPTID,
			targetActorPTID,
			targetActorPTID,
			actorPTID,
		).
		Delete(&federatedRelationshipProjectionModel{}).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	if err := t.db.WithContext(ctx).
		Where(
			"status = ? AND ((actor_ptid = ? AND peer_ptid = ?) OR "+
				"(actor_ptid = ? AND peer_ptid = ?))",
			friendRequestPolicyRelationshipAccepted,
			actorPTID,
			targetActorPTID,
			targetActorPTID,
			actorPTID,
		).
		Delete(&friendshipModel{}).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	revokedAt := time.Now().UTC()
	if err := t.revokePrivateContentBetween(
		ctx,
		actorPTID,
		targetActorPTID,
		revokedAt,
	); err != nil {
		return err
	}
	if err := t.revokePrivateContentBetween(
		ctx,
		targetActorPTID,
		actorPTID,
		revokedAt,
	); err != nil {
		return err
	}
	return nil
}

func (t *federatedFriendRequestTransaction) revokePrivateContentBetween(
	ctx context.Context,
	authorPTID string,
	recipientPTID string,
	revokedAt time.Time,
) error {
	const operation = "social.revoke_blocked_private_content"
	var posts []dbmodel.SocialPrivateContentPost
	if err := t.db.WithContext(ctx).
		Select("post_id", "content_id").
		Where("author_ptid = ?", authorPTID).
		Find(&posts).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	if len(posts) == 0 {
		return nil
	}
	postIDs := make([]string, 0, len(posts))
	contentIDs := make([]string, 0, len(posts))
	for _, post := range posts {
		postIDs = append(postIDs, post.PostID)
		contentIDs = append(contentIDs, post.ContentID)
	}
	var comments []dbmodel.SocialPrivateContentComment
	if err := t.db.WithContext(ctx).
		Select("content_id").
		Where("post_id IN ?", postIDs).
		Find(&comments).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	for _, comment := range comments {
		contentIDs = append(contentIDs, comment.ContentID)
	}
	var snapshotIDs []string
	if err := t.db.WithContext(ctx).
		Model(&dbmodel.SocialPrivateAudienceSnapshot{}).
		Where("post_id IN ?", postIDs).
		Pluck("snapshot_id", &snapshotIDs).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	if len(snapshotIDs) > 0 {
		if err := t.db.WithContext(ctx).
			Model(&dbmodel.SocialPrivateRecipientGrant{}).
			Where(
				"snapshot_id IN ? AND recipient_ptid = ? AND revoked_at IS NULL",
				snapshotIDs,
				recipientPTID,
			).
			Updates(map[string]any{
				"revoked_at":    revokedAt,
				"revoke_reason": "RELATIONSHIP_BLOCKED",
			}).Error; err != nil {
			return mapFederatedFriendRequestPersistenceError(operation, err)
		}
	}
	var objectIDs []string
	if err := t.db.WithContext(ctx).
		Model(&dbmodel.SocialPrivateObjectAttachment{}).
		Where("content_id IN ?", contentIDs).
		Pluck("object_id", &objectIDs).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	if len(objectIDs) > 0 {
		if err := t.db.WithContext(ctx).
			Model(&dbmodel.SocialPrivateObjectGrant{}).
			Where(
				"object_id IN ? AND principal_ptid = ? AND revoked_at IS NULL",
				objectIDs,
				recipientPTID,
			).
			Updates(map[string]any{
				"revoked_at":    revokedAt,
				"revoke_reason": "RELATIONSHIP_BLOCKED",
			}).Error; err != nil {
			return mapFederatedFriendRequestPersistenceError(operation, err)
		}
	}
	if err := t.db.WithContext(ctx).
		Model(&dbmodel.SocialPrivateDeliveryIntent{}).
		Where(
			"content_id IN ? AND recipient_ptid = ? AND state = ?",
			contentIDs,
			recipientPTID,
			dbmodel.SocialPrivateDeliveryIntentStatePending,
		).
		Update(
			"state",
			dbmodel.SocialPrivateDeliveryIntentStateRevoked,
		).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(operation, err)
	}
	return nil
}

func socialRelationshipTransactionFromDelivery(
	transaction delivery.Transaction,
) (FederatedRelationshipTransaction, error) {
	if transaction == nil || transaction.DB() == nil || transaction.Outbox() == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.bind_relationship_delivery_transaction",
			"transaction",
			"must expose a database and outbox",
		)
	}
	afterCommit, ok := transaction.(delivery.AfterCommitRegistrar)
	if !ok {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.bind_relationship_delivery_transaction",
			"transaction",
			"must expose post-commit callbacks",
		)
	}
	return &federatedFriendRequestTransaction{
		db:          transaction.DB(),
		outbox:      transaction.Outbox(),
		afterCommit: afterCommit,
	}, nil
}

func socialRelationshipCommandModelFromDomain(
	record domain.SocialRelationshipCommandRecord,
) socialRelationshipCommandModel {
	return socialRelationshipCommandModel{
		ActorPTID:            record.ActorPTID,
		CommandID:            record.CommandID,
		CommandBytes:         append([]byte(nil), record.CommandBytes...),
		CommandPayloadSHA256: append([]byte(nil), record.CommandPayloadSHA256...),
		ResultBytes:          append([]byte(nil), record.ResultBytes...),
		CreatedAt:            record.CreatedAt.UTC(),
		ResolvedAt:           cloneTime(record.ResolvedAt),
	}
}

func socialRelationshipCommandFromModel(
	persisted socialRelationshipCommandModel,
) domain.SocialRelationshipCommandRecord {
	return domain.SocialRelationshipCommandRecord{
		ActorPTID:            persisted.ActorPTID,
		CommandID:            persisted.CommandID,
		CommandBytes:         append([]byte(nil), persisted.CommandBytes...),
		CommandPayloadSHA256: append([]byte(nil), persisted.CommandPayloadSHA256...),
		ResultBytes:          append([]byte(nil), persisted.ResultBytes...),
		CreatedAt:            persisted.CreatedAt.UTC(),
		ResolvedAt:           cloneTime(persisted.ResolvedAt),
	}
}

func cloneSocialRelationshipCommandRecord(
	record domain.SocialRelationshipCommandRecord,
) domain.SocialRelationshipCommandRecord {
	cloned := record
	cloned.CommandBytes = append([]byte(nil), record.CommandBytes...)
	cloned.CommandPayloadSHA256 = append(
		[]byte(nil),
		record.CommandPayloadSHA256...,
	)
	cloned.ResultBytes = append([]byte(nil), record.ResultBytes...)
	cloned.ResolvedAt = cloneTime(record.ResolvedAt)
	return cloned
}

func directionalRelationshipModelFromDomain(
	state domain.DirectionalRelationshipState,
) socialDirectionalRelationshipModel {
	return socialDirectionalRelationshipModel{
		ActorPTID:               state.ActorPTID,
		TargetActorPTID:         state.TargetActorPTID,
		ActorHomeStationPeerID:  state.ActorHomeStationPeerID,
		TargetHomeStationPeerID: state.TargetHomeStationPeerID,
		Blocked:                 state.Blocked,
		Revision:                state.Revision,
		LastEventHash:           append([]byte(nil), state.LastEventHash...),
		LastEventBytes:          append([]byte(nil), state.LastEventBytes...),
		BlockedAt:               cloneTime(state.BlockedAt),
		UpdatedAt:               state.UpdatedAt.UTC(),
	}
}

func directionalRelationshipFromModel(
	persisted socialDirectionalRelationshipModel,
) domain.DirectionalRelationshipState {
	return domain.DirectionalRelationshipState{
		ActorPTID:               persisted.ActorPTID,
		TargetActorPTID:         persisted.TargetActorPTID,
		ActorHomeStationPeerID:  persisted.ActorHomeStationPeerID,
		TargetHomeStationPeerID: persisted.TargetHomeStationPeerID,
		Blocked:                 persisted.Blocked,
		Revision:                persisted.Revision,
		LastEventHash:           append([]byte(nil), persisted.LastEventHash...),
		LastEventBytes:          append([]byte(nil), persisted.LastEventBytes...),
		BlockedAt:               cloneTime(persisted.BlockedAt),
		UpdatedAt:               persisted.UpdatedAt.UTC(),
	}
}

type relationshipCursor struct {
	BlockedAt       time.Time `json:"blocked_at"`
	TargetActorPTID string    `json:"target_actor_ptid"`
}

func encodeRelationshipCursor(cursor relationshipCursor) (string, error) {
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", mapFederatedFriendRequestPersistenceError(
			"social.encode_relationship_cursor",
			err,
		)
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func decodeRelationshipCursor(
	value string,
) (*relationshipCursor, error) {
	if value == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.decode_relationship_cursor",
			"cursor",
			"is invalid",
		)
	}
	var cursor relationshipCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil ||
		cursor.BlockedAt.IsZero() ||
		cursor.TargetActorPTID == "" {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.decode_relationship_cursor",
			"cursor",
			"is invalid",
		)
	}
	return &cursor, nil
}

func humanActorReference(ptid string) *model.ActorRef {
	return &model.ActorRef{
		Ptid: ptid,
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
}

var _ FederatedRelationshipStore = (*GORMFederatedFriendRequestStore)(nil)
var _ FederatedRelationshipTransaction = (*federatedFriendRequestTransaction)(nil)
