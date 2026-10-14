package federation

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"google.golang.org/protobuf/proto"
)

type catalogCallerStub struct {
	localPeerID string
	call        func(context.Context, federationruntime.PeerCall) error
}

func (s catalogCallerStub) CallPeer(
	ctx context.Context,
	call federationruntime.PeerCall,
) error {
	if s.call == nil {
		return nil
	}
	return s.call(ctx, call)
}

func (s catalogCallerStub) LocalStationPeerID() string {
	return s.localPeerID
}

func catalogTestCoordinator(
	t *testing.T,
	config catalogConfig,
	caller catalogCallerStub,
	remotePeerIDs ...string,
) *catalogCoordinator {
	t.Helper()
	_, _, repos := setupTestServices(t)
	federationID := "federation-catalog-test"
	if err := repos.Federation.Create(context.Background(), &domain.FederationRecord{
		FederationID:           federationID,
		Name:                   "Catalog Test",
		Status:                 "active",
		PolicyType:             "single_admin",
		SequencerStationPeerID: caller.localPeerID,
		GenesisHash:            make([]byte, 32),
		HeadHash:               make([]byte, 32),
		CreatedByActorPTID:     "ptid:catalog-owner",
		CreatedByStationPeerID: caller.localPeerID,
	}); err != nil {
		t.Fatal(err)
	}
	for index, peerID := range append([]string{caller.localPeerID}, remotePeerIDs...) {
		if err := repos.Membership.Upsert(context.Background(), &domain.MembershipRecord{
			FederationID:  federationID,
			StationPeerID: peerID,
			StationName:   "Station " + peerID,
			StationURL:    "https://" + peerID + ".test",
			Role:          "member_station",
			Status:        "active",
			JoinedAt:      time.Unix(int64(index+1), 0).UTC().Format(time.RFC3339),
		}); err != nil {
			t.Fatal(err)
		}
	}
	return newCatalogCoordinator(
		config,
		application.NewProjectionService(
			repos.Federation,
			repos.Membership,
			repos.ActorRole,
			repos.SyncCursor,
		),
		repos.Federation,
		repos.Membership,
		caller,
	)
}

func catalogTestConfig() catalogConfig {
	return catalogConfig{
		Enabled:         true,
		QPS:             100,
		Burst:           100,
		FanoutTimeout:   20 * time.Millisecond,
		MaxPageSize:     100,
		MaxPrefixLength: 64,
	}
}

