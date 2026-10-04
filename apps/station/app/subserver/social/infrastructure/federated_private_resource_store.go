package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const remotePrivateResourceStateActive = "ACTIVE"

type remotePrivateResourceModel struct {
	SourceStationPeerID string `gorm:"column:source_station_peer_id;primaryKey;size:512;uniqueIndex:uidx_social_remote_private_delivery,priority:1"`
	ContentID           string `gorm:"column:content_id;primaryKey;size:128;index:idx_social_remote_private_reconcile,priority:5"`
	Generation          uint64 `gorm:"column:generation;primaryKey"`
	TargetActorPTID     string `gorm:"column:target_actor_ptid;primaryKey;size:255;uniqueIndex:uidx_social_remote_private_delivery,priority:2;index:idx_social_remote_private_reconcile,priority:1"`

	FederationID          string    `gorm:"column:federation_id;size:512;not null"`
	DeliveryID            string    `gorm:"column:delivery_id;size:512;not null;uniqueIndex:uidx_social_remote_private_delivery,priority:3"`
	TargetStationPeerID   string    `gorm:"column:target_station_peer_id;size:512;not null"`
	AuthorPTID            string    `gorm:"column:author_ptid;size:255;not null;default:''"`
	ParentContentID       string    `gorm:"column:parent_content_id;size:128;not null;default:'';index"`
	LifecycleRevision     uint64    `gorm:"column:lifecycle_revision;not null"`
	ResourceKind          int32     `gorm:"column:resource_kind;not null;index:idx_social_remote_private_reconcile,priority:2"`
	ViewerMetadataBytes   []byte    `gorm:"column:viewer_metadata_bytes;type:bytea;not null"`
	EncryptedPayloadBytes []byte    `gorm:"column:encrypted_payload_bytes;type:bytea;not null"`
	ObjectDescriptorBytes []byte    `gorm:"column:object_descriptor_set_bytes;type:bytea;not null"`
	VerificationBytes     []byte    `gorm:"column:verification_bytes;type:bytea;not null"`
	AudienceBytes         []byte    `gorm:"column:audience_explanation_bytes;type:bytea;not null"`
	CanonicalDeliveryHash []byte    `gorm:"column:canonical_delivery_sha256;type:bytea;not null"`
	State                 string    `gorm:"column:state;size:32;not null;index;index:idx_social_remote_private_reconcile,priority:3"`
	CommittedAt           time.Time `gorm:"column:committed_at;not null;index:idx_social_remote_private_reconcile,priority:4"`
	UpdatedAt             time.Time `gorm:"column:updated_at;not null"`
}

func (remotePrivateResourceModel) TableName() string {
	return "social_remote_private_resources"
}

type remotePrivateEnvelopeModel struct {
	SourceStationPeerID string `gorm:"column:source_station_peer_id;primaryKey;size:512"`
	ContentID           string `gorm:"column:content_id;primaryKey;size:128"`
	Generation          uint64 `gorm:"column:generation;primaryKey"`
	TargetActorPTID     string `gorm:"column:target_actor_ptid;primaryKey;size:255"`
	RecipientKeyKind    int32  `gorm:"column:recipient_key_kind;primaryKey"`
	RecipientDeviceID   string `gorm:"column:recipient_device_id;primaryKey;size:128"`
	OneTimeKeyID        string `gorm:"column:one_time_key_id;primaryKey;size:128"`

	EnvelopeBytes  []byte `gorm:"column:envelope_bytes;type:bytea;not null"`
	PrincipalEpoch uint64 `gorm:"column:principal_epoch;not null"`
}

func (remotePrivateEnvelopeModel) TableName() string {
	return "social_remote_private_envelopes"
}

func RemotePrivateContentModels() []any {
	return []any{
		&remotePrivateResourceModel{},
		&remotePrivateEnvelopeModel{},
		&sourcePrivateInvalidationModel{},
		&remotePrivateTombstoneModel{},
		&federatedPrivateInteractionModel{},
		&federatedPrivateReactionProjectionModel{},
	}
}

type RemotePrivatePostReadModel struct {
	Delivery *privatecontentpb.FederatedPrivateResourceDelivery
}

type RemotePrivateCommentReadModel struct {
	Delivery *privatecontentpb.FederatedPrivateResourceDelivery
}

