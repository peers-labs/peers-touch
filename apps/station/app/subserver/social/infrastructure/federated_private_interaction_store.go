package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
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
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	federatedPrivateInteractionPending  = "PENDING_RESULT"
	federatedPrivateInteractionResolved = "RESOLVED"
)

type federatedPrivateInteractionModel struct {
	ActorPTID           string `gorm:"column:actor_ptid;primaryKey;size:255"`
	CommandID           string `gorm:"column:command_id;primaryKey;size:255"`
	SourceStationPeerID string `gorm:"column:source_station_peer_id;primaryKey;size:512"`

	CanonicalCommandSHA256 []byte     `gorm:"column:canonical_command_sha256;type:bytea;not null"`
	CommandBytes           []byte     `gorm:"column:command_bytes;type:bytea;not null"`
	ResultBytes            []byte     `gorm:"column:result_bytes;type:bytea"`
	State                  string     `gorm:"column:state;size:32;not null;index"`
	CreatedAt              time.Time  `gorm:"column:created_at;not null"`
	ResolvedAt             *time.Time `gorm:"column:resolved_at"`
}

func (federatedPrivateInteractionModel) TableName() string {
	return "social_remote_private_commands"
}

type federatedPrivateReactionProjectionModel struct {
	SourceStationPeerID string `gorm:"column:source_station_peer_id;primaryKey;size:512"`
	PostID              string `gorm:"column:post_id;primaryKey;size:128"`
	CommentID           string `gorm:"column:comment_id;primaryKey;size:128;not null;default:''"`
	ViewerPTID          string `gorm:"column:viewer_ptid;primaryKey;size:255"`

	ProjectionRevision uint64    `gorm:"column:projection_revision;not null"`
	CommandID          string    `gorm:"column:command_id;size:255;not null"`
	ProjectionBytes    []byte    `gorm:"column:projection_bytes;type:bytea;not null"`
	UpdatedAt          time.Time `gorm:"column:updated_at;not null"`
}

func (federatedPrivateReactionProjectionModel) TableName() string {
	return "social_private_reaction_projections"
}

