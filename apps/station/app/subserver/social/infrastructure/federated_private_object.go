package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// FederatedPrivateObjectSource contains current source-owned object and
// recipient-locality truth needed to recompute one CSS-D11 grant binding.
type FederatedPrivateObjectSource struct {
	Object dbmodel.SocialPrivateObjectAttachment
	Plan   dbmodel.SocialPrivateContentPlan
}

// RemotePrivateObjectProjection is the recipient-owned actor-scoped reference
// used to construct peer reads. It never contains ciphertext.
type RemotePrivateObjectProjection struct {
	FederationID        string
	DeliveryID          string
	SourceStationPeerID string
	TargetStationPeerID string
	TargetActorPTID     string
	LifecycleRevision   uint64
	Resource            *securecontentpb.SecureResourceRef
	Descriptor          *securecontentpb.EncryptedObjectDescriptor
}

// AuthorizeFederatedPrivateObjectSource revalidates current source resource
// authority and the exact actor/device or actor-recovery object grant.
func (s *GORMPrivateContentStore) AuthorizeFederatedPrivateObjectSource(
	ctx context.Context,
	resource *securecontentpb.SecureResourceRef,
	objectID string,
	viewerPTID string,
	viewerDeviceID string,
) (FederatedPrivateObjectSource, error) {
	if resource == nil ||
		strings.TrimSpace(objectID) == "" ||
		strings.TrimSpace(viewerPTID) == "" ||
		strings.TrimSpace(viewerDeviceID) == "" {
		return FederatedPrivateObjectSource{}, ErrPrivateContentInvalid
	}
	var result FederatedPrivateObjectSource
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var object dbmodel.SocialPrivateObjectAttachment
		if err := tx.Where(
			"object_id = ? AND content_id = ? AND state = ? AND domain_commit_id <> ''",
			objectID,
			resource.GetContentId(),
			dbmodel.SocialPrivateObjectAttached,
		).First(&object).Error; err != nil {
			return ErrPrivateContentNotFound
		}
		if err := authorizeCurrentFederatedObjectResource(
			tx,
			resource,
			viewerPTID,
		); err != nil {
			return err
		}
		var grantCount int64
		if err := tx.Model(&dbmodel.SocialPrivateObjectGrant{}).
			Where(
				"object_id = ? AND principal_ptid = ? AND revoked_at IS NULL AND ((principal_kind = ? AND principal_device_id = ?) OR (principal_kind = ? AND principal_device_id = ''))",
				objectID,
				viewerPTID,
				PrivateContentKeyKindEndpoint,
				viewerDeviceID,
				PrivateContentKeyKindActorRecovery,
			).
			Count(&grantCount).Error; err != nil {
			return err
		}
		if grantCount == 0 {
			return ErrPrivateContentNotFound
		}
		var plan dbmodel.SocialPrivateContentPlan
		if err := tx.Where(
			"content_id = ? AND generation = ? AND state = ? AND domain_commit_id <> ''",
			resource.GetContentId(),
			resource.GetGeneration(),
			dbmodel.SocialPrivatePlanStateConsumed,
		).First(&plan).Error; err != nil {
			return ErrPrivateContentNotFound
		}
		result = FederatedPrivateObjectSource{
			Object: clonePrivateObject(object),
			Plan:   clonePlan(plan),
		}

		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) ||
		errors.Is(err, ErrPrivateContentNotFound) {
		return FederatedPrivateObjectSource{}, ErrPrivateContentNotFound
	}
	if err != nil {
		return FederatedPrivateObjectSource{}, fmt.Errorf(
			"authorize federated Social private object: %w",
			err,
		)
	}

	return result, nil
}