type RemotePrivateCommentPage struct {
	Comments []*RemotePrivateCommentReadModel
	HasMore  bool
}

func migrateRemotePrivateResources(database *gorm.DB) error {
	if err := database.AutoMigrate(RemotePrivateContentModels()...); err != nil {
		return fmt.Errorf("social remote private resource migrate: %w", err)
	}
	return backfillRemotePrivateResourceAuthors(database)
}

func backfillRemotePrivateResourceAuthors(database *gorm.DB) error {
	var rows []remotePrivateResourceModel
	if err := database.Where("author_ptid = ''").Find(&rows).Error; err != nil {
		return fmt.Errorf("list remote private resource author backfill: %w", err)
	}
	for _, row := range rows {
		authorPTID, err := remotePrivateResourceAuthorPTID(row)
		if err != nil {
			return err
		}
		if err := database.Model(&remotePrivateResourceModel{}).
			Where(
				"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ?",
				row.SourceStationPeerID,
				row.ContentID,
				row.Generation,
				row.TargetActorPTID,
			).
			Update("author_ptid", authorPTID).Error; err != nil {
			return fmt.Errorf("backfill remote private resource author: %w", err)
		}
	}
	return nil
}

func (s *GORMPrivateContentStore) InspectRemotePrivateResource(
	ctx context.Context,
	transaction delivery.Transaction,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
	canonicalDelivery []byte,
) (bool, error) {
	if transaction == nil || transaction.DB() == nil || message == nil {
		return false, fmt.Errorf(
			"%w: receiver transaction and delivery are required",
			ErrPrivateContentInvalid,
		)
	}
	if len(canonicalDelivery) == 0 {
		return false, fmt.Errorf(
			"%w: canonical delivery bytes are required",
			ErrPrivateContentInvalid,
		)
	}
	resource := message.GetResource()
	target := message.GetTargetActor()
	if resource == nil || target == nil {
		return false, fmt.Errorf(
			"%w: delivery resource and target are required",
			ErrPrivateContentInvalid,
		)
	}
	if err := rejectRemotePrivateDeliveryBehindTombstone(
		ctx,
		transaction.DB(),
		message,
	); err != nil {
		return false, err
	}
	metadata, _, err := remotePrivateResourceMetadata(message)
	if err != nil {
		return false, err
	}
	authorPTID := remotePrivateMetadataAuthorPTID(metadata)
	if strings.TrimSpace(authorPTID) == "" {
		return false, ErrPrivateContentConflict
	}
	deliveryHash := sha256.Sum256(canonicalDelivery)
	return classifyRemotePrivateResourceIdentity(
		transaction.DB().WithContext(ctx),
		remotePrivateResourceModel{
			SourceStationPeerID:   message.GetSourceStationPeerId(),
			ContentID:             resource.GetContentId(),
			Generation:            resource.GetGeneration(),
			TargetActorPTID:       target.GetPtid(),
			DeliveryID:            message.GetDeliveryId(),
			AuthorPTID:            authorPTID,
			LifecycleRevision:     message.GetLifecycleRevision(),
			CanonicalDeliveryHash: deliveryHash[:],
		},
	)
}

