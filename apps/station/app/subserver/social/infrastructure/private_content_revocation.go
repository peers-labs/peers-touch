package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrPrivateContentStaleRevision = errors.New(
	"private-content lifecycle revision is stale",
)

type sourcePrivateInvalidationModel struct {
	SourceStationPeerID string `gorm:"column:source_station_peer_id;primaryKey;size:512"`
	ContentID           string `gorm:"column:content_id;primaryKey;size:128"`
	Generation          uint64 `gorm:"column:generation;primaryKey"`
	TargetActorPTID     string `gorm:"column:target_actor_ptid;primaryKey;size:255"`

	TargetStationPeerID string    `gorm:"column:target_station_peer_id;size:512;not null"`
	FederationID        string    `gorm:"column:federation_id;size:512;not null"`
	LifecycleRevision   uint64    `gorm:"column:lifecycle_revision;not null"`
	Reason              int32     `gorm:"column:reason;not null"`
	CommittedAt         time.Time `gorm:"column:committed_at;not null"`
}

func (sourcePrivateInvalidationModel) TableName() string {
	return "social_private_resource_invalidations"
}

type remotePrivateTombstoneModel struct {
	SourceStationPeerID string `gorm:"column:source_station_peer_id;primaryKey;size:512"`
	ContentID           string `gorm:"column:content_id;primaryKey;size:128"`
	Generation          uint64 `gorm:"column:generation;primaryKey"`
	TargetActorPTID     string `gorm:"column:target_actor_ptid;primaryKey;size:255"`

	LifecycleRevision uint64    `gorm:"column:lifecycle_revision;not null"`
	Reason            int32     `gorm:"column:reason;not null"`
	CanonicalSHA256   []byte    `gorm:"column:canonical_sha256;type:bytea;not null"`
	CommittedAt       time.Time `gorm:"column:committed_at;not null"`
}

func (remotePrivateTombstoneModel) TableName() string {
	return "social_remote_private_tombstones"
}

type PrivateResourceInvalidationRequest struct {
	LocalStationPeerID string
	AuthorPTID         string
	RecipientPTID      string
	PostID             string
	AudienceKinds      []actormodel.Audience_Kind
	Reason             privatecontentpb.PrivateResourceInvalidationReason
	CommittedAt        time.Time
}

type RemotePrivateSuppressionRequest struct {
	ViewerPTID    string
	AuthorPTID    string
	AudienceKinds []actormodel.Audience_Kind
	Reason        privatecontentpb.PrivateResourceInvalidationReason
	CommittedAt   time.Time
}

type RemotePrivateInvalidationResult struct {
	Duplicate bool
	PostID    string
}

func (s *GORMPrivateContentStore) RemotePrivateResourceBlocked(
	ctx context.Context,
	transaction delivery.Transaction,
	viewerPTID string,
	authorPTID string,
) (bool, error) {
	if transaction == nil || transaction.DB() == nil ||
		strings.TrimSpace(viewerPTID) == "" ||
		strings.TrimSpace(authorPTID) == "" {
		return false, ErrPrivateContentInvalid
	}
	return remotePrivateRelationshipBlocked(
		ctx,
		transaction.DB(),
		viewerPTID,
		authorPTID,
	)
}

func remotePrivateRelationshipBlocked(
	ctx context.Context,
	database *gorm.DB,
	viewerPTID string,
	authorPTID string,
) (bool, error) {
	return NewBlockGraphRepository(database).IsBlockedBetween(
		ctx,
		viewerPTID,
		authorPTID,
	)
}

type sourcePrivateInvalidationCandidate struct {
	PostID                   string `gorm:"column:post_id"`
	ContentID                string `gorm:"column:content_id"`
	Generation               uint64 `gorm:"column:generation"`
	AudienceSnapshotID       string `gorm:"column:audience_snapshot_id"`
	AudienceKind             string `gorm:"column:audience_kind"`
	RecipientPTID            string `gorm:"column:recipient_ptid"`
	RecipientLocalitiesBytes []byte `gorm:"column:recipient_localities_bytes"`
}