// Reconcile the real key (AutoMigrate alone does not widen composite keys),
// then translate the old derived Post bytes once. No legacy read path survives.
func migratePrivateReactionProjections(database *gorm.DB) error {
	return database.Transaction(func(tx *gorm.DB) error {
		switch tx.Dialector.Name() {
		case "sqlite":
			var columns []struct {
				Name string
				PK   int
			}
			if err := tx.Raw("PRAGMA table_info(social_private_reaction_projections)").Scan(&columns).Error; err != nil {
				return err
			}
			hasKey := false
			for _, column := range columns {
				hasKey = hasKey || (column.Name == "comment_id" && column.PK > 0)
			}
			if !hasKey {
				const temporary = "social_private_reaction_projections_migration"
				if tx.Migrator().HasTable(temporary) {
					return ErrPrivateContentConflict
				}
				if err := tx.Exec("ALTER TABLE social_private_reaction_projections RENAME TO " + temporary).Error; err != nil {
					return err
				}
				if err := tx.AutoMigrate(&federatedPrivateReactionProjectionModel{}); err != nil {
					return err
				}
				if err := tx.Exec(`INSERT INTO social_private_reaction_projections
					(source_station_peer_id, post_id, comment_id, viewer_ptid,
						projection_revision, command_id, projection_bytes, updated_at)
					SELECT source_station_peer_id, post_id, COALESCE(comment_id, ''), viewer_ptid,
						projection_revision, command_id, projection_bytes, updated_at
					FROM ` + temporary).Error; err != nil {
					return err
				}
				if err := tx.Migrator().DropTable(temporary); err != nil {
					return err
				}
			}
		case "postgres":
			var key struct{ Name, Definition string }
			if err := tx.Raw(`SELECT conname AS name, pg_get_constraintdef(oid) AS definition
				FROM pg_constraint WHERE conrelid = 'social_private_reaction_projections'::regclass AND contype = 'p'`).
				Scan(&key).Error; err != nil {
				return err
			}
			if !strings.Contains(key.Definition, "comment_id") {
				if key.Name != "" {
					if err := tx.Exec(`ALTER TABLE social_private_reaction_projections DROP CONSTRAINT "` +
						strings.ReplaceAll(key.Name, `"`, `""`) + `"`).Error; err != nil {
						return err
					}
				}
				if err := tx.Exec("ALTER TABLE social_private_reaction_projections ADD PRIMARY KEY (source_station_peer_id, post_id, comment_id, viewer_ptid)").Error; err != nil {
					return err
				}
			}
		case "mysql":
			var columns []struct{ ColumnName string }
			if err := tx.Raw(`SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
				WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_private_reaction_projections'
				AND CONSTRAINT_NAME = 'PRIMARY'`).Scan(&columns).Error; err != nil {
				return err
			}
			hasKey := false
			for _, column := range columns {
				hasKey = hasKey || column.ColumnName == "comment_id"
			}
			if !hasKey {
				if err := tx.Exec("ALTER TABLE social_private_reaction_projections DROP PRIMARY KEY, ADD PRIMARY KEY (source_station_peer_id, post_id, comment_id, viewer_ptid)").Error; err != nil {
					return err
				}
			}
		default:
			return ErrPrivateContentInvalid
		}
		var rows []federatedPrivateReactionProjectionModel
		if err := tx.Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			projection := &privatecontentpb.PrivateReactionProjection{}
			if err := proto.Unmarshal(row.ProjectionBytes, projection); err == nil &&
				projection.GetPostId() == row.PostID && projection.GetCommentId() == row.CommentID &&
				len(projection.ProtoReflect().GetUnknown()) == 0 {
				canonical, _, err := canonicalFederatedPrivateReactionProjection(row.PostID, row.CommentID, projection.GetReactions())
				if err == nil && bytes.Equal(canonical, row.ProjectionBytes) {
					continue
				}
			}
			legacy := &actormodel.Post{}
			if err := proto.Unmarshal(row.ProjectionBytes, legacy); err != nil || row.CommentID != "" || legacy.GetId() != row.PostID {
				return ErrPrivateContentConflict
			}
			oldCanonical, err := socialdomain.CanonicalProtoBytes(&actormodel.Post{Id: row.PostID, Reactions: legacy.GetReactions()})
			if err != nil || !bytes.Equal(oldCanonical, row.ProjectionBytes) {
				return ErrPrivateContentConflict
			}
			canonical, _, err := canonicalFederatedPrivateReactionProjection(row.PostID, "", legacy.GetReactions())
			if err != nil {
				return err
			}
			if err := tx.Model(&federatedPrivateReactionProjectionModel{}).
				Where("source_station_peer_id = ? AND post_id = ? AND comment_id = ? AND viewer_ptid = ?",
					row.SourceStationPeerID, row.PostID, row.CommentID, row.ViewerPTID).
				UpdateColumn("projection_bytes", canonical).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

type RemotePrivatePostAuthority struct {
	FederationID        string
	SourceStationPeerID string
	TargetStationPeerID string
	Parent              *securecontentpb.SecureResourceRef
}

type FederatedPrivateInteractionRecord struct {
	ActorPTID              string
	CommandID              string
	SourceStationPeerID    string
	CanonicalCommandSHA256 []byte
	CommandBytes           []byte
	ResultBytes            []byte
	State                  string
	CreatedAt              time.Time
	ResolvedAt             *time.Time
}

type FederatedPrivateReactionMutation struct {
	PostAuthorPTID     string
	Reactions          []socialdomain.Reaction
	ProjectionRevision uint64
}

type FederatedPrivateReactionProjection struct {
	SourceStationPeerID string
	PostID              string
	CommentID           string
	ViewerPTID          string
	ProjectionRevision  uint64
	CommandID           string
	Reactions           []*actormodel.ReactionSummary
	UpdatedAt           time.Time
}

type FederatedPrivateInteractionStore interface {
	FindRemotePrivatePostAuthority(
		context.Context,
		string,
		string,
	) (RemotePrivatePostAuthority, error)
	ValidateRemotePrivateCommentParent(
		context.Context,
		delivery.Transaction,
		*privatecontentpb.FederatedPrivateResourceDelivery,
	) error
	ValidateRemotePrivateReactionParent(
		context.Context,
		delivery.Transaction,
		string,
		string,
		string,
		*securecontentpb.SecureResourceRef,
		string,
		string,
		string,
	) error
	LoadFederatedPrivateInteraction(
		context.Context,
		delivery.Transaction,
		string,
		string,
		string,
	) (*FederatedPrivateInteractionRecord, error)
	LoadFederatedPrivateInteractionByCommand(
		context.Context,
		delivery.Transaction,
		string,
		string,
	) (*FederatedPrivateInteractionRecord, error)
	PutFederatedPrivateInteraction(
		context.Context,
		delivery.Transaction,
		FederatedPrivateInteractionRecord,
	) (FederatedPrivateInteractionRecord, bool, error)
	ResolveFederatedPrivateInteraction(
		context.Context,
		delivery.Transaction,
		FederatedPrivateInteractionRecord,
		[]byte,
		time.Time,
	) (bool, error)
	BindFederationTransaction(
		delivery.Transaction,
	) (*GORMPrivateContentStore, error)
	FederatedPrivateCommentRetryAfter(
		context.Context,
		delivery.Transaction,
		string,
		string,
		time.Time,
		time.Duration,
		int64,
		int64,
	) (time.Duration, error)
	MutateFederatedPrivateReaction(
		context.Context,
		delivery.Transaction,
		string,
		*securecontentpb.SecureResourceRef,
		string,
		string,
		actormodel.ReactionKind,
		bool,
		time.Time,
	) (FederatedPrivateReactionMutation, error)
	PutFederatedPrivateReactionProjection(
		context.Context,
		delivery.Transaction,
		FederatedPrivateReactionProjection,
	) (bool, error)
	LoadFederatedPrivateReactionProjection(
		context.Context,
		delivery.Transaction,
		string,
		string,
		string,
		string,
	) (*FederatedPrivateReactionProjection, error)
	FindLocalPrivateReactionParent(context.Context, delivery.Transaction, string, string, string) (*securecontentpb.SecureResourceRef, error)
	ListPrivateTargetReactions(context.Context, delivery.Transaction, string, string) ([]socialdomain.Reaction, uint64, error)
	ListPrivateReactionRecipients(context.Context, delivery.Transaction, *securecontentpb.SecureResourceRef, string) ([]socialdomain.RecipientLocality, error)
	ValidateRemotePrivateReactionProjection(context.Context, delivery.Transaction, *privatecontentpb.FederatedPrivateResourceDelivery) error
}

func (s *GORMPrivateContentStore) ValidateRemotePrivateCommentParent(
	ctx context.Context,
	transaction delivery.Transaction,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
) error {
	if transaction == nil || transaction.DB() == nil ||
		message == nil || message.GetComment() == nil ||
		message.GetTargetActor() == nil {
		return ErrPrivateContentInvalid
	}
	var count int64
	if err := transaction.DB().WithContext(ctx).
		Model(&remotePrivateResourceModel{}).
		Where(
			"source_station_peer_id = ? AND content_id = ? AND target_actor_ptid = ? AND federation_id = ? AND target_station_peer_id = ? AND resource_kind = ? AND state = ?",
			message.GetSourceStationPeerId(),
			message.GetComment().GetPostId(),
			message.GetTargetActor().GetPtid(),
			message.GetFederationId(),
			message.GetTargetStationPeerId(),
			int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST),
			remotePrivateResourceStateActive,
		).
		Count(&count).Error; err != nil {
		return fmt.Errorf("social remote private Comment parent read: %w", err)
	}
	if count != 1 {
		var tombstoneCount int64
		if err := transaction.DB().WithContext(ctx).
			Model(&remotePrivateTombstoneModel{}).
			Where(
				"source_station_peer_id = ? AND content_id = ? AND target_actor_ptid = ?",
				message.GetSourceStationPeerId(),
				message.GetComment().GetPostId(),
				message.GetTargetActor().GetPtid(),
			).
			Count(&tombstoneCount).Error; err != nil {
			return fmt.Errorf(
				"social remote private Comment parent tombstone read: %w",
				err,
			)
		}
		if tombstoneCount != 0 {
			return ErrPrivateContentStaleRevision
		}
		return ErrPrivateContentNotFound
	}
	return nil
}

func (s *GORMPrivateContentStore) ValidateRemotePrivateReactionParent(
	ctx context.Context,
	transaction delivery.Transaction,
	sourceStationPeerID string,
	targetStationPeerID string,
	federationID string,
	parent *securecontentpb.SecureResourceRef,
	commentID string,
	targetActorPTID string,
	targetDeviceID string,
) error {
	if strings.TrimSpace(targetDeviceID) == "" {
		return ErrPrivateContentInvalid
	}
	return s.validateRemotePrivateReactionTarget(ctx, transaction, sourceStationPeerID,
		targetStationPeerID, federationID, parent, commentID, targetActorPTID, targetDeviceID)
}

func (s *GORMPrivateContentStore) ValidateRemotePrivateReactionProjection(
	ctx context.Context, transaction delivery.Transaction, message *privatecontentpb.FederatedPrivateResourceDelivery,
) error {
	return s.validateRemotePrivateReactionTarget(ctx, transaction, message.GetSourceStationPeerId(),
		message.GetTargetStationPeerId(), message.GetFederationId(), message.GetResource(),
		message.GetReaction().GetCommentId(), message.GetTargetActor().GetPtid(), "")
}

func (s *GORMPrivateContentStore) validateRemotePrivateReactionTarget(
	ctx context.Context, transaction delivery.Transaction,
	sourceStationPeerID, targetStationPeerID, federationID string,
	parent *securecontentpb.SecureResourceRef, commentID, targetActorPTID, targetDeviceID string,
) error {
	if transaction == nil || transaction.DB() == nil ||
		strings.TrimSpace(sourceStationPeerID) == "" ||
		strings.TrimSpace(targetStationPeerID) == "" ||
		strings.TrimSpace(federationID) == "" ||
		parent == nil ||
		parent.GetOwnerDomain() !=
			securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		parent.GetGeneration() == 0 ||
		strings.TrimSpace(targetActorPTID) == "" {
		return ErrPrivateContentInvalid
	}
	var count int64
	if err := transaction.DB().WithContext(ctx).
		Model(&remotePrivateResourceModel{}).
		Where(
			"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ? AND federation_id = ? AND target_station_peer_id = ? AND resource_kind = ? AND state = ?",
			sourceStationPeerID,
			parent.GetContentId(),
			parent.GetGeneration(),
			targetActorPTID,
			federationID,
			targetStationPeerID,
			int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST),
			remotePrivateResourceStateActive,
		).
		Count(&count).Error; err != nil {
		return fmt.Errorf("social remote private Reaction parent read: %w", err)
	}
	if count != 1 {
		var tombstones int64
		if err := transaction.DB().WithContext(ctx).Model(&remotePrivateTombstoneModel{}).
			Where("source_station_peer_id = ? AND content_id = ? AND target_actor_ptid = ?",
				sourceStationPeerID, parent.GetContentId(), targetActorPTID).Count(&tombstones).Error; err != nil {
			return err
		}
		if tombstones > 0 {
			return ErrPrivateContentStaleRevision
		}
		return ErrPrivateContentNotFound
	}
	var parentRow remotePrivateResourceModel
	if err := transaction.DB().WithContext(ctx).Where(
		"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ?",
		sourceStationPeerID, parent.GetContentId(), parent.GetGeneration(), targetActorPTID).First(&parentRow).Error; err != nil {
		return err
	}
	blocked, err := remotePrivateRelationshipBlocked(ctx, transaction.DB(), targetActorPTID, parentRow.AuthorPTID)
	if err != nil {
		return err
	}
	if blocked {
		return ErrPrivateContentStaleRevision
	}
	if targetDeviceID != "" {
		if _, err := loadRemotePrivatePost(ctx, transaction.DB(), parent.GetContentId(), targetActorPTID, targetDeviceID); err != nil {
			return err
		}
	}
	if commentID != "" {
		var comment remotePrivateResourceModel
		if err := transaction.DB().WithContext(ctx).Where(
			"source_station_peer_id = ? AND content_id = ? AND parent_content_id = ? AND target_actor_ptid = ? AND federation_id = ? AND target_station_peer_id = ? AND resource_kind = ? AND state = ?",
			sourceStationPeerID, commentID, parent.GetContentId(), targetActorPTID,
			federationID, targetStationPeerID,
			int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT),
			remotePrivateResourceStateActive,
		).First(&comment).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				var tombstones int64
				if err := transaction.DB().Model(&remotePrivateTombstoneModel{}).
					Where("source_station_peer_id = ? AND content_id = ? AND target_actor_ptid = ?",
						sourceStationPeerID, commentID, targetActorPTID).Count(&tombstones).Error; err != nil {
					return err
				}
				if tombstones > 0 {
					return ErrPrivateContentStaleRevision
				}
				return ErrPrivateContentNotFound
			}
			return err
		}
		metadata := &privatecontentpb.CommentMetadata{}
		if err := proto.Unmarshal(comment.ViewerMetadataBytes, metadata); err != nil ||
			metadata.GetPostId() != parent.GetContentId() || metadata.GetCommentId() != commentID ||
			metadata.GetIsDeleted() {
			return ErrPrivateContentConflict
		}
		blocked, err := remotePrivateRelationshipBlocked(ctx, transaction.DB(), targetActorPTID, metadata.GetAuthor().GetPtid())
		if err != nil {
			return err
		}
		if blocked {
			return ErrPrivateContentStaleRevision
		}
		if targetDeviceID != "" {
			if _, _, err := loadRemotePrivateDelivery(ctx, transaction.DB(), comment, targetDeviceID, false); err != nil {
				return err
			}
		}
	}
	return nil
}