func (s *GORMPrivateContentStore) ApplyRemotePrivateResource(
	ctx context.Context,
	transaction delivery.Transaction,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
	canonicalDelivery []byte,
) (bool, error) {
	if transaction == nil || transaction.DB() == nil || message == nil {
		return false, fmt.Errorf(
			"%w: receiver transaction and delivery are required",
			ErrPrivateContentInvalid,
		)
	}
	if len(canonicalDelivery) == 0 {
		return false, fmt.Errorf(
			"%w: canonical delivery bytes are required",
			ErrPrivateContentInvalid,
		)
	}
	resource := message.GetResource()
	target := message.GetTargetActor()
	if resource == nil || target == nil {
		return false, fmt.Errorf(
			"%w: delivery resource and target are required",
			ErrPrivateContentInvalid,
		)
	}
	if err := rejectRemotePrivateDeliveryBehindTombstone(
		ctx,
		transaction.DB(),
		message,
	); err != nil {
		return false, err
	}
	deliveryHash := sha256.Sum256(canonicalDelivery)
	metadata, parentContentID, err := remotePrivateResourceMetadata(message)
	if err != nil {
		return false, err
	}
	metadataBytes, err := marshalRemotePrivateProjectionPart(
		"viewer metadata",
		metadata,
	)
	if err != nil {
		return false, err
	}
	payloadBytes, err := marshalRemotePrivateProjectionPart(
		"encrypted payload",
		message.GetPayload(),
	)
	if err != nil {
		return false, err
	}
	objectBytes, err := marshalRemotePrivateProjectionPart(
		"object descriptor set",
		&privatecontentpb.FederatedPrivateObjectDescriptorSet{
			Objects: cloneEncryptedObjectDescriptors(message.GetObjects()),
		},
	)
	if err != nil {
		return false, err
	}
	verificationBytes, err := marshalRemotePrivateProjectionPart(
		"verification",
		message.GetVerification(),
	)
	if err != nil {
		return false, err
	}
	audienceBytes, err := marshalRemotePrivateProjectionPart(
		"audience explanation",
		message.GetAudienceExplanation(),
	)
	if err != nil {
		return false, err
	}
	row := remotePrivateResourceModel{
		SourceStationPeerID:   message.GetSourceStationPeerId(),
		ContentID:             resource.GetContentId(),
		Generation:            resource.GetGeneration(),
		TargetActorPTID:       target.GetPtid(),
		FederationID:          message.GetFederationId(),
		DeliveryID:            message.GetDeliveryId(),
		TargetStationPeerID:   message.GetTargetStationPeerId(),
		AuthorPTID:            remotePrivateMetadataAuthorPTID(metadata),
		ParentContentID:       parentContentID,
		LifecycleRevision:     message.GetLifecycleRevision(),
		ResourceKind:          int32(message.GetResourceKind()),
		ViewerMetadataBytes:   metadataBytes,
		EncryptedPayloadBytes: payloadBytes,
		ObjectDescriptorBytes: objectBytes,
		VerificationBytes:     verificationBytes,
		AudienceBytes:         audienceBytes,
		CanonicalDeliveryHash: deliveryHash[:],
		State:                 remotePrivateResourceStateActive,
		CommittedAt:           message.GetCommittedAt().AsTime().UTC(),
		UpdatedAt:             message.GetCommittedAt().AsTime().UTC(),
	}
	if strings.TrimSpace(row.AuthorPTID) == "" {
		return false, ErrPrivateContentConflict
	}
	database := transaction.DB().WithContext(ctx)
	create := database.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	if create.Error != nil {
		return false, fmt.Errorf(
			"social remote private resource insert: %w",
			create.Error,
		)
	}
	if create.RowsAffected == 0 {
		return classifyRemotePrivateResourceIdentity(database, row)
	}
	if err := s.afterWrite(
		ctx,
		PrivateContentBoundaryRemoteResource,
	); err != nil {
		return false, err
	}

	envelopes := make(
		[]remotePrivateEnvelopeModel,
		0,
		len(message.GetTargetActorEnvelopes()),
	)
	for _, envelope := range message.GetTargetActorEnvelopes() {
		if envelope == nil || envelope.GetBinding() == nil {
			return false, fmt.Errorf(
				"%w: remote private envelope is incomplete",
				ErrPrivateContentInvalid,
			)
		}
		recipientDeviceID := ""
		switch recipient := envelope.GetRecipient().(type) {
		case *securecontentpb.ViewerContentKeyEnvelope_Endpoint:
			recipientDeviceID = recipient.Endpoint.GetDeviceId()
		case *securecontentpb.ViewerContentKeyEnvelope_RecoveryActor:
		default:
			return false, fmt.Errorf(
				"%w: remote private envelope recipient is unsupported",
				ErrPrivateContentInvalid,
			)
		}
		envelopeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			envelope,
		)
		if err != nil {
			return false, fmt.Errorf(
				"%w: encode remote private envelope: %v",
				ErrPrivateContentInvalid,
				err,
			)
		}
		envelopes = append(envelopes, remotePrivateEnvelopeModel{
			SourceStationPeerID: row.SourceStationPeerID,
			ContentID:           row.ContentID,
			Generation:          row.Generation,
			TargetActorPTID:     row.TargetActorPTID,
			RecipientKeyKind:    int32(envelope.GetBinding().GetRecipientKeyKind()),
			RecipientDeviceID:   recipientDeviceID,
			OneTimeKeyID:        envelope.GetBinding().GetRecipientKeyId(),
			EnvelopeBytes:       envelopeBytes,
			PrincipalEpoch:      envelope.GetPrincipalEpoch(),
		})
	}
	if len(envelopes) == 0 {
		return false, fmt.Errorf(
			"%w: remote private delivery has no envelopes",
			ErrPrivateContentInvalid,
		)
	}
	if err := database.Create(&envelopes).Error; err != nil {
		return false, fmt.Errorf(
			"social remote private envelope insert: %w",
			err,
		)
	}
	if err := s.afterWrite(
		ctx,
		PrivateContentBoundaryRemoteEnvelopes,
	); err != nil {
		return false, err
	}
	return false, nil
}

