package presence

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/domain"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	presencemodel "github.com/peers-labs/peers-touch/station/frame/touch/model/presence"
)

const (
	maxPresenceQueryActors = 256
	remotePresenceTimeout  = 3 * time.Second
)

type localPresenceQuerier interface {
	Query(actorPTIDs []string) ([]domain.Status, error)
}

type actorHomeStationResolver interface {
	ResolveActorHomeStationPeerID(context.Context, string) (string, error)
}

type federationPresenceCaller interface {
	CallPeer(context.Context, federationruntime.PeerCall) error
	LocalStationPeerID() string
}

type federationRuntimeProvider interface {
	FederationDeliveryRuntime() *federationruntime.Runtime
}

type presenceQueryDependencies struct {
	actors     actorHomeStationResolver
	federation federationPresenceCaller
}

type presenceQueryDependencyResolver func() (presenceQueryDependencies, error)

type presenceQueryCoordinator struct {
	local        localPresenceQuerier
	dependencies presenceQueryDependencyResolver
}

func newPresenceQueryCoordinator(
	local localPresenceQuerier,
	dependencies presenceQueryDependencyResolver,
) *presenceQueryCoordinator {
	return &presenceQueryCoordinator{
		local:        local,
		dependencies: dependencies,
	}
}

func resolvePresenceQueryDependencies() (presenceQueryDependencies, error) {
	instances := server.GetOptions().SubserverInstances
	actors, ok := instances["actor_identity"].(actorHomeStationResolver)
	if !ok || actors == nil {
		return presenceQueryDependencies{}, fmt.Errorf(
			"Actor Identity Home Station resolver is unavailable",
		)
	}
	provider, ok := instances["federation"].(federationRuntimeProvider)
	if !ok || provider == nil || provider.FederationDeliveryRuntime() == nil {
		return presenceQueryDependencies{}, fmt.Errorf(
			"Federation presence transport is unavailable",
		)
	}

	return presenceQueryDependencies{
		actors:     actors,
		federation: provider.FederationDeliveryRuntime(),
	}, nil
}

func (q *presenceQueryCoordinator) Query(
	ctx context.Context,
	requesterPTID string,
	actorPTIDs []string,
) ([]domain.Status, error) {
	requesterPTID = strings.TrimSpace(requesterPTID)
	requested, err := normalizePresenceQueryActors(actorPTIDs)
	if err != nil {
		return nil, err
	}
	if requesterPTID == "" || q == nil || q.local == nil || q.dependencies == nil {
		return nil, fmt.Errorf("presence query dependencies are incomplete")
	}
	dependencies, err := q.dependencies()
	if err != nil {
		return nil, err
	}
	localStationPeerID := strings.TrimSpace(
		dependencies.federation.LocalStationPeerID(),
	)
	if localStationPeerID == "" {
		return nil, fmt.Errorf("local Station peer identity is unavailable")
	}

	localActors := make([]string, 0, len(requested))
	remoteActors := make(map[string][]string)
	for _, actorPTID := range requested {
		homeStationPeerID, resolveErr := dependencies.actors.
			ResolveActorHomeStationPeerID(ctx, actorPTID)
		if resolveErr != nil {
			continue
		}
		homeStationPeerID = strings.TrimSpace(homeStationPeerID)
		if homeStationPeerID == "" {
			continue
		}
		if homeStationPeerID == localStationPeerID {
			localActors = append(localActors, actorPTID)
			continue
		}
		remoteActors[homeStationPeerID] = append(
			remoteActors[homeStationPeerID],
			actorPTID,
		)
	}

	statusByActor := make(map[string]domain.Status, len(requested))
	if len(localActors) > 0 {
		statuses, queryErr := q.local.Query(localActors)
		if queryErr != nil {
			return nil, queryErr
		}
		for _, status := range statuses {
			statusByActor[status.ActorPTID] = status
		}
	}

	type remoteResult struct {
		targetStationPeerID string
		statuses            []domain.Status
		err                 error
	}
	results := make(chan remoteResult, len(remoteActors))
	var wait sync.WaitGroup
	for targetStationPeerID, group := range remoteActors {
		targetStationPeerID := targetStationPeerID
		group := append([]string(nil), group...)
		wait.Add(1)
		go func() {
			defer wait.Done()
			statuses, queryErr := q.queryRemote(
				ctx,
				dependencies.federation,
				localStationPeerID,
				targetStationPeerID,
				requesterPTID,
				group,
			)
			results <- remoteResult{
				targetStationPeerID: targetStationPeerID,
				statuses:            statuses,
				err:                 queryErr,
			}
		}()
	}
	wait.Wait()
	close(results)
	for result := range results {
		if result.err != nil {
			logger.DefaultHelper.Warnf(
				"presence: remote query unavailable target_station_peer_id=%s err=%v",
				result.targetStationPeerID,
				result.err,
			)
			continue
		}
		for _, status := range result.statuses {
			statusByActor[status.ActorPTID] = status
		}
	}

	out := make([]domain.Status, 0, len(statusByActor))
	for _, actorPTID := range requested {
		if status, ok := statusByActor[actorPTID]; ok {
			out = append(out, status)
		}
	}

	return out, nil
}