// Fanout uses the frozen original parent locality and revalidates the current
// parent/comment authority before exposing a viewer-specific summary.
func (s *GORMPrivateContentStore) ListPrivateReactionRecipients(
	ctx context.Context, transaction delivery.Transaction, parent *securecontentpb.SecureResourceRef, commentID string,
) ([]socialdomain.RecipientLocality, error) {
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil || parent == nil {
		return nil, ErrPrivateContentInvalid
	}
	var post dbmodel.SocialPrivateContentPost
	if err := database.WithContext(ctx).Where("post_id = ? AND generation = ? AND lifecycle_state = ? AND deleted_at IS NULL",
		parent.GetContentId(), parent.GetGeneration(), privateContentLifecycleActive).First(&post).Error; err != nil {
		return nil, err
	}
	var plan dbmodel.SocialPrivateContentPlan
	if err := database.WithContext(ctx).Where("content_id = ? AND generation = ? AND audience_snapshot_id = ? AND resource_kind = ?",
		post.ContentID, post.Generation, post.AudienceSnapshotID, PrivateContentResourcePost).First(&plan).Error; err != nil {
		return nil, err
	}
	digest := sha256.Sum256(plan.RecipientLocalitiesBytes)
	if !bytes.Equal(digest[:], plan.RecipientLocalitiesSHA256) {
		return nil, ErrPrivateContentConflict
	}
	localities, err := socialdomain.ParseCanonicalRecipientLocalities(plan.RecipientLocalitiesBytes)
	if err != nil {
		return nil, err
	}
	localities = append(localities, socialdomain.RecipientLocality{ActorPTID: post.AuthorPTID, HomeStationPeerID: plan.AuthorHomeStationPeerID})
	visible := make([]socialdomain.RecipientLocality, 0, len(localities))
	for _, target := range localities {
		current, err := s.FindLocalPrivateReactionParent(ctx, transaction, post.PostID, commentID, target.ActorPTID)
		if errors.Is(err, ErrPrivateContentNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !proto.Equal(current, parent) {
			return nil, ErrPrivateContentConflict
		}
		visible = append(visible, target)
	}
	return visible, nil
}

func (s *GORMPrivateContentStore) FindLocalPrivateReactionParent(
	ctx context.Context, transaction delivery.Transaction, postID, commentID, actorPTID string,
) (*securecontentpb.SecureResourceRef, error) {
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, err
	}
	var post dbmodel.SocialPrivateContentPost
	if err := database.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL", postID, privateContentLifecycleActive).
		First(&post).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPrivateContentNotFound
		}
		return nil, err
	}
	if err := authorizePrivatePostViewer(database, post, actorPTID); err != nil {
		return nil, err
	}
	if commentID != "" {
		var comment dbmodel.SocialPrivateContentComment
		if err := privateCommentVisibilityScope(database, post, actorPTID).
			Where("comment_id = ? AND post_id = ?", commentID, postID).First(&comment).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, ErrPrivateContentNotFound
			}
			return nil, err
		}
	}
	return &securecontentpb.SecureResourceRef{
		OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
		ContentId:   post.ContentID, Generation: post.Generation,
	}, nil
}

