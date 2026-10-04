package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
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