func TestCatalogCoordinatorKeepsPartialFanoutResultsAndSignedScope(t *testing.T) {
	caller := catalogCallerStub{localPeerID: "station-local"}
	caller.call = func(_ context.Context, call federationruntime.PeerCall) error {
		if call.Route != federationruntime.PeerRouteFederationCatalogSearch ||
			call.Claims[federationruntime.ClaimFederationID] != "federation-catalog-test" ||
			call.Claims[federationruntime.ClaimSourceStationPeerID] != "station-local" ||
			call.Claims[federationruntime.ClaimTargetStationPeerID] != call.TargetStationPeerID ||
			call.Claims[federationruntime.ClaimCatalogRequestSHA256] == "" {
			t.Fatalf("peer call is not scope-bound: %+v", call)
		}
		if call.TargetStationPeerID == "station-unavailable" {
			return errors.New("peer unavailable")
		}
		response := call.Response.(*pb.FederationCatalogSearchResponse)
		proto.Merge(response, &pb.FederationCatalogSearchResponse{
			Entries: []*pb.FederationCatalogEntry{{
				ActorPtid:         "ptid:bob",
				FederatedHandle:   "@bob@station-remote.test",
				DisplayName:       "Bob",
				HomeStationPeerId: call.TargetStationPeerID,
			}},
			Sources: []*pb.FederationCatalogSource{{
				StationPeerId: call.TargetStationPeerID,
				Outcome:       pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
			}},
		})
		return nil
	}
	coordinator := catalogTestCoordinator(
		t,
		catalogTestConfig(),
		caller,
		"station-remote",
		"station-unavailable",
	)
	response, err := coordinator.Search(context.Background(), "ptid:alice", &pb.FederationCatalogSearchRequest{
		FederationId: "federation-catalog-test",
		Prefix:       "bo",
		PageSize:     20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !response.Partial || len(response.Entries) != 1 ||
		response.Entries[0].ActorPtid != "ptid:bob" {
		t.Fatalf("partial response = %+v", response)
	}
	if response.NextPageToken != "" {
		t.Fatalf("partial response exposed an unsafe global cursor: %+v", response)
	}
	outcomes := map[string]pb.FederationCatalogSourceOutcome{}
	for _, source := range response.Sources {
		outcomes[source.StationPeerId] = source.Outcome
	}
	if outcomes["station-remote"] != pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK ||
		outcomes["station-unavailable"] != pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_UNAVAILABLE {
		t.Fatalf("source outcomes = %+v", outcomes)
	}
}

func TestCatalogCoordinatorClassifiesTimeoutDisabledAndRateLimit(t *testing.T) {
	timeoutCaller := catalogCallerStub{
		localPeerID: "station-local",
		call: func(ctx context.Context, _ federationruntime.PeerCall) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}
	coordinator := catalogTestCoordinator(
		t,
		catalogTestConfig(),
		timeoutCaller,
		"station-slow",
	)
	response, err := coordinator.Search(context.Background(), "ptid:alice", &pb.FederationCatalogSearchRequest{
		FederationId: "federation-catalog-test",
		Prefix:       "a",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !response.Partial || response.Sources[1].Outcome !=
		pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_TIMEOUT {
		t.Fatalf("timeout response = %+v", response)
	}

	disabled := catalogTestConfig()
	disabled.Enabled = false
	coordinator = catalogTestCoordinator(t, disabled, catalogCallerStub{
		localPeerID: "station-local",
	})
	response, err = coordinator.SearchLocalForPeer(
		context.Background(),
		"station-local",
		&pb.FederationCatalogSearchRequest{
			FederationId: "federation-catalog-test",
			Prefix:       "a",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Sources[0].Outcome !=
		pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_DISABLED {
		t.Fatalf("disabled response = %+v", response)
	}

	limited := catalogTestConfig()
	limited.QPS = 0.0001
	limited.Burst = 1
	coordinator = catalogTestCoordinator(t, limited, catalogCallerStub{
		localPeerID: "station-local",
	})
	request := &pb.FederationCatalogSearchRequest{
		FederationId: "federation-catalog-test",
		Prefix:       "a",
	}
	if _, err := coordinator.SearchLocalForPeer(context.Background(), "station-local", request); err != nil {
		t.Fatal(err)
	}
	response, err = coordinator.SearchLocalForPeer(context.Background(), "station-local", request)
	if err != nil {
		t.Fatal(err)
	}
	if response.Sources[0].Outcome !=
		pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_RATE_LIMITED {
		t.Fatalf("rate-limited response = %+v", response)
	}
}

func TestAggregateCatalogResultsUsesStableKeysetCursor(t *testing.T) {
	results := make(chan catalogSourceResult, 2)
	results <- catalogSourceResult{
		target: catalogSourceTarget{peerID: "station-b"},
		response: &pb.FederationCatalogSearchResponse{
			Entries: []*pb.FederationCatalogEntry{
				{
					ActorPtid:         "ptid:carol",
					FederatedHandle:   "@carol@station-b",
					HomeStationPeerId: "station-b",
				},
				{
					ActorPtid:         "ptid:alice",
					FederatedHandle:   "@alice@station-b",
					HomeStationPeerId: "station-b",
				},
			},
			Sources: []*pb.FederationCatalogSource{{
				StationPeerId: "station-b",
				Outcome:       pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
			}},
		},
		outcome: pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
	}
	results <- catalogSourceResult{
		target: catalogSourceTarget{peerID: "station-a"},
		response: &pb.FederationCatalogSearchResponse{
			Entries: []*pb.FederationCatalogEntry{{
				ActorPtid:         "ptid:bob",
				FederatedHandle:   "@bob@station-a",
				HomeStationPeerId: "station-a",
			}},
			Sources: []*pb.FederationCatalogSource{{
				StationPeerId: "station-a",
				Outcome:       pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
			}},
		},
		outcome: pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
	}
	close(results)

	response := aggregateCatalogResults(
		"station-a",
		&pb.FederationCatalogSearchRequest{PageSize: 2},
		results,
	)
	if len(response.Entries) != 2 ||
		response.Entries[0].ActorPtid != "ptid:alice" ||
		response.Entries[1].ActorPtid != "ptid:bob" ||
		response.NextPageToken == "" {
		t.Fatalf("aggregated response = %+v", response)
	}
	cursor, err := decodeCatalogCursor(response.NextPageToken)
	if err != nil {
		t.Fatal(err)
	}
	if cursor.Handle != "@bob@station-a" || cursor.PTID != "ptid:bob" {
		t.Fatalf("cursor = %+v", cursor)
	}
}

func TestCatalogCoordinatorRejectsArchivedFederation(t *testing.T) {
	coordinator := catalogTestCoordinator(
		t,
		catalogTestConfig(),
		catalogCallerStub{localPeerID: "station-local"},
	)
	if err := coordinator.federations.UpdateStatus(
		context.Background(),
		"federation-catalog-test",
		"archived",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := coordinator.Search(
		context.Background(),
		"ptid:alice",
		&pb.FederationCatalogSearchRequest{
			FederationId: "federation-catalog-test",
			Prefix:       "a",
		},
	); err == nil {
		t.Fatal("archived Federation catalog search was accepted")
	}
}

func TestAggregateCatalogResultsChoosesDuplicateActorDeterministically(t *testing.T) {
	results := make(chan catalogSourceResult, 2)
	for _, peerID := range []string{"station-b", "station-a"} {
		results <- catalogSourceResult{
			target: catalogSourceTarget{peerID: peerID},
			response: &pb.FederationCatalogSearchResponse{
				Entries: []*pb.FederationCatalogEntry{{
					ActorPtid:         "ptid:duplicate",
					FederatedHandle:   "@duplicate@" + peerID,
					HomeStationPeerId: peerID,
				}},
			},
			outcome: pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
		}
	}
	close(results)

	response := aggregateCatalogResults(
		"station-a",
		&pb.FederationCatalogSearchRequest{PageSize: 20},
		results,
	)
	if len(response.Entries) != 1 ||
		response.Entries[0].HomeStationPeerId != "station-a" {
		t.Fatalf("duplicate winner = %+v", response.Entries)
	}
}