func (s *GORMPrivateContentStore) ListPrivateTargetReactions(
	ctx context.Context, transaction delivery.Transaction, postID, commentID string,
) ([]socialdomain.Reaction, uint64, error) {
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, 0, err
	}
	var maximum sql.NullInt64
	if err := database.WithContext(ctx).Model(&federatedPrivateReactionProjectionModel{}).
		Select("MAX(projection_revision)").Where("post_id = ? AND comment_id = ?", postID, commentID).
		Row().Scan(&maximum); err != nil {
		return nil, 0, err
	}
	if !maximum.Valid {
		return nil, 0, nil
	}
	repository := &reactionRepo{db: database, identity: NewActorIdentity(database)}
	reactions, err := repository.listByTarget(ctx, database, postID, commentID)
	return reactions, uint64(maximum.Int64), err
}

func (s *GORMPrivateContentStore) FindRemotePrivatePostAuthority(
	ctx context.Context,
	postID string,
	actorPTID string,
) (RemotePrivatePostAuthority, error) {
	if strings.TrimSpace(postID) == "" || strings.TrimSpace(actorPTID) == "" {
		return RemotePrivatePostAuthority{}, ErrPrivateContentInvalid
	}
	var rows []remotePrivateResourceModel
	if err := s.db.WithContext(ctx).
		Where(
			"content_id = ? AND target_actor_ptid = ? AND resource_kind = ? AND state = ?",
			postID,
			actorPTID,
			int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST),
			remotePrivateResourceStateActive,
		).
		Limit(2).
		Find(&rows).Error; err != nil {
		return RemotePrivatePostAuthority{}, fmt.Errorf(
			"social remote private parent lookup: %w",
			err,
		)
	}
	if len(rows) == 0 {
		return RemotePrivatePostAuthority{}, ErrPrivateContentNotFound
	}
	if len(rows) != 1 {
		return RemotePrivatePostAuthority{}, ErrPrivateContentConflict
	}
	payload := &securecontentpb.EncryptedPayload{}
	if err := unmarshalRemotePrivateProjectionPart(
		"parent payload",
		rows[0].EncryptedPayloadBytes,
		payload,
	); err != nil {
		return RemotePrivatePostAuthority{}, err
	}
	if payload.GetResource() == nil ||
		payload.GetResource().GetContentId() != postID {
		return RemotePrivatePostAuthority{}, ErrPrivateContentConflict
	}
	return RemotePrivatePostAuthority{
		FederationID:        rows[0].FederationID,
		SourceStationPeerID: rows[0].SourceStationPeerID,
		TargetStationPeerID: rows[0].TargetStationPeerID,
		Parent: proto.Clone(
			payload.GetResource(),
		).(*securecontentpb.SecureResourceRef),
	}, nil
}

