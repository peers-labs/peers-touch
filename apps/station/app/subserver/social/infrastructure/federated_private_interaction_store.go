package infrastructure

import (
	"bytes"
	"context"
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
	ViewerPTID          string `gorm:"column:viewer_ptid;primaryKey;size:255"`

	ProjectionRevision uint64    `gorm:"column:projection_revision;not null"`
	CommandID          string    `gorm:"column:command_id;size:255;not null"`
	ProjectionBytes    []byte    `gorm:"column:projection_bytes;type:bytea;not null"`
	UpdatedAt          time.Time `gorm:"column:updated_at;not null"`
}

func (federatedPrivateReactionProjectionModel) TableName() string {
	return "social_private_reaction_projections"
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
	) (*FederatedPrivateReactionProjection, error)
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
	targetActorPTID string,
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
		return ErrPrivateContentNotFound
	}
	return nil
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
	actorID, err := NewActorIdentity(database).RequireID(ctx, actorPTID)
	if err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	if remove {
		if err := database.Where(
			"post_id = ? AND actor_id = ? AND kind = ? AND post_class = ?",
			post.PostID,
			actorID,
			kind.String(),
			string(socialdomain.PostClassPrivate),
		).Delete(&dbmodel.SocialReaction{}).Error; err != nil {
			return FederatedPrivateReactionMutation{}, err
		}
	} else {
		row := dbmodel.SocialReaction{
			PostID:    post.PostID,
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
	reactions, err := repository.listByPost(ctx, database, post.PostID)
	if err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	if err := database.Model(&dbmodel.SocialPrivateContentPost{}).
		Where(
			"post_id = ? AND generation = ? AND lifecycle_state = ? AND deleted_at IS NULL",
			post.PostID,
			post.Generation,
			privateContentLifecycleActive,
		).
		UpdateColumn("reactions_count", len(reactions)).Error; err != nil {
		return FederatedPrivateReactionMutation{}, err
	}
	var maximum sql.NullInt64
	if err := database.Model(&federatedPrivateReactionProjectionModel{}).
		Select("MAX(projection_revision)").
		Where(
			"source_station_peer_id = ? AND post_id = ?",
			sourceStationPeerID,
			post.PostID,
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
		"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ?",
		row.SourceStationPeerID,
		row.PostID,
		row.ViewerPTID,
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
			"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ? AND projection_revision < ?",
			row.SourceStationPeerID,
			row.PostID,
			row.ViewerPTID,
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
		"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ?",
		sourceStationPeerID,
		postID,
		viewerPTID,
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
	post := &actormodel.Post{}
	if err := proto.Unmarshal(row.ProjectionBytes, post); err != nil ||
		post.GetId() != row.PostID {
		return nil, ErrPrivateContentConflict
	}
	canonical, reactions, err := canonicalFederatedPrivateReactionProjection(
		row.PostID,
		post.GetReactions(),
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
		&actormodel.Post{
			Id:        postID,
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
