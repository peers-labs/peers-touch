package infrastructure

import (
	"context"
	"fmt"
	"strings"
	"time"

	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

const maximumRemotePrivateMomentReferenceQuerySize = 101

// RemotePrivateMomentReferenceQuery is an actor-scoped keyset query.
type RemotePrivateMomentReferenceQuery struct {
	ActorPTID       string
	CursorCreatedAt time.Time
	CursorPostID    string
	Limit           int
}

// RemotePrivateMomentReferenceRecord identifies one committed receiver projection.
type RemotePrivateMomentReferenceRecord struct {
	PostID            string
	LifecycleRevision uint64
	UpdatedAt         time.Time
	CreatedAt         time.Time
}

// FederatedPrivateMomentReferenceStore exposes rebuildable remote projections.
type FederatedPrivateMomentReferenceStore interface {
	ListRemotePrivateMomentReferences(
		context.Context,
		RemotePrivateMomentReferenceQuery,
	) ([]RemotePrivateMomentReferenceRecord, error)
}

// ListRemotePrivateMomentReferences returns only active projections for one viewer.
func (s *GORMPrivateContentStore) ListRemotePrivateMomentReferences(
	ctx context.Context,
	query RemotePrivateMomentReferenceQuery,
) ([]RemotePrivateMomentReferenceRecord, error) {
	if strings.TrimSpace(query.ActorPTID) == "" ||
		query.ActorPTID != strings.TrimSpace(query.ActorPTID) ||
		query.Limit < 1 ||
		query.Limit > maximumRemotePrivateMomentReferenceQuerySize {
		return nil, fmt.Errorf(
			"%w: remote private Moment reference query is invalid",
			ErrPrivateContentInvalid,
		)
	}
	if query.CursorCreatedAt.IsZero() != (query.CursorPostID == "") {
		return nil, fmt.Errorf(
			"%w: remote private Moment reference cursor is incomplete",
			ErrPrivateContentInvalid,
		)
	}

	database := s.db.WithContext(ctx).
		Table("social_remote_private_resources AS resource").
		Select(
			"resource.content_id AS post_id, resource.lifecycle_revision, "+
				"resource.updated_at, resource.committed_at AS created_at",
		).
		Where(
			"resource.target_actor_ptid = ? AND resource.resource_kind = ? AND resource.state = ?",
			query.ActorPTID,
			int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST),
			remotePrivateResourceStateActive,
		).
		Where(
			"NOT "+recoverablePrivateContentBlockExistsSQL("resource.author_ptid"),
			true,
			query.ActorPTID,
			query.ActorPTID,
		)
	if !query.CursorCreatedAt.IsZero() {
		database = database.Where(
			"(resource.committed_at < ? OR (resource.committed_at = ? AND resource.content_id < ?))",
			query.CursorCreatedAt,
			query.CursorCreatedAt,
			query.CursorPostID,
		)
	}
	var records []RemotePrivateMomentReferenceRecord
	if err := database.
		Order("resource.committed_at DESC").
		Order("resource.content_id DESC").
		Limit(query.Limit).
		Scan(&records).Error; err != nil {
		return nil, fmt.Errorf(
			"list remote private Moment references: %w",
			err,
		)
	}
	return records, nil
}

var _ FederatedPrivateMomentReferenceStore = (*GORMPrivateContentStore)(nil)