func (s *GORMPrivateContentStore) LoadFederatedPrivateInteraction(
	ctx context.Context,
	transaction delivery.Transaction,
	actorPTID string,
	commandID string,
	sourceStationPeerID string,
) (*FederatedPrivateInteractionRecord, error) {
	if strings.TrimSpace(actorPTID) == "" ||
		strings.TrimSpace(commandID) == "" ||
		strings.TrimSpace(sourceStationPeerID) == "" {
		return nil, ErrPrivateContentInvalid
	}
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, err
	}
	var row federatedPrivateInteractionModel
	err = database.WithContext(ctx).Where(
		"actor_ptid = ? AND command_id = ? AND source_station_peer_id = ?",
		actorPTID,
		commandID,
		sourceStationPeerID,
	).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("social private interaction read: %w", err)
	}
	record := federatedPrivateInteractionRecord(row)
	return &record, nil
}

func (s *GORMPrivateContentStore) LoadFederatedPrivateInteractionByCommand(
	ctx context.Context,
	transaction delivery.Transaction,
	commandID string,
	sourceStationPeerID string,
) (*FederatedPrivateInteractionRecord, error) {
	if strings.TrimSpace(commandID) == "" ||
		strings.TrimSpace(sourceStationPeerID) == "" {
		return nil, ErrPrivateContentInvalid
	}
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, err
	}
	var rows []federatedPrivateInteractionModel
	if err := database.WithContext(ctx).Where(
		"command_id = ? AND source_station_peer_id = ?",
		commandID,
		sourceStationPeerID,
	).Limit(2).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("social private interaction result read: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	if len(rows) != 1 {
		return nil, ErrPrivateContentConflict
	}
	record := federatedPrivateInteractionRecord(rows[0])
	return &record, nil
}

func (s *GORMPrivateContentStore) PutFederatedPrivateInteraction(
	ctx context.Context,
	transaction delivery.Transaction,
	candidate FederatedPrivateInteractionRecord,
) (FederatedPrivateInteractionRecord, bool, error) {
	if err := validateFederatedPrivateInteractionRecord(candidate); err != nil {
		return FederatedPrivateInteractionRecord{}, false, err
	}
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return FederatedPrivateInteractionRecord{}, false, err
	}
	row := federatedPrivateInteractionModelFromRecord(candidate)
	create := database.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&row)
	if create.Error != nil {
		return FederatedPrivateInteractionRecord{}, false, fmt.Errorf(
			"social private interaction insert: %w",
			create.Error,
		)
	}
	if create.RowsAffected == 1 {
		return candidate, true, nil
	}
	existing, err := s.LoadFederatedPrivateInteraction(
		ctx,
		transaction,
		candidate.ActorPTID,
		candidate.CommandID,
		candidate.SourceStationPeerID,
	)
	if err != nil {
		return FederatedPrivateInteractionRecord{}, false, err
	}
	if existing == nil {
		return FederatedPrivateInteractionRecord{}, false, ErrPrivateContentConflict
	}
	return *existing, false, nil
}