func (s *GORMPrivateContentStore) StagePrivateResourceInvalidations(
	ctx context.Context,
	transaction delivery.Transaction,
	request PrivateResourceInvalidationRequest,
) ([]*privatecontentpb.FederatedPrivateResourceInvalidation, error) {
	if transaction == nil || transaction.DB() == nil ||
		strings.TrimSpace(request.LocalStationPeerID) == "" ||
		strings.TrimSpace(request.AuthorPTID) == "" ||
		request.CommittedAt.IsZero() ||
		!ValidPrivateInvalidationReason(request.Reason) {
		return nil, ErrPrivateContentInvalid
	}
	database := transaction.DB().WithContext(ctx)
	query := database.Table("social_private_posts AS post").
		Select(
			"post.post_id, post.content_id, post.generation, "+
				"post.audience_snapshot_id, snapshot.audience_kind, "+
				"recipient_grant.recipient_ptid, plan.recipient_localities_bytes",
		).
		Joins(
			"JOIN social_private_audience_snapshots AS snapshot "+
				"ON snapshot.snapshot_id = post.audience_snapshot_id",
		).
		Joins(
			"JOIN social_private_recipient_grants AS recipient_grant "+
				"ON recipient_grant.snapshot_id = post.audience_snapshot_id",
		).
		Joins(
			"JOIN social_private_content_plans AS plan "+
				"ON plan.content_id = post.content_id "+
				"AND plan.generation = post.generation "+
				"AND plan.domain_commit_id = post.post_id",
		).
		Where(
			"post.author_ptid = ? AND post.lifecycle_state = ? "+
				"AND post.deleted_at IS NULL "+
				"AND recipient_grant.revoked_at IS NULL",
			request.AuthorPTID,
			privateContentLifecycleActive,
		)
	if request.PostID != "" {
		query = query.Where("post.post_id = ?", request.PostID)
	}
	if request.RecipientPTID != "" {
		query = query.Where(
			"recipient_grant.recipient_ptid = ?",
			request.RecipientPTID,
		)
	}
	var candidates []sourcePrivateInvalidationCandidate
	if err := query.Order(
		"post.post_id ASC, recipient_grant.recipient_ptid ASC",
	).Scan(&candidates).Error; err != nil {
		return nil, fmt.Errorf("list private invalidation candidates: %w", err)
	}

	allowedAudiences := privateInvalidationAudienceSet(request.AudienceKinds)
	messages := make(
		[]*privatecontentpb.FederatedPrivateResourceInvalidation,
		0,
		len(candidates),
	)
	revokedSnapshots := make(map[string][]string)
	revokedPosts := make(map[string][]string)
	revokedContent := make(map[string][]string)
	for _, candidate := range candidates {
		if len(allowedAudiences) != 0 {
			if _, ok := allowedAudiences[candidate.AudienceKind]; !ok {
				continue
			}
		}
		revokedSnapshots[candidate.RecipientPTID] = append(
			revokedSnapshots[candidate.RecipientPTID],
			candidate.AudienceSnapshotID,
		)
		revokedPosts[candidate.RecipientPTID] = append(
			revokedPosts[candidate.RecipientPTID],
			candidate.PostID,
		)
		revokedContent[candidate.RecipientPTID] = append(
			revokedContent[candidate.RecipientPTID],
			candidate.ContentID,
		)

		localities, err := socialdomain.ParseCanonicalRecipientLocalities(
			candidate.RecipientLocalitiesBytes,
		)
		if err != nil {
			return nil, err
		}
		var locality *socialdomain.RecipientLocality
		for index := range localities {
			if localities[index].ActorPTID == candidate.RecipientPTID {
				locality = &localities[index]
				break
			}
		}
		if locality == nil {
			if candidate.RecipientPTID == request.AuthorPTID {
				continue
			}
			return nil, fmt.Errorf(
				"%w: recipient locality is missing for non-author recipient (localities=%d)",
				ErrPrivateContentConflict,
				len(localities),
			)
		}
		if locality.HomeStationPeerID == request.LocalStationPeerID {
			continue
		}
		if locality.FederationID == "" || locality.HomeStationPeerID == "" {
			return nil, fmt.Errorf(
				"%w: remote recipient locality is incomplete",
				ErrPrivateContentConflict,
			)
		}

		revision, err := stageSourcePrivateInvalidationRevision(
			database,
			request,
			candidate,
			*locality,
		)
		if err != nil {
			return nil, err
		}
		if err := s.afterWrite(
			ctx,
			PrivateContentBoundaryInvalidation,
		); err != nil {
			return nil, err
		}
		messages = append(
			messages,
			&privatecontentpb.FederatedPrivateResourceInvalidation{
				FormatVersion:       socialdomain.PrivateContentFormatVersion,
				FederationId:        locality.FederationID,
				SourceStationPeerId: request.LocalStationPeerID,
				TargetStationPeerId: locality.HomeStationPeerID,
				TargetActor: &actormodel.ActorRef{
					Ptid: candidate.RecipientPTID,
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
				Resource: &securecontentpb.SecureResourceRef{
					OwnerDomain: securecontentpb.
						SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
					ContentId:  candidate.ContentID,
					Generation: candidate.Generation,
				},
				LifecycleRevision: revision,
				Reason:            request.Reason,
				CommittedAt:       timestamppb.New(request.CommittedAt.UTC()),
			},
		)
	}

	for recipientPTID, snapshotIDs := range revokedSnapshots {
		if err := revokePrivateRecipientAccess(
			database,
			recipientPTID,
			uniqueSortedStrings(snapshotIDs),
			uniqueSortedStrings(revokedPosts[recipientPTID]),
			uniqueSortedStrings(revokedContent[recipientPTID]),
			request.Reason.String(),
			request.CommittedAt.UTC(),
		); err != nil {
			return nil, err
		}
	}
	return messages, nil
}

func stageSourcePrivateInvalidationRevision(
	database *gorm.DB,
	request PrivateResourceInvalidationRequest,
	candidate sourcePrivateInvalidationCandidate,
	locality socialdomain.RecipientLocality,
) (uint64, error) {
	var existing sourcePrivateInvalidationModel
	err := database.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ?",
		request.LocalStationPeerID,
		candidate.ContentID,
		candidate.Generation,
		candidate.RecipientPTID,
	).First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, fmt.Errorf("load source private invalidation: %w", err)
	}
	revision := candidate.Generation + 1
	if err == nil && existing.LifecycleRevision >= revision {
		revision = existing.LifecycleRevision + 1
	}
	row := sourcePrivateInvalidationModel{
		SourceStationPeerID: request.LocalStationPeerID,
		ContentID:           candidate.ContentID,
		Generation:          candidate.Generation,
		TargetActorPTID:     candidate.RecipientPTID,
		TargetStationPeerID: locality.HomeStationPeerID,
		FederationID:        locality.FederationID,
		LifecycleRevision:   revision,
		Reason:              int32(request.Reason),
		CommittedAt:         request.CommittedAt.UTC(),
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if createErr := database.Create(&row).Error; createErr != nil {
			return 0, fmt.Errorf("create source private invalidation: %w", createErr)
		}
		return revision, nil
	}
	update := database.Model(&sourcePrivateInvalidationModel{}).
		Where(
			"source_station_peer_id = ? AND content_id = ? AND generation = ? "+
				"AND target_actor_ptid = ? AND lifecycle_revision = ?",
			existing.SourceStationPeerID,
			existing.ContentID,
			existing.Generation,
			existing.TargetActorPTID,
			existing.LifecycleRevision,
		).
		Updates(map[string]any{
			"target_station_peer_id": locality.HomeStationPeerID,
			"federation_id":          locality.FederationID,
			"lifecycle_revision":     revision,
			"reason":                 int32(request.Reason),
			"committed_at":           request.CommittedAt.UTC(),
		})
	if update.Error != nil {
		return 0, fmt.Errorf("advance source private invalidation: %w", update.Error)
	}
	if update.RowsAffected != 1 {
		return 0, ErrPrivateContentConflict
	}
	return revision, nil
}