func remotePrivateResourceMetadata(
	message *privatecontentpb.FederatedPrivateResourceDelivery,
) (proto.Message, string, error) {
	switch message.GetResourceKind() {
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST:
		if message.GetPost() == nil {
			return nil, "", ErrPrivateContentInvalid
		}
		return message.GetPost(), "", nil
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT:
		if message.GetComment() == nil ||
			strings.TrimSpace(message.GetComment().GetPostId()) == "" {
			return nil, "", ErrPrivateContentInvalid
		}
		return message.GetComment(), message.GetComment().GetPostId(), nil
	default:
		return nil, "", ErrPrivateContentInvalid
	}
}

func remotePrivateResourceAuthorPTID(
	row remotePrivateResourceModel,
) (string, error) {
	switch privatecontentpb.FederatedPrivateResourceKind(row.ResourceKind) {
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST:
		post := &privatecontentpb.PostMetadata{}
		if err := unmarshalRemotePrivateProjectionPart(
			"viewer metadata",
			row.ViewerMetadataBytes,
			post,
		); err != nil {
			return "", err
		}
		return post.GetAuthor().GetPtid(), nil
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT:
		comment := &privatecontentpb.CommentMetadata{}
		if err := unmarshalRemotePrivateProjectionPart(
			"viewer metadata",
			row.ViewerMetadataBytes,
			comment,
		); err != nil {
			return "", err
		}
		return comment.GetAuthor().GetPtid(), nil
	default:
		return "", ErrPrivateContentConflict
	}
}

func remotePrivateMetadataAuthorPTID(metadata proto.Message) string {
	switch value := metadata.(type) {
	case *privatecontentpb.PostMetadata:
		return value.GetAuthor().GetPtid()
	case *privatecontentpb.CommentMetadata:
		return value.GetAuthor().GetPtid()
	default:
		return ""
	}
}

func classifyRemotePrivateResourceIdentity(
	database *gorm.DB,
	candidate remotePrivateResourceModel,
) (bool, error) {
	var existing remotePrivateResourceModel
	resourceErr := database.Where(
		"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ?",
		candidate.SourceStationPeerID,
		candidate.ContentID,
		candidate.Generation,
		candidate.TargetActorPTID,
	).First(&existing).Error
	if resourceErr == nil {
		if existing.DeliveryID == candidate.DeliveryID &&
			existing.AuthorPTID == candidate.AuthorPTID &&
			existing.LifecycleRevision == candidate.LifecycleRevision &&
			bytes.Equal(
				existing.CanonicalDeliveryHash,
				candidate.CanonicalDeliveryHash,
			) {
			return true, nil
		}
		return false, fmt.Errorf(
			"%w: remote private resource identity changed",
			ErrPrivateContentConflict,
		)
	}
	if !errors.Is(resourceErr, gorm.ErrRecordNotFound) {
		return false, fmt.Errorf(
			"social remote private resource conflict lookup: %w",
			resourceErr,
		)
	}
	if err := database.Where(
		"source_station_peer_id = ? AND target_actor_ptid = ? AND delivery_id = ?",
		candidate.SourceStationPeerID,
		candidate.TargetActorPTID,
		candidate.DeliveryID,
	).First(&existing).Error; err == nil {
		return false, fmt.Errorf(
			"%w: remote private delivery identity changed",
			ErrPrivateContentConflict,
		)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, fmt.Errorf(
			"social remote private delivery conflict lookup: %w",
			err,
		)
	}
	return false, nil
}

