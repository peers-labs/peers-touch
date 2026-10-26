package application

import (
	"context"

	searchpb "github.com/peers-labs/peers-touch/station/app/model/search"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"gorm.io/gorm"
)

func validatePublicSearchHydration(request *searchpb.HydrationRequest) error {
	if request == nil || len(request.Items) == 0 || len(request.Items) > 100 {
		return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_PROTOCOL)
	}
	seen := make(map[string]bool)
	for _, item := range request.Items {
		if item == nil || item.ItemId == "" || len(item.ItemId) > 128 ||
			seen[item.ItemId] || len(item.KnownValidator) > 128 || len(item.Fields) > 1 {
			return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_PROTOCOL)
		}
		seen[item.ItemId] = true
		for _, field := range item.Fields {
			if field != searchpb.ProjectionField_PROJECTION_FIELD_RESULT {
				return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_PROTOCOL)
			}
		}
	}
	return nil
}

func publicSearchReadRefs(
	ctx context.Context, tx *gorm.DB, viewer string, resources []*searchpb.ResourceRef,
) (*PublicReadBatch, error) {
	postIDs, commentIDs := make([]uint64, 0), make([]uint64, 0)
	for _, resource := range resources {
		if id, valid := publicSearchRefID(resource); valid {
			if resource.Kind == "social-post" {
				postIDs = append(postIDs, id)
			} else {
				commentIDs = append(commentIDs, id)
			}
		}
	}
	return NewPublicReadPort(infrastructure.NewRepos(tx)).Read(ctx, viewer, postIDs, commentIDs)
}

func (s *PublicSearchService) Hydrate(ctx context.Context, viewer string, request *searchpb.HydrationRequest) (*searchpb.HydrationReply, error) {
	if err := validatePublicSearchHydration(request); err != nil {
		return nil, err
	}
	if viewer == "" {
		return nil, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_PROTOCOL)
	}
	var reply *searchpb.HydrationReply
	err := s.readSnapshot(ctx, func(tx *gorm.DB, observation string) error {
		var err error
		reply, err = s.hydrateSnapshot(tx.Statement.Context, tx, observation, viewer, request)
		return err
	})
	if err != nil {
		return nil, err
	}
	return reply, nil
}

func (s *PublicSearchService) hydrateSnapshot(
	ctx context.Context, tx *gorm.DB, observation, viewer string, request *searchpb.HydrationRequest,
) (*searchpb.HydrationReply, error) {
	resources := make([]*searchpb.ResourceRef, 0, len(request.Items))
	for _, item := range request.Items {
		resources = append(resources, item.Resource)
	}
	batch, err := publicSearchReadRefs(ctx, tx, viewer, resources)
	if err != nil {
		return nil, err
	}
	reply := &searchpb.HydrationReply{}
	for _, item := range request.Items {
		outcome := &searchpb.HydrationOutcome{
			ItemId:  item.ItemId,
			Outcome: &searchpb.HydrationOutcome_Unavailable{Unavailable: &searchpb.UnavailableResource{}},
		}
		reply.Outcomes = append(reply.Outcomes, outcome)
		id, valid := publicSearchRefID(item.Resource)
		if !valid {
			continue
		}
		result := publicSearchResult(batch, item.Resource.Kind, id, viewer, observation)
		if result == nil || !publicSearchRefMatches(item.Resource, result.Resource) {
			continue
		}
		validator := publicSearchValidator(result)
		cache := publicSearchCache(viewer, observation, validator)
		fields := []searchpb.ProjectionField{searchpb.ProjectionField_PROJECTION_FIELD_RESULT}
		if !request.Refresh && item.KnownValidator == validator {
			outcome.Outcome = &searchpb.HydrationOutcome_Unchanged{
				Unchanged: &searchpb.UnchangedProjection{Validator: validator, Fields: fields, Cache: cache},
			}
		} else {
			outcome.Outcome = &searchpb.HydrationOutcome_Changed{
				Changed: &searchpb.AuthorizedProjection{Result: result, Fields: fields, Cache: cache},
			}
		}
	}
	return reply, nil
}

func (s *PublicSearchService) Resolve(ctx context.Context, viewer string, request *searchpb.ResolveRequest) (*searchpb.ResolvedResource, error) {
	if viewer == "" || request == nil || request.SourceId != PublicSearchSourceID ||
		len(request.RequestId) > 128 {
		return nil, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_PROTOCOL)
	}
	id, valid := publicSearchRefID(request.Resource)
	if !valid {
		return nil, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_RESOURCE_UNAVAILABLE)
	}
	var resolved *searchpb.ResolvedResource
	err := s.readSnapshot(ctx, func(tx *gorm.DB, observation string) error {
		batch, err := publicSearchReadRefs(tx.Statement.Context, tx, viewer, []*searchpb.ResourceRef{request.Resource})
		if err != nil {
			return err
		}
		result := publicSearchResult(batch, request.Resource.Kind, id, viewer, observation)
		if result == nil || !publicSearchRefMatches(request.Resource, result.Resource) {
			return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_RESOURCE_UNAVAILABLE)
		}
		resolved = &searchpb.ResolvedResource{
			Resource: result.Resource, ResolverBinding: PublicSearchResolver,
			Cache: publicSearchCache(viewer, observation, publicSearchValidator(result)),
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resolved, nil
}