func (s *GORMPrivateContentStore) ResolveFederatedPrivateInteraction(
	ctx context.Context,
	transaction delivery.Transaction,
	expected FederatedPrivateInteractionRecord,
	resultBytes []byte,
	resolvedAt time.Time,
) (bool, error) {
	if err := validateFederatedPrivateInteractionRecord(expected); err != nil {
		return false, err
	}
	if len(resultBytes) == 0 || resolvedAt.IsZero() {
		return false, ErrPrivateContentInvalid
	}
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return false, err
	}
	resolvedAt = resolvedAt.UTC()
	update := database.WithContext(ctx).
		Model(&federatedPrivateInteractionModel{}).
		Where(
			"actor_ptid = ? AND command_id = ? AND source_station_peer_id = ? AND canonical_command_sha256 = ? AND state = ?",
			expected.ActorPTID,
			expected.CommandID,
			expected.SourceStationPeerID,
			expected.CanonicalCommandSHA256,
			federatedPrivateInteractionPending,
		).
		Updates(map[string]any{
			"result_bytes": resultBytes,
			"state":        federatedPrivateInteractionResolved,
			"resolved_at":  resolvedAt,
		})
	if update.Error != nil {
		return false, fmt.Errorf("social private interaction resolve: %w", update.Error)
	}
	if update.RowsAffected == 1 {
		return false, nil
	}
	current, err := s.LoadFederatedPrivateInteraction(
		ctx,
		transaction,
		expected.ActorPTID,
		expected.CommandID,
		expected.SourceStationPeerID,
	)
	if err != nil {
		return false, err
	}
	if current == nil ||
		!bytes.Equal(current.CanonicalCommandSHA256, expected.CanonicalCommandSHA256) ||
		!bytes.Equal(current.CommandBytes, expected.CommandBytes) {
		return false, ErrPrivateContentConflict
	}
	if current.State == federatedPrivateInteractionResolved &&
		bytes.Equal(current.ResultBytes, resultBytes) {
		return true, nil
	}
	return false, ErrPrivateContentConflict
}

func (s *GORMPrivateContentStore) BindFederationTransaction(
	transaction delivery.Transaction,
) (*GORMPrivateContentStore, error) {
	if transaction == nil || transaction.DB() == nil {
		return nil, ErrPrivateContentInvalid
	}
	return &GORMPrivateContentStore{
		db:                    transaction.DB(),
		failpoint:             s.failpoint,
		federationTransaction: transaction,
	}, nil
}

func (s *GORMPrivateContentStore) FederatedPrivateCommentRetryAfter(
	ctx context.Context,
	transaction delivery.Transaction,
	postID string,
	actorPTID string,
	now time.Time,
	window time.Duration,
	actorLimit int64,
	postLimit int64,
) (time.Duration, error) {
	if transaction == nil || transaction.DB() == nil {
		return 0, ErrPrivateContentInvalid
	}
	return privateCommentRetryAfter(
		ctx,
		transaction.DB(),
		postID,
		actorPTID,
		now,
		window,
		actorLimit,
		postLimit,
	)
}

func (s *GORMPrivateContentStore) MutateFederatedPrivateReaction(
	ctx context.Context,
	transaction delivery.Transaction,
	sourceStationPeerID string,
	parent *securecontentpb.SecureResourceRef,
	commentID string,
	actorPTID string,
	kind actormodel.ReactionKind,
	remove bool,
	now time.Time,
) (FederatedPrivateReactionMutation, error) {
	if transaction == nil || transaction.DB() == nil ||
		strings.TrimSpace(sourceStationPeerID) == "" ||
		parent == nil ||
		parent.GetOwnerDomain() !=
			securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		strings.TrimSpace(actorPTID) == "" ||
		kind == actormodel.ReactionKind_REACTION_UNSPECIFIED ||
		actormodel.ReactionKind_name[int32(kind)] == "" ||
		now.IsZero() {
		return FederatedPrivateReactionMutation{}, ErrPrivateContentInvalid
	}
	database := transaction.DB().WithContext(ctx)
	var post dbmodel.SocialPrivateContentPost
	err := database.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
			parent.GetContentId(),
			privateContentLifecycleActive,
		).
		First(&post).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return FederatedPrivateReactionMutation{}, ErrPrivateContentNotFound
	}
	if err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	if post.ContentID != parent.GetContentId() ||
		post.Generation != parent.GetGeneration() {
		return FederatedPrivateReactionMutation{}, ErrPrivateContentNotFound
	}
	if err := authorizePrivatePostViewer(database, post, actorPTID); err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	if commentID != "" {
		var comment dbmodel.SocialPrivateContentComment
		if err := privateCommentVisibilityScope(database, post, actorPTID).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("comment_id = ? AND post_id = ?", commentID, post.PostID).
			First(&comment).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return FederatedPrivateReactionMutation{}, ErrPrivateContentNotFound
			}
			return FederatedPrivateReactionMutation{}, err
		}
	}
	actorID, err := NewActorIdentity(database).RequireID(ctx, actorPTID)
	if err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	if remove {
		if err := database.Where(
			"post_id = ? AND comment_id = ? AND actor_id = ? AND kind = ? AND post_class = ?",
			post.PostID,
			commentID,
			actorID,
			kind.String(),
			string(socialdomain.PostClassPrivate),
		).Delete(&dbmodel.SocialReaction{}).Error; err != nil {
			return FederatedPrivateReactionMutation{}, err
		}
	} else {
		row := dbmodel.SocialReaction{
			PostID:    post.PostID,
			CommentID: commentID,
			ActorID:   actorID,
			Kind:      kind.String(),
			PostClass: string(socialdomain.PostClassPrivate),
			CreatedAt: now.UTC(),
		}
		if err := database.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&row).Error; err != nil {
			return FederatedPrivateReactionMutation{}, err
		}
	}
	repository := &reactionRepo{
		db:       database,
		identity: NewActorIdentity(database),
	}
	reactions, err := repository.listByTarget(ctx, database, post.PostID, commentID)
	if err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	stats := database.Model(&dbmodel.SocialPrivateContentPost{}).
		Where(
			"post_id = ? AND generation = ? AND lifecycle_state = ? AND deleted_at IS NULL",
			post.PostID,
			post.Generation,
			privateContentLifecycleActive,
		)
	count := int64(len(reactions))
	if commentID != "" {
		stats = database.Model(&dbmodel.SocialPrivateContentComment{}).
			Where("post_id = ? AND comment_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
				post.PostID, commentID, privateContentLifecycleActive)
		count = 0
		for _, reaction := range reactions {
			if reaction.Kind == actormodel.ReactionKind_REACTION_LIKE {
				count++
			}
		}
	}
	if err := stats.UpdateColumn("reactions_count", count).Error; err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	var maximum sql.NullInt64
	if err := database.Model(&federatedPrivateReactionProjectionModel{}).
		Select("MAX(projection_revision)").
		Where(
			"source_station_peer_id = ? AND post_id = ? AND comment_id = ?",
			sourceStationPeerID,
			post.PostID,
			commentID,
		).
		Row().
		Scan(&maximum); err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	revision := uint64(1)
	if maximum.Valid {
		revision = uint64(maximum.Int64) + 1
	}
	return FederatedPrivateReactionMutation{
		PostAuthorPTID:     post.AuthorPTID,
		Reactions:          reactions,
		ProjectionRevision: revision,
	}, nil
}