func (s *GORMPrivateContentStore) ReadRemotePrivatePost(
	ctx context.Context,
	postID string,
	viewerPTID string,
	viewerDeviceID string,
	read func(
		delivery.Transaction,
		*RemotePrivatePostReadModel,
	) error,
) error {
	if strings.TrimSpace(postID) == "" ||
		strings.TrimSpace(viewerPTID) == "" ||
		strings.TrimSpace(viewerDeviceID) == "" ||
		read == nil {
		return ErrPrivateContentInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(database *gorm.DB) error {
		projected, err := loadRemotePrivatePost(
			ctx,
			database,
			postID,
			viewerPTID,
			viewerDeviceID,
		)
		if err != nil {
			return err
		}
		return read(
			privateContentValidationTransaction{db: database},
			projected,
		)
	})
}

func loadRemotePrivatePost(
	ctx context.Context,
	database *gorm.DB,
	postID string,
	viewerPTID string,
	viewerDeviceID string,
) (*RemotePrivatePostReadModel, error) {
	var rows []remotePrivateResourceModel
	if err := database.WithContext(ctx).
		Where(
			"content_id = ? AND target_actor_ptid = ? AND resource_kind = ? AND state = ?",
			postID,
			viewerPTID,
			int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST),
			remotePrivateResourceStateActive,
		).
		Limit(2).
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("social remote private resource read: %w", err)
	}
	if len(rows) == 0 {
		return nil, ErrPrivateContentNotFound
	}
	if len(rows) != 1 {
		return nil, fmt.Errorf(
			"%w: remote private resource identity is ambiguous",
			ErrPrivateContentConflict,
		)
	}
	post := &privatecontentpb.PostMetadata{}
	if err := unmarshalRemotePrivateProjectionPart(
		"viewer metadata",
		rows[0].ViewerMetadataBytes,
		post,
	); err != nil {
		return nil, err
	}
	if strings.TrimSpace(post.GetAuthor().GetPtid()) == "" {
		return nil, ErrPrivateContentConflict
	}
	blocked, err := remotePrivateRelationshipBlocked(
		ctx,
		database,
		viewerPTID,
		post.GetAuthor().GetPtid(),
	)
	if err != nil {
		return nil, fmt.Errorf("read remote private relationship: %w", err)
	}
	if blocked {
		return nil, ErrPrivateContentNotFound
	}
	message, err := loadRemotePrivateDelivery(
		ctx,
		database,
		rows[0],
		viewerDeviceID,
	)
	if err != nil {
		return nil, err
	}
	if message.GetPost() == nil {
		return nil, ErrPrivateContentConflict
	}
	return &RemotePrivatePostReadModel{Delivery: message}, nil
}

func (s *GORMPrivateContentStore) ReadRemotePrivateComment(
	ctx context.Context,
	postID string,
	commentID string,
	viewerPTID string,
	viewerDeviceID string,
	read func(
		delivery.Transaction,
		*RemotePrivateCommentReadModel,
	) error,
) error {
	if strings.TrimSpace(postID) == "" ||
		strings.TrimSpace(commentID) == "" ||
		strings.TrimSpace(viewerPTID) == "" ||
		strings.TrimSpace(viewerDeviceID) == "" ||
		read == nil {
		return ErrPrivateContentInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(database *gorm.DB) error {
		if _, err := loadRemotePrivatePost(
			ctx,
			database,
			postID,
			viewerPTID,
			viewerDeviceID,
		); err != nil {
			return err
		}
		row, err := loadRemotePrivateCommentRow(
			ctx,
			database,
			postID,
			commentID,
			viewerPTID,
		)
		if err != nil {
			return err
		}
		message, err := loadRemotePrivateDelivery(
			ctx,
			database,
			row,
			viewerDeviceID,
		)
		if err != nil {
			return err
		}
		return read(
			privateContentValidationTransaction{db: database},
			&RemotePrivateCommentReadModel{Delivery: message},
		)
	})
}