func (q *presenceQueryCoordinator) queryRemote(
	ctx context.Context,
	federation federationPresenceCaller,
	localStationPeerID string,
	targetStationPeerID string,
	requesterPTID string,
	actorPTIDs []string,
) ([]domain.Status, error) {
	request := &presencemodel.PresenceQueryRequest{ActorPtids: actorPTIDs}
	requestSHA256, err := federationruntime.PresenceQueryRequestSHA256(request)
	if err != nil {
		return nil, err
	}
	response := &presencemodel.PresenceQueryResponse{}
	callContext, cancel := context.WithTimeout(ctx, remotePresenceTimeout)
	defer cancel()
	err = federation.CallPeer(callContext, federationruntime.PeerCall{
		TargetStationPeerID: targetStationPeerID,
		Route:               federationruntime.PeerRoutePresenceQuery,
		Subject:             requesterPTID,
		Claims: map[string]string{
			federationruntime.ClaimRequesterPTID:         requesterPTID,
			federationruntime.ClaimPresenceRequestSHA256: requestSHA256,
			federationruntime.ClaimSourceStationPeerID:   localStationPeerID,
			federationruntime.ClaimTargetStationPeerID:   targetStationPeerID,
		},
		Request:  request,
		Response: response,
	})
	if err != nil {
		return nil, err
	}

	return validatedPeerPresenceStatuses(response, actorPTIDs)
}

func (s *subServer) QueryLocalPresence(
	ctx context.Context,
	actorPTIDs []string,
) ([]*presencemodel.PresenceStatus, error) {
	requested, err := normalizePresenceQueryActors(actorPTIDs)
	if err != nil {
		return nil, err
	}
	dependencies, err := resolvePresenceQueryDependencies()
	if err != nil {
		return nil, err
	}
	localStationPeerID := dependencies.federation.LocalStationPeerID()
	localActors := make([]string, 0, len(requested))
	for _, actorPTID := range requested {
		homeStationPeerID, resolveErr := dependencies.actors.
			ResolveActorHomeStationPeerID(ctx, actorPTID)
		if resolveErr != nil || homeStationPeerID != localStationPeerID {
			continue
		}
		localActors = append(localActors, actorPTID)
	}
	statuses, err := s.service.Query(localActors)
	if err != nil {
		return nil, err
	}
	out := make([]*presencemodel.PresenceStatus, 0, len(statuses))
	for _, status := range statuses {
		out = append(out, statusResponse(status))
	}

	return out, nil
}

func normalizePresenceQueryActors(actorPTIDs []string) ([]string, error) {
	if len(actorPTIDs) > maxPresenceQueryActors {
		return nil, fmt.Errorf(
			"presence query contains %d actors; maximum is %d",
			len(actorPTIDs),
			maxPresenceQueryActors,
		)
	}
	out := make([]string, 0, len(actorPTIDs))
	seen := make(map[string]struct{}, len(actorPTIDs))
	for _, raw := range actorPTIDs {
		actorPTID := strings.TrimSpace(raw)
		if actorPTID == "" {
			continue
		}
		if _, ok := seen[actorPTID]; ok {
			continue
		}
		seen[actorPTID] = struct{}{}
		out = append(out, actorPTID)
	}

	return out, nil
}

func validatedPeerPresenceStatuses(
	response *presencemodel.PresenceQueryResponse,
	requested []string,
) ([]domain.Status, error) {
	if response == nil {
		return nil, fmt.Errorf("Presence peer response is nil")
	}
	allowed := make(map[string]struct{}, len(requested))
	for _, actorPTID := range requested {
		allowed[actorPTID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(response.Statuses))
	out := make([]domain.Status, 0, len(response.Statuses))
	for _, status := range response.Statuses {
		if status == nil {
			return nil, fmt.Errorf("Presence peer response contains a nil status")
		}
		actorPTID := strings.TrimSpace(status.GetActorPtid())
		if _, ok := allowed[actorPTID]; !ok {
			return nil, fmt.Errorf(
				"Presence peer response contains unrequested actor",
			)
		}
		if _, ok := seen[actorPTID]; ok {
			return nil, fmt.Errorf(
				"Presence peer response contains duplicate actor",
			)
		}
		seen[actorPTID] = struct{}{}
		state := domain.State(status.GetState())
		if state != domain.StateOnline && state != domain.StateOffline {
			return nil, fmt.Errorf(
				"Presence peer response contains invalid state",
			)
		}
		projected := domain.Status{
			ActorPTID: actorPTID,
			State:     state,
		}
		if status.GetLastSeenAt() != nil && status.GetLastSeenAt().IsValid() {
			projected.LastSeenAt = status.GetLastSeenAt().AsTime()
		}
		if status.GetLeaseExpiresAt() != nil &&
			status.GetLeaseExpiresAt().IsValid() {
			projected.LeaseExpiresAt = status.GetLeaseExpiresAt().AsTime()
		}
		out = append(out, projected)
	}

	return out, nil
}
