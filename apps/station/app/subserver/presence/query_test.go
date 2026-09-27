package presence

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/domain"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	presencemodel "github.com/peers-labs/peers-touch/station/frame/touch/model/presence"
)

type queryTestLocal struct {
	statuses map[string]domain.Status
}

func (q queryTestLocal) Query(actorPTIDs []string) ([]domain.Status, error) {
	out := make([]domain.Status, 0, len(actorPTIDs))
	for _, actorPTID := range actorPTIDs {
		if status, ok := q.statuses[actorPTID]; ok {
			out = append(out, status)
		}
	}

	return out, nil
}

type queryTestHomes struct {
	homes map[string]string
}

func (q queryTestHomes) ResolveActorHomeStationPeerID(
	_ context.Context,
	actorPTID string,
) (string, error) {
	home, ok := q.homes[actorPTID]
	if !ok {
		return "", errors.New("home Station is unresolved")
	}

	return home, nil
}

type queryTestFederation struct {
	mu        sync.Mutex
	local     string
	responses map[string]*presencemodel.PresenceQueryResponse
	failures  map[string]error
	calls     []federationruntime.PeerCall
}

func (q *queryTestFederation) LocalStationPeerID() string {
	return q.local
}

func (q *queryTestFederation) CallPeer(
	_ context.Context,
	call federationruntime.PeerCall,
) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.calls = append(q.calls, call)
	if err := q.failures[call.TargetStationPeerID]; err != nil {
		return err
	}
	target, ok := call.Response.(*presencemodel.PresenceQueryResponse)
	if !ok {
		return errors.New("unexpected response type")
	}
	source := q.responses[call.TargetStationPeerID]
	if source == nil {
		return errors.New("response is unavailable")
	}
	target.Statuses = append(target.Statuses, source.Statuses...)

	return nil
}

func TestPresenceQueryCoordinatorPartitionsByActorHomeStation(t *testing.T) {
	now := time.Now().UTC()
	federation := &queryTestFederation{
		local: "station-local",
		responses: map[string]*presencemodel.PresenceQueryResponse{
			"station-remote": {
				Statuses: []*presencemodel.PresenceStatus{
					{
						ActorPtid: "ptid:bob",
						State:     presencemodel.PresenceState_PRESENCE_STATE_OFFLINE,
					},
				},
			},
		},
		failures: map[string]error{},
	}
	coordinator := newPresenceQueryCoordinator(
		queryTestLocal{statuses: map[string]domain.Status{
			"ptid:alice": {
				ActorPTID:      "ptid:alice",
				State:          domain.StateOnline,
				LastSeenAt:     now,
				LeaseExpiresAt: now.Add(time.Minute),
			},
		}},
		func() (presenceQueryDependencies, error) {
			return presenceQueryDependencies{
				actors: queryTestHomes{homes: map[string]string{
					"ptid:alice": "station-local",
					"ptid:bob":   "station-remote",
				}},
				federation: federation,
			}, nil
		},
	)

	statuses, err := coordinator.Query(
		context.Background(),
		"ptid:requester",
		[]string{"ptid:alice", "ptid:bob", "ptid:unknown", "ptid:alice"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 2 ||
		statuses[0].ActorPTID != "ptid:alice" ||
		statuses[0].State != domain.StateOnline ||
		statuses[1].ActorPTID != "ptid:bob" ||
		statuses[1].State != domain.StateOffline {
		t.Fatalf("statuses = %+v", statuses)
	}
	if len(federation.calls) != 1 {
		t.Fatalf("peer calls = %d, want 1", len(federation.calls))
	}
	call := federation.calls[0]
	if call.Route != federationruntime.PeerRoutePresenceQuery ||
		call.TargetStationPeerID != "station-remote" ||
		call.Subject != "ptid:requester" ||
		call.Claims[federationruntime.ClaimRequesterPTID] != "ptid:requester" ||
		call.Claims[federationruntime.ClaimPresenceRequestSHA256] == "" {
		t.Fatalf("peer call = %+v", call)
	}
}

func TestPresenceQueryCoordinatorOmitsUnavailableRemoteAuthority(t *testing.T) {
	federation := &queryTestFederation{
		local:     "station-local",
		responses: map[string]*presencemodel.PresenceQueryResponse{},
		failures: map[string]error{
			"station-remote": errors.New("peer unavailable"),
		},
	}
	coordinator := newPresenceQueryCoordinator(
		queryTestLocal{statuses: map[string]domain.Status{
			"ptid:alice": {
				ActorPTID: "ptid:alice",
				State:     domain.StateOnline,
			},
		}},
		func() (presenceQueryDependencies, error) {
			return presenceQueryDependencies{
				actors: queryTestHomes{homes: map[string]string{
					"ptid:alice": "station-local",
					"ptid:bob":   "station-remote",
				}},
				federation: federation,
			}, nil
		},
	)

	statuses, err := coordinator.Query(
		context.Background(),
		"ptid:requester",
		[]string{"ptid:alice", "ptid:bob"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 1 ||
		statuses[0].ActorPTID != "ptid:alice" {
		t.Fatalf("statuses = %+v, want only local authority", statuses)
	}
}

func TestValidatedPeerPresenceStatusesRejectsUnexpectedActor(t *testing.T) {
	statuses, err := validatedPeerPresenceStatuses(
		&presencemodel.PresenceQueryResponse{
			Statuses: []*presencemodel.PresenceStatus{
				{
					ActorPtid: "ptid:mallory",
					State:     presencemodel.PresenceState_PRESENCE_STATE_ONLINE,
				},
			},
		},
		[]string{"ptid:bob"},
	)
	if err == nil || statuses != nil {
		t.Fatalf(
			"unexpected peer actor result statuses=%+v err=%v",
			statuses,
			err,
		)
	}
}