func (s *GORMPrivateContentStore) PutFederatedPrivateReactionProjection(
	ctx context.Context,
	transaction delivery.Transaction,
	candidate FederatedPrivateReactionProjection,
) (bool, error) {
	if strings.TrimSpace(candidate.SourceStationPeerID) == "" ||
		strings.TrimSpace(candidate.PostID) == "" ||
		strings.TrimSpace(candidate.ViewerPTID) == "" ||
		candidate.ProjectionRevision == 0 ||
		strings.TrimSpace(candidate.CommandID) == "" ||
		candidate.UpdatedAt.IsZero() {
		return false, ErrPrivateContentInvalid
	}
	projectionBytes, reactions, err :=
		canonicalFederatedPrivateReactionProjection(
			candidate.PostID,
			candidate.CommentID,
			candidate.Reactions,
		)
	if err != nil {
		return false, err
	}
	candidate.Reactions = reactions
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return false, err
	}
	row := federatedPrivateReactionProjectionModel{
		SourceStationPeerID: candidate.SourceStationPeerID,
		PostID:              candidate.PostID,
		CommentID:           candidate.CommentID,
		ViewerPTID:          candidate.ViewerPTID,
		ProjectionRevision:  candidate.ProjectionRevision,
		CommandID:           candidate.CommandID,
		ProjectionBytes:     projectionBytes,
		UpdatedAt:           candidate.UpdatedAt.UTC(),
	}
	create := database.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&row)
	if create.Error != nil {
		return false, fmt.Errorf(
			"social private reaction projection insert: %w",
			create.Error,
		)
	}
	if create.RowsAffected == 1 {
		return true, nil
	}
	var current federatedPrivateReactionProjectionModel
	if err := database.WithContext(ctx).Where(
		"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ? AND comment_id = ?",
		row.SourceStationPeerID,
		row.PostID,
		row.ViewerPTID,
		row.CommentID,
	).First(&current).Error; err != nil {
		return false, fmt.Errorf(
			"social private reaction projection read: %w",
			err,
		)
	}
	if current.ProjectionRevision > row.ProjectionRevision {
		return false, nil
	}
	if current.ProjectionRevision == row.ProjectionRevision {
		if current.CommandID == row.CommandID &&
			bytes.Equal(current.ProjectionBytes, row.ProjectionBytes) {
			return false, nil
		}
		return false, ErrPrivateContentConflict
	}
	update := database.WithContext(ctx).
		Model(&federatedPrivateReactionProjectionModel{}).
		Where(
			"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ? AND comment_id = ? AND projection_revision < ?",
			row.SourceStationPeerID,
			row.PostID,
			row.ViewerPTID,
			row.CommentID,
			row.ProjectionRevision,
		).
		Updates(map[string]any{
			"projection_revision": row.ProjectionRevision,
			"command_id":          row.CommandID,
			"projection_bytes":    row.ProjectionBytes,
			"updated_at":          row.UpdatedAt,
		})
	if update.Error != nil {
		return false, fmt.Errorf(
			"social private reaction projection update: %w",
			update.Error,
		)
	}
	if update.RowsAffected == 1 {
		return true, nil
	}
	return false, ErrPrivateContentConflict
}