func revokePrivateRecipientAccess(
	database *gorm.DB,
	recipientPTID string,
	snapshotIDs []string,
	postIDs []string,
	contentIDs []string,
	reason string,
	revokedAt time.Time,
) error {
	if len(snapshotIDs) == 0 || len(postIDs) == 0 || len(contentIDs) == 0 {
		return nil
	}
	var childSnapshotIDs []string
	if err := database.Model(&dbmodel.SocialPrivateAudienceSnapshot{}).
		Where("post_id IN ?", postIDs).
		Pluck("snapshot_id", &childSnapshotIDs).Error; err != nil {
		return fmt.Errorf("list private recipient snapshots: %w", err)
	}
	snapshotIDs = uniqueSortedStrings(append(snapshotIDs, childSnapshotIDs...))
	var childContentIDs []string
	if err := database.Model(&dbmodel.SocialPrivateContentComment{}).
		Where("post_id IN ?", postIDs).
		Pluck("content_id", &childContentIDs).Error; err != nil {
		return fmt.Errorf("list private recipient Comments: %w", err)
	}
	contentIDs = uniqueSortedStrings(append(contentIDs, childContentIDs...))
	if err := database.Model(&dbmodel.SocialPrivateRecipientGrant{}).
		Where(
			"snapshot_id IN ? AND recipient_ptid = ? AND revoked_at IS NULL",
			snapshotIDs,
			recipientPTID,
		).
		Updates(map[string]any{
			"revoked_at":    revokedAt,
			"revoke_reason": reason,
		}).Error; err != nil {
		return fmt.Errorf("revoke private recipient access: %w", err)
	}
	var objectIDs []string
	if err := database.Model(&dbmodel.SocialPrivateObjectAttachment{}).
		Where("content_id IN ?", contentIDs).
		Pluck("object_id", &objectIDs).Error; err != nil {
		return fmt.Errorf("list private recipient objects: %w", err)
	}
	if len(objectIDs) != 0 {
		if err := database.Model(&dbmodel.SocialPrivateObjectGrant{}).
			Where(
				"object_id IN ? AND principal_ptid = ? AND revoked_at IS NULL",
				objectIDs,
				recipientPTID,
			).
			Updates(map[string]any{
				"revoked_at":    revokedAt,
				"revoke_reason": reason,
			}).Error; err != nil {
			return fmt.Errorf("revoke private object access: %w", err)
		}
	}
	if err := database.Model(&dbmodel.SocialPrivateDeliveryIntent{}).
		Where(
			"content_id IN ? AND recipient_ptid = ? AND state = ?",
			contentIDs,
			recipientPTID,
			dbmodel.SocialPrivateDeliveryIntentStatePending,
		).
		Update("state", dbmodel.SocialPrivateDeliveryIntentStateRevoked).
		Error; err != nil {
		return fmt.Errorf("revoke private delivery intent: %w", err)
	}
	return nil
}