func (s *GORMPrivateContentStore) ListRemotePrivateComments(
	ctx context.Context,
	query PrivateCommentListQuery,
	read func(
		delivery.Transaction,
		RemotePrivateCommentPage,
	) error,
) error {
	if strings.TrimSpace(query.PostID) == "" ||
		strings.TrimSpace(query.ViewerPTID) == "" ||
		strings.TrimSpace(query.ViewerDeviceID) == "" ||
		query.Limit < 1 ||
		query.Limit > 100 ||
		(query.CursorCreatedAt.IsZero() != (query.CursorCommentID == "")) ||
		read == nil {
		return ErrPrivateContentInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(database *gorm.DB) error {
		if _, err := loadRemotePrivatePost(
			ctx,
			database,
			query.PostID,
			query.ViewerPTID,
			query.ViewerDeviceID,
		); err != nil {
			return err
		}
		rowsQuery := database.WithContext(ctx).Where(
			"parent_content_id = ? AND target_actor_ptid = ? AND resource_kind = ? AND state = ?",
			query.PostID,
			query.ViewerPTID,
			int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT),
			remotePrivateResourceStateActive,
		)
		if !query.CursorCreatedAt.IsZero() {
			rowsQuery = rowsQuery.Where(
				"(committed_at < ?) OR (committed_at = ? AND content_id < ?)",
				query.CursorCreatedAt.UTC(),
				query.CursorCreatedAt.UTC(),
				query.CursorCommentID,
			)
		}
		var rows []remotePrivateResourceModel
		if err := rowsQuery.
			Order("committed_at DESC, content_id DESC").
			Limit(query.Limit + 1).
			Find(&rows).Error; err != nil {
			return fmt.Errorf("social remote private Comment list: %w", err)
		}
		page := RemotePrivateCommentPage{HasMore: len(rows) > query.Limit}
		if page.HasMore {
			rows = rows[:query.Limit]
		}
		page.Comments = make([]*RemotePrivateCommentReadModel, 0, len(rows))
		for _, row := range rows {
			message, err := loadRemotePrivateDelivery(
				ctx,
				database,
				row,
				query.ViewerDeviceID,
			)
			if err != nil {
				return err
			}
			page.Comments = append(
				page.Comments,
				&RemotePrivateCommentReadModel{Delivery: message},
			)
		}
		return read(privateContentValidationTransaction{db: database}, page)
	})
}

func loadRemotePrivateCommentRow(
	ctx context.Context,
	database *gorm.DB,
	postID string,
	commentID string,
	viewerPTID string,
) (remotePrivateResourceModel, error) {
	var rows []remotePrivateResourceModel
	if err := database.WithContext(ctx).Where(
		"content_id = ? AND parent_content_id = ? AND target_actor_ptid = ? AND resource_kind = ? AND state = ?",
		commentID,
		postID,
		viewerPTID,
		int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT),
		remotePrivateResourceStateActive,
	).Limit(2).Find(&rows).Error; err != nil {
		return remotePrivateResourceModel{}, fmt.Errorf(
			"social remote private Comment read: %w",
			err,
		)
	}
	if len(rows) == 0 {
		return remotePrivateResourceModel{}, ErrPrivateContentNotFound
	}
	if len(rows) != 1 {
		return remotePrivateResourceModel{}, ErrPrivateContentConflict
	}
	return rows[0], nil
}

