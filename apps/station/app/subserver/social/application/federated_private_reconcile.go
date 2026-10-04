package application

import (
	"context"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const maximumRemotePrivateMomentReferencePageSize = 100

// ListRemotePrivateMomentReferences returns actor-scoped Station truth for gap repair.
func (s *PrivateContentService) ListRemotePrivateMomentReferences(
	ctx context.Context,
	actorPTID string,
	request *privatecontentpb.ListRemotePrivateMomentReferencesRequest,
) (*privatecontentpb.ListRemotePrivateMomentReferencesResponse, error) {
	const operation = "social.private_content.list_remote_references"
	if request == nil ||
		len(request.ProtoReflect().GetUnknown()) != 0 ||
		request.GetLimit() < 1 ||
		request.GetLimit() > maximumRemotePrivateMomentReferencePageSize {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"request",
			"must contain a limit between 1 and 100 and only known fields",
		)
	}
	cursor, err := socialdomain.DecodeRecoverableContentCursor(
		actorPTID,
		request.GetCursor(),
	)
	if err != nil {
		return nil, err
	}
	if cursor.ResourceKind != "" &&
		cursor.ResourceKind != socialdomain.PrivateContentResourcePost {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"cursor",
			"does not identify a private Moment",
		)
	}
	store, ok := s.store.(infrastructure.FederatedPrivateMomentReferenceStore)
	if !ok {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			operation,
			"reference_store",
			"is unavailable",
		)
	}
	records, err := store.ListRemotePrivateMomentReferences(
		ctx,
		infrastructure.RemotePrivateMomentReferenceQuery{
			ActorPTID:       actorPTID,
			CursorCreatedAt: cursor.CreatedAt,
			CursorPostID:    cursor.ResourceID,
			Limit:           int(request.GetLimit()) + 1,
		},
	)
	if err != nil {
		s.metrics.reconcileTotal.Inc("rejected", "projection_store")
		return nil, mapPrivateStoreError(operation, err)
	}
	hasMore := len(records) > int(request.GetLimit())
	if hasMore {
		records = records[:request.GetLimit()]
	}
	moments := make(
		[]*privatecontentpb.RemotePrivateMomentReference,
		0,
		len(records),
	)
	for _, record := range records {
		moments = append(moments, &privatecontentpb.RemotePrivateMomentReference{
			PostId:            record.PostID,
			LifecycleRevision: record.LifecycleRevision,
			UpdatedAt:         timestamppb.New(record.UpdatedAt.UTC()),
		})
	}
	nextCursor := ""
	if hasMore {
		last := records[len(records)-1]
		nextCursor, err = socialdomain.EncodeRecoverableContentCursor(
			actorPTID,
			socialdomain.RecoverableContentCursor{
				CreatedAt:    last.CreatedAt,
				ResourceKind: socialdomain.PrivateContentResourcePost,
				ResourceID:   last.PostID,
			},
		)
		if err != nil {
			s.metrics.reconcileTotal.Inc("rejected", "cursor")
			return nil, err
		}
	}
	s.metrics.reconcileTotal.Inc("accepted", "remote_reference")
	return &privatecontentpb.ListRemotePrivateMomentReferencesResponse{
		Moments:    moments,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}