func (s *GORMPrivateContentStore) SuppressRemotePrivateResources(
	ctx context.Context,
	transaction delivery.Transaction,
	request RemotePrivateSuppressionRequest,
) ([]string, error) {
	if transaction == nil || transaction.DB() == nil ||
		strings.TrimSpace(request.ViewerPTID) == "" ||
		strings.TrimSpace(request.AuthorPTID) == "" ||
		request.CommittedAt.IsZero() ||
		!ValidPrivateInvalidationReason(request.Reason) {
		return nil, ErrPrivateContentInvalid
	}
	database := transaction.DB().WithContext(ctx)
	var rows []remotePrivateResourceModel
	if err := database.Where(
		"target_actor_ptid = ? AND resource_kind = ? AND state = ?",
		request.ViewerPTID,
		int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST),
		remotePrivateResourceStateActive,
	).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list remote private resources for suppression: %w", err)
	}
	allowedAudiences := privateInvalidationAudienceSet(request.AudienceKinds)
	postIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		post := &privatecontentpb.PostMetadata{}
		if err := unmarshalRemotePrivateProjectionPart(
			"viewer metadata",
			row.ViewerMetadataBytes,
			post,
		); err != nil {
			return nil, err
		}
		if post.GetAuthor().GetPtid() != request.AuthorPTID {
			continue
		}
		if len(allowedAudiences) != 0 {
			if _, ok := allowedAudiences[post.GetAudienceKind().String()]; !ok {
				continue
			}
		}
		localHash := sha256.Sum256([]byte(fmt.Sprintf(
			"local-suppression\x00%s\x00%s\x00%d\x00%s\x00%d\x00%d",
			row.SourceStationPeerID,
			row.ContentID,
			row.Generation,
			row.TargetActorPTID,
			row.LifecycleRevision,
			request.Reason,
		)))
		applied, _, effectiveRevision, err := applyRemotePrivateTombstone(
			database,
			remotePrivateTombstoneModel{
				SourceStationPeerID: row.SourceStationPeerID,
				ContentID:           row.ContentID,
				Generation:          row.Generation,
				TargetActorPTID:     row.TargetActorPTID,
				LifecycleRevision:   row.LifecycleRevision,
				Reason:              int32(request.Reason),
				CanonicalSHA256:     localHash[:],
				CommittedAt:         request.CommittedAt.UTC(),
			},
		)
		if err != nil {
			return nil, err
		}
		if applied {
			if err := s.afterWrite(
				ctx,
				PrivateContentBoundaryRemoteTombstone,
			); err != nil {
				return nil, err
			}
		}
		if err := deleteRemotePrivateProjection(
			database,
			row.SourceStationPeerID,
			row.ContentID,
			row.Generation,
			row.TargetActorPTID,
			effectiveRevision,
		); err != nil {
			return nil, err
		}
		postIDs = append(postIDs, post.GetPostId())
	}
	sort.Strings(postIDs)
	return postIDs, nil
}

