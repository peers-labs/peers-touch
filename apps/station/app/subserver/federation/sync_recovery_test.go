package federation

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"google.golang.org/protobuf/proto"
)

func TestLeaveImportOverlappingSyncAllowsRejoin(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	cfg.Stations = cfg.Stations[:2]
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	feds, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	id := feds[0].FederationID
	initial, err := authorityLedger.FetchAllEvents(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	replica, replicaLedger, replicaRepos := setupTestServices(t)
	input := &application.BootstrapFederationReplicaInput{
		FederationID:                      id,
		LocalActorPTID:                    cfg.Stations[1].ActorPTID,
		LocalStationPeerID:                cfg.Stations[1].PeerID,
		ExpectedSequencerStationPeerID:    cfg.Stations[0].PeerID,
		ExpectedSequencerStationPublicKey: genesisStationPublicKey(t, initial),
		Events:                            initial,
	}
	if err := replica.BootstrapReplica(ctx, input); err != nil {
		t.Fatal(err)
	}
	left, err := authority.ApproveLeaveAsSequencer(
		ctx, id, cfg.Stations[1].ActorPTID, cfg.Stations[1].FederatedHandle,
		cfg.Stations[1].PeerID, "overlapping poll",
	)
	if err != nil {
		t.Fatal(err)
	}
	events, err := authorityLedger.FetchAllEvents(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := replicaLedger.ImportBootstrapEvents(ctx, id, events); err != nil {
		t.Fatal(err)
	}
	manager := NewLedgerSyncManager(
		replicaLedger, replicaRepos.Federation, replicaRepos.LedgerEvent,
		replicaRepos.SyncCursor, replicaRepos.Membership,
		NewLedgerEventPublisher(replicaRepos.ActorRole), nil, cfg.Stations[1].PeerID,
	)
	for range 2 {
		if err := manager.ApplyRemoteEvent(ctx, left); err != nil {
			t.Fatalf("already committed leave must be idempotent: %v", err)
		}
	}
	stored, err := replicaRepos.Federation.GetByID(ctx, id)
	if err != nil || stored.Status != "active" || stored.HeadSeq != left.Seq {
		t.Fatalf("duplicate changed Federation: state=%v error=%v", stored, err)
	}
	if _, err := authority.ApproveJoinAsSequencer(
		ctx, id, cfg.Stations[1].PeerID, cfg.Stations[1].Name, cfg.Stations[1].URL,
	); err != nil {
		t.Fatal(err)
	}
	input.Events, err = authorityLedger.FetchAllEvents(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := replica.BootstrapReplica(ctx, input); err != nil {
		t.Fatalf("valid rejoin after overlapping leave import: %v", err)
	}
	conflict := proto.Clone(left).(*pb.LedgerEvent)
	conflict.EventHash = append([]byte(nil), left.EventHash...)
	conflict.EventHash[0] ^= 1
	if err := replicaRepos.LedgerCommitter.Commit(ctx, conflict, domain.LedgerProjectionMutation{}); !errors.Is(err, domain.ErrForkDetected) {
		t.Fatalf("same sequence with different hash must remain rejected: %v", err)
	}
}