func loadRemotePrivateDelivery(
	ctx context.Context,
	database *gorm.DB,
	row remotePrivateResourceModel,
	viewerDeviceID string,
) (*privatecontentpb.FederatedPrivateResourceDelivery, error) {
	payload := &securecontentpb.EncryptedPayload{}
	if err := unmarshalRemotePrivateProjectionPart(
		"encrypted payload",
		row.EncryptedPayloadBytes,
		payload,
	); err != nil {
		return nil, err
	}
	objectSet := &privatecontentpb.FederatedPrivateObjectDescriptorSet{}
	if len(row.ObjectDescriptorBytes) != 0 {
		if err := unmarshalRemotePrivateProjectionPart(
			"object descriptor set",
			row.ObjectDescriptorBytes,
			objectSet,
		); err != nil {
			return nil, err
		}
	}
	verification := &privatecontentpb.PrivateContentVerification{}
	if err := unmarshalRemotePrivateProjectionPart(
		"verification",
		row.VerificationBytes,
		verification,
	); err != nil {
		return nil, err
	}
	audience := &actormodel.AudienceExplanation{}
	if err := unmarshalRemotePrivateProjectionPart(
		"audience explanation",
		row.AudienceBytes,
		audience,
	); err != nil {
		return nil, err
	}
	message := &privatecontentpb.FederatedPrivateResourceDelivery{
		FormatVersion:       1,
		FederationId:        row.FederationID,
		DeliveryId:          row.DeliveryID,
		SourceStationPeerId: row.SourceStationPeerID,
		TargetStationPeerId: row.TargetStationPeerID,
		TargetActor: &actormodel.ActorRef{
			Ptid: row.TargetActorPTID,
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		ResourceKind:        privatecontentpb.FederatedPrivateResourceKind(row.ResourceKind),
		Resource:            proto.Clone(payload.GetResource()).(*securecontentpb.SecureResourceRef),
		LifecycleRevision:   row.LifecycleRevision,
		Payload:             payload,
		Objects:             objectSet.GetObjects(),
		Verification:        verification,
		AudienceExplanation: audience,
		CommittedAt:         timestamppb.New(row.CommittedAt.UTC()),
	}
	switch message.GetResourceKind() {
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST:
		post := &privatecontentpb.PostMetadata{}
		if err := unmarshalRemotePrivateProjectionPart(
			"viewer metadata",
			row.ViewerMetadataBytes,
			post,
		); err != nil {
			return nil, err
		}
		message.Metadata = &privatecontentpb.FederatedPrivateResourceDelivery_Post{
			Post: post,
		}
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT:
		comment := &privatecontentpb.CommentMetadata{}
		if err := unmarshalRemotePrivateProjectionPart(
			"viewer metadata",
			row.ViewerMetadataBytes,
			comment,
		); err != nil {
			return nil, err
		}
		message.Metadata = &privatecontentpb.FederatedPrivateResourceDelivery_Comment{
			Comment: comment,
		}
	default:
		return nil, ErrPrivateContentConflict
	}
	var envelopes []remotePrivateEnvelopeModel
	if err := database.WithContext(ctx).
		Where(
			"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ? AND recipient_device_id = ?",
			row.SourceStationPeerID,
			row.ContentID,
			row.Generation,
			row.TargetActorPTID,
			viewerDeviceID,
		).
		Find(&envelopes).Error; err != nil {
		return nil, fmt.Errorf("social remote private envelope read: %w", err)
	}
	if len(envelopes) != 1 {
		return nil, ErrPrivateContentNotFound
	}
	for _, row := range envelopes {
		envelope := &securecontentpb.ViewerContentKeyEnvelope{}
		if err := proto.Unmarshal(row.EnvelopeBytes, envelope); err != nil {
			return nil, fmt.Errorf(
				"%w: decode remote private envelope: %v",
				ErrPrivateContentConflict,
				err,
			)
		}
		message.TargetActorEnvelopes = append(
			message.TargetActorEnvelopes,
			envelope,
		)
	}
	return message, nil
}

func marshalRemotePrivateProjectionPart(
	name string,
	message proto.Message,
) ([]byte, error) {
	if message == nil || !message.ProtoReflect().IsValid() {
		return nil, fmt.Errorf(
			"%w: remote private %s is unavailable",
			ErrPrivateContentInvalid,
			name,
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf(
			"%w: encode remote private %s: %v",
			ErrPrivateContentInvalid,
			name,
			err,
		)
	}
	return encoded, nil
}

func unmarshalRemotePrivateProjectionPart(
	name string,
	encoded []byte,
	message proto.Message,
) error {
	if message == nil || len(encoded) == 0 {
		return fmt.Errorf(
			"%w: remote private %s is unavailable",
			ErrPrivateContentConflict,
			name,
		)
	}
	if err := proto.Unmarshal(encoded, message); err != nil {
		return fmt.Errorf(
			"%w: decode remote private %s: %v",
			ErrPrivateContentConflict,
			name,
			err,
		)
	}
	return nil
}

func cloneEncryptedObjectDescriptors(
	objects []*securecontentpb.EncryptedObjectDescriptor,
) []*securecontentpb.EncryptedObjectDescriptor {
	cloned := make([]*securecontentpb.EncryptedObjectDescriptor, 0, len(objects))
	for _, object := range objects {
		cloned = append(
			cloned,
			proto.Clone(object).(*securecontentpb.EncryptedObjectDescriptor),
		)
	}
	return cloned
}

func countRemotePrivateResources(
	ctx context.Context,
	database *gorm.DB,
) (int64, error) {
	var count int64
	err := database.WithContext(ctx).
		Model(&remotePrivateResourceModel{}).
		Count(&count).Error
	return count, err
}