func (s *GORMPrivateContentStore) ApplyRemotePrivateResourceInvalidation(
	ctx context.Context,
	transaction delivery.Transaction,
	message *privatecontentpb.FederatedPrivateResourceInvalidation,
	canonical []byte,
) (RemotePrivateInvalidationResult, error) {
	if transaction == nil || transaction.DB() == nil ||
		message == nil || len(canonical) == 0 {
		return RemotePrivateInvalidationResult{}, ErrPrivateContentInvalid
	}
	target := message.GetTargetActor()
	resource := message.GetResource()
	if target == nil || resource == nil {
		return RemotePrivateInvalidationResult{}, ErrPrivateContentInvalid
	}
	digest := sha256.Sum256(canonical)
	database := transaction.DB().WithContext(ctx)
	applied, duplicate, effectiveRevision, err := applyRemotePrivateTombstone(
		database,
		remotePrivateTombstoneModel{
			SourceStationPeerID: message.GetSourceStationPeerId(),
			ContentID:           resource.GetContentId(),
			Generation:          resource.GetGeneration(),
			TargetActorPTID:     target.GetPtid(),
			LifecycleRevision:   message.GetLifecycleRevision(),
			Reason:              int32(message.GetReason()),
			CanonicalSHA256:     digest[:],
			CommittedAt:         message.GetCommittedAt().AsTime().UTC(),
		},
	)
	if err != nil {
		return RemotePrivateInvalidationResult{}, err
	}
	if applied {
		if err := s.afterWrite(
			ctx,
			PrivateContentBoundaryRemoteTombstone,
		); err != nil {
			return RemotePrivateInvalidationResult{}, err
		}
	}
	if err := deleteRemotePrivateProjection(
		database,
		message.GetSourceStationPeerId(),
		resource.GetContentId(),
		resource.GetGeneration(),
		target.GetPtid(),
		effectiveRevision,
	); err != nil {
		return RemotePrivateInvalidationResult{}, err
	}
	return RemotePrivateInvalidationResult{
		Duplicate: duplicate,
		PostID:    resource.GetContentId(),
	}, nil
}

func applyRemotePrivateTombstone(
	database *gorm.DB,
	candidate remotePrivateTombstoneModel,
) (bool, bool, uint64, error) {
	var existing remotePrivateTombstoneModel
	err := database.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ?",
		candidate.SourceStationPeerID,
		candidate.ContentID,
		candidate.Generation,
		candidate.TargetActorPTID,
	).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if createErr := database.Create(&candidate).Error; createErr != nil {
			return false, false, 0, fmt.Errorf(
				"create remote private tombstone: %w",
				createErr,
			)
		}
		return true, false, candidate.LifecycleRevision, nil
	}
	if err != nil {
		return false, false, 0, fmt.Errorf("load remote private tombstone: %w", err)
	}
	if existing.LifecycleRevision > candidate.LifecycleRevision {
		return false, true, existing.LifecycleRevision, nil
	}
	if existing.LifecycleRevision == candidate.LifecycleRevision {
		if bytes.Equal(existing.CanonicalSHA256, candidate.CanonicalSHA256) {
			return false, true, existing.LifecycleRevision, nil
		}
		return false, false, 0, ErrPrivateContentConflict
	}
	update := database.Model(&remotePrivateTombstoneModel{}).
		Where(
			"source_station_peer_id = ? AND content_id = ? AND generation = ? "+
				"AND target_actor_ptid = ? AND lifecycle_revision = ?",
			existing.SourceStationPeerID,
			existing.ContentID,
			existing.Generation,
			existing.TargetActorPTID,
			existing.LifecycleRevision,
		).
		Updates(map[string]any{
			"lifecycle_revision": candidate.LifecycleRevision,
			"reason":             candidate.Reason,
			"canonical_sha256":   candidate.CanonicalSHA256,
			"committed_at":       candidate.CommittedAt,
		})
	if update.Error != nil {
		return false, false, 0, fmt.Errorf("advance remote private tombstone: %w", update.Error)
	}
	if update.RowsAffected != 1 {
		return false, false, 0, ErrPrivateContentConflict
	}
	return true, false, candidate.LifecycleRevision, nil
}