// FindRemotePrivateObject resolves exactly one actor-scoped imported
// descriptor without introducing a recipient ciphertext store or schema.
func (s *GORMPrivateContentStore) FindRemotePrivateObject(
	ctx context.Context,
	objectID string,
	viewerPTID string,
	descriptorSHA256 []byte,
) (RemotePrivateObjectProjection, error) {
	if strings.TrimSpace(objectID) == "" ||
		strings.TrimSpace(viewerPTID) == "" {
		return RemotePrivateObjectProjection{}, ErrPrivateContentInvalid
	}
	rows, err := s.db.WithContext(ctx).
		Model(&remotePrivateResourceModel{}).
		Where(
			"target_actor_ptid = ? AND state = ?",
			viewerPTID,
			remotePrivateResourceStateActive,
		).
		Rows()
	if err != nil {
		return RemotePrivateObjectProjection{}, fmt.Errorf(
			"scan remote private object projections: %w",
			err,
		)
	}
	defer rows.Close()

	var match *RemotePrivateObjectProjection
	for rows.Next() {
		var row remotePrivateResourceModel
		if err := s.db.ScanRows(rows, &row); err != nil {
			return RemotePrivateObjectProjection{}, fmt.Errorf(
				"decode remote private object projection row: %w",
				err,
			)
		}
		if len(row.ObjectDescriptorBytes) == 0 {
			continue
		}
		objectSet := &privatecontentpb.FederatedPrivateObjectDescriptorSet{}
		if err := unmarshalRemotePrivateProjectionPart(
			"object descriptor set",
			row.ObjectDescriptorBytes,
			objectSet,
		); err != nil {
			return RemotePrivateObjectProjection{}, err
		}
		for _, descriptor := range objectSet.GetObjects() {
			if descriptor.GetObjectId() != objectID {
				continue
			}
			digest, err := securecontentkernel.DescriptorSHA256(
				descriptor,
				securecontentkernel.DefaultPolicy(),
			)
			if err != nil {
				return RemotePrivateObjectProjection{}, err
			}
			if !bytes.Equal(digest[:], descriptorSHA256) {
				continue
			}
			if match != nil {
				return RemotePrivateObjectProjection{}, ErrPrivateContentConflict
			}
			match = &RemotePrivateObjectProjection{
				FederationID:        row.FederationID,
				DeliveryID:          row.DeliveryID,
				SourceStationPeerID: row.SourceStationPeerID,
				TargetStationPeerID: row.TargetStationPeerID,
				TargetActorPTID:     row.TargetActorPTID,
				LifecycleRevision:   row.LifecycleRevision,
				Resource: &securecontentpb.SecureResourceRef{
					OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
					ContentId:   row.ContentID,
					Generation:  row.Generation,
				},
				Descriptor: proto.Clone(
					descriptor,
				).(*securecontentpb.EncryptedObjectDescriptor),
			}
		}
	}
	if err := rows.Err(); err != nil {
		return RemotePrivateObjectProjection{}, fmt.Errorf(
			"scan remote private object projections: %w",
			err,
		)
	}
	if match == nil {
		return RemotePrivateObjectProjection{}, ErrPrivateContentNotFound
	}

	return *match, nil
}

func authorizeCurrentFederatedObjectResource(
	tx *gorm.DB,
	resource *securecontentpb.SecureResourceRef,
	viewerPTID string,
) error {
	var post dbmodel.SocialPrivateContentPost
	err := tx.Where(
		"content_id = ? AND generation = ? AND lifecycle_state = ? AND deleted_at IS NULL",
		resource.GetContentId(),
		resource.GetGeneration(),
		privateContentLifecycleActive,
	).First(&post).Error
	if err == nil {
		return authorizePrivatePostViewer(tx, post, viewerPTID)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	var comment dbmodel.SocialPrivateContentComment
	if err := tx.Where(
		"content_id = ? AND generation = ? AND lifecycle_state = ? AND deleted_at IS NULL",
		resource.GetContentId(),
		resource.GetGeneration(),
		privateContentLifecycleActive,
	).First(&comment).Error; err != nil {
		return ErrPrivateContentNotFound
	}
	var parent dbmodel.SocialPrivateContentPost
	if err := tx.Where(
		"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
		comment.PostID,
		privateContentLifecycleActive,
	).First(&parent).Error; err != nil {
		return ErrPrivateContentNotFound
	}
	if err := authorizePrivatePostViewer(tx, parent, viewerPTID); err != nil {
		return err
	}
	if viewerPTID == comment.AuthorPTID {
		return nil
	}
	if err := requirePrivateSnapshotGrant(
		tx,
		comment.InteractionSnapshotID,
		viewerPTID,
	); err != nil {
		return err
	}

	return authorizePrivateBlockBoundary(
		tx,
		comment.AuthorPTID,
		viewerPTID,
	)
}