func (s *GORMPrivateContentStore) LoadFederatedPrivateReactionProjection(
	ctx context.Context,
	transaction delivery.Transaction,
	sourceStationPeerID string,
	postID string,
	commentID string,
	viewerPTID string,
) (*FederatedPrivateReactionProjection, error) {
	if strings.TrimSpace(sourceStationPeerID) == "" ||
		strings.TrimSpace(postID) == "" ||
		strings.TrimSpace(viewerPTID) == "" {
		return nil, ErrPrivateContentInvalid
	}
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, err
	}
	var row federatedPrivateReactionProjectionModel
	err = database.WithContext(ctx).Where(
		"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ? AND comment_id = ?",
		sourceStationPeerID,
		postID,
		viewerPTID,
		commentID,
	).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf(
			"social private reaction projection read: %w",
			err,
		)
	}
	projection := &privatecontentpb.PrivateReactionProjection{}
	if err := proto.Unmarshal(row.ProjectionBytes, projection); err != nil ||
		projection.GetPostId() != row.PostID || projection.GetCommentId() != row.CommentID {
		return nil, ErrPrivateContentConflict
	}
	canonical, reactions, err := canonicalFederatedPrivateReactionProjection(
		row.PostID,
		row.CommentID,
		projection.GetReactions(),
	)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(canonical, row.ProjectionBytes) {
		return nil, ErrPrivateContentConflict
	}
	return &FederatedPrivateReactionProjection{
		SourceStationPeerID: row.SourceStationPeerID,
		PostID:              row.PostID,
		CommentID:           row.CommentID,
		ViewerPTID:          row.ViewerPTID,
		ProjectionRevision:  row.ProjectionRevision,
		CommandID:           row.CommandID,
		Reactions:           reactions,
		UpdatedAt:           row.UpdatedAt.UTC(),
	}, nil
}

func privateInteractionDatabase(
	fallback *gorm.DB,
	transaction delivery.Transaction,
) (*gorm.DB, error) {
	if transaction != nil {
		if transaction.DB() == nil {
			return nil, ErrPrivateContentInvalid
		}
		return transaction.DB(), nil
	}
	if fallback == nil {
		return nil, ErrPrivateContentInvalid
	}
	return fallback, nil
}

func validateFederatedPrivateInteractionRecord(
	record FederatedPrivateInteractionRecord,
) error {
	if strings.TrimSpace(record.ActorPTID) == "" ||
		strings.TrimSpace(record.CommandID) == "" ||
		strings.TrimSpace(record.SourceStationPeerID) == "" ||
		len(record.CanonicalCommandSHA256) != 32 ||
		len(record.CommandBytes) == 0 ||
		record.CreatedAt.IsZero() {
		return ErrPrivateContentInvalid
	}
	if record.State == "" {
		record.State = federatedPrivateInteractionPending
	}
	if record.State != federatedPrivateInteractionPending &&
		record.State != federatedPrivateInteractionResolved {
		return ErrPrivateContentInvalid
	}
	return nil
}

func federatedPrivateInteractionModelFromRecord(
	record FederatedPrivateInteractionRecord,
) federatedPrivateInteractionModel {
	state := record.State
	if state == "" {
		state = federatedPrivateInteractionPending
	}
	return federatedPrivateInteractionModel{
		ActorPTID:              record.ActorPTID,
		CommandID:              record.CommandID,
		SourceStationPeerID:    record.SourceStationPeerID,
		CanonicalCommandSHA256: append([]byte(nil), record.CanonicalCommandSHA256...),
		CommandBytes:           append([]byte(nil), record.CommandBytes...),
		ResultBytes:            append([]byte(nil), record.ResultBytes...),
		State:                  state,
		CreatedAt:              record.CreatedAt.UTC(),
		ResolvedAt:             record.ResolvedAt,
	}
}

func federatedPrivateInteractionRecord(
	row federatedPrivateInteractionModel,
) FederatedPrivateInteractionRecord {
	return FederatedPrivateInteractionRecord{
		ActorPTID:              row.ActorPTID,
		CommandID:              row.CommandID,
		SourceStationPeerID:    row.SourceStationPeerID,
		CanonicalCommandSHA256: append([]byte(nil), row.CanonicalCommandSHA256...),
		CommandBytes:           append([]byte(nil), row.CommandBytes...),
		ResultBytes:            append([]byte(nil), row.ResultBytes...),
		State:                  row.State,
		CreatedAt:              row.CreatedAt.UTC(),
		ResolvedAt:             row.ResolvedAt,
	}
}

func canonicalFederatedPrivateReactionProjection(
	postID string,
	commentID string,
	reactions []*actormodel.ReactionSummary,
) ([]byte, []*actormodel.ReactionSummary, error) {
	if strings.TrimSpace(postID) == "" {
		return nil, nil, ErrPrivateContentInvalid
	}
	normalized := make(
		[]*actormodel.ReactionSummary,
		0,
		len(reactions),
	)
	seen := make(map[actormodel.ReactionKind]struct{}, len(reactions))
	for _, reaction := range reactions {
		if reaction == nil ||
			reaction.GetKind() ==
				actormodel.ReactionKind_REACTION_UNSPECIFIED ||
			actormodel.ReactionKind_name[int32(reaction.GetKind())] == "" ||
			reaction.GetCount() <= 0 {
			return nil, nil, ErrPrivateContentInvalid
		}
		if _, ok := seen[reaction.GetKind()]; ok {
			return nil, nil, ErrPrivateContentConflict
		}
		seen[reaction.GetKind()] = struct{}{}
		normalized = append(
			normalized,
			proto.Clone(reaction).(*actormodel.ReactionSummary),
		)
	}
	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].GetKind() < normalized[j].GetKind()
	})
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&privatecontentpb.PrivateReactionProjection{
			PostId:    postID,
			CommentId: commentID,
			Reactions: normalized,
		},
	)
	if err != nil {
		return nil, nil, fmt.Errorf(
			"%w: encode private reaction projection: %v",
			ErrPrivateContentInvalid,
			err,
		)
	}
	return canonical, normalized, nil
}