func deleteRemotePrivateProjection(
	database *gorm.DB,
	sourceStationPeerID string,
	postContentID string,
	generation uint64,
	targetActorPTID string,
	maxLifecycleRevision uint64,
) error {
	var rows []remotePrivateResourceModel
	if err := database.Where(
		"source_station_peer_id = ? AND target_actor_ptid = ? AND "+
			"((content_id = ? AND generation = ? AND lifecycle_revision <= ?) "+
			"OR parent_content_id = ?)",
		sourceStationPeerID,
		targetActorPTID,
		postContentID,
		generation,
		maxLifecycleRevision,
		postContentID,
	).Find(&rows).Error; err != nil {
		return fmt.Errorf("list revoked remote private projection: %w", err)
	}
	if len(rows) == 0 {
		return nil
	}
	for _, row := range rows {
		if err := database.Where(
			"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ?",
			row.SourceStationPeerID,
			row.ContentID,
			row.Generation,
			row.TargetActorPTID,
		).Delete(&remotePrivateEnvelopeModel{}).Error; err != nil {
			return fmt.Errorf("delete revoked remote private envelopes: %w", err)
		}
	}
	if err := database.Where(
		"source_station_peer_id = ? AND target_actor_ptid = ? AND "+
			"((content_id = ? AND generation = ? AND lifecycle_revision <= ?) "+
			"OR parent_content_id = ?)",
		sourceStationPeerID,
		targetActorPTID,
		postContentID,
		generation,
		maxLifecycleRevision,
		postContentID,
	).Delete(&remotePrivateResourceModel{}).Error; err != nil {
		return fmt.Errorf("delete revoked remote private resources: %w", err)
	}
	if err := database.Where(
		"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ?",
		sourceStationPeerID,
		postContentID,
		targetActorPTID,
	).Delete(&federatedPrivateReactionProjectionModel{}).Error; err != nil {
		return fmt.Errorf("delete revoked remote private reactions: %w", err)
	}
	return nil
}

func rejectRemotePrivateDeliveryBehindTombstone(
	ctx context.Context,
	database *gorm.DB,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
) error {
	resource := message.GetResource()
	target := message.GetTargetActor()
	if resource == nil || target == nil {
		return ErrPrivateContentInvalid
	}
	var direct remotePrivateTombstoneModel
	err := database.WithContext(ctx).Where(
		"source_station_peer_id = ? AND content_id = ? AND generation = ? "+
			"AND target_actor_ptid = ? AND lifecycle_revision >= ?",
		message.GetSourceStationPeerId(),
		resource.GetContentId(),
		resource.GetGeneration(),
		target.GetPtid(),
		message.GetLifecycleRevision(),
	).First(&direct).Error
	if err == nil {
		return ErrPrivateContentStaleRevision
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("read remote private tombstone: %w", err)
	}
	if message.GetComment() == nil {
		return nil
	}
	var parentCount int64
	if err := database.WithContext(ctx).
		Model(&remotePrivateTombstoneModel{}).
		Where(
			"source_station_peer_id = ? AND content_id = ? AND target_actor_ptid = ?",
			message.GetSourceStationPeerId(),
			message.GetComment().GetPostId(),
			target.GetPtid(),
		).
		Count(&parentCount).Error; err != nil {
		return fmt.Errorf("read remote private parent tombstone: %w", err)
	}
	if parentCount != 0 {
		return ErrPrivateContentStaleRevision
	}
	return nil
}

func privateInvalidationAudienceSet(
	kinds []actormodel.Audience_Kind,
) map[string]struct{} {
	result := make(map[string]struct{}, len(kinds))
	for _, kind := range kinds {
		result[kind.String()] = struct{}{}
	}
	return result
}

func ValidPrivateInvalidationReason(
	reason privatecontentpb.PrivateResourceInvalidationReason,
) bool {
	switch reason {
	case privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RESOURCE_DELETED,
		privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RELATIONSHIP_REVOKED,
		privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RECIPIENT_BLOCKED:
		return true
	default:
		return false
	}
}
