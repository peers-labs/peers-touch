package application

import (
	"context"
	"strings"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

type momentReadPolicyStore interface {
	CheckMomentReadPolicy(context.Context, string, string, []*privatecontentpb.MomentReadPolicyTarget) (*privatecontentpb.CheckMomentReadPolicyResponse, error)
}

// Original Social read authority, independent from any Search query or index.
func (s *PrivateContentService) CheckMomentReadPolicy(
	ctx context.Context, viewer *actormodel.ActorDeviceRef,
	request *privatecontentpb.CheckMomentReadPolicyRequest,
) (*privatecontentpb.CheckMomentReadPolicyResponse, error) {
	const operation = "social.private_content.read_policy"
	if request == nil || len(request.Targets) > 100 {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument, operation, "targets", "must contain at most 100 resources")
	}
	seen := make(map[string]bool, len(request.Targets))
	canonicalID := func(value string, required bool) bool {
		return (!required || value != "") && len(value) <= 128 &&
			strings.TrimSpace(value) == value
	}
	for _, target := range request.Targets {
		if target == nil || !canonicalID(target.ItemId, true) ||
			!canonicalID(target.PostId, true) || !canonicalID(target.CommentId, false) ||
			seen[target.ItemId] {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument, operation, "targets", "requires unique item IDs and canonical resource IDs")
		}
		seen[target.ItemId] = true
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := s.validatePrivateContentViewer(ctx, viewer, operation); err != nil {
		return nil, err
	}
	store, ok := s.store.(momentReadPolicyStore)
	if !ok {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentDependency, operation, "store", "batch read authority is unavailable")
	}
	return store.CheckMomentReadPolicy(ctx, viewer.Actor.Ptid, viewer.DeviceId, request.Targets)
}
