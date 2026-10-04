package federation

import (
	"context"
	"crypto/subtle"
	"testing"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	federationpb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })

	if err := infrastructure.MigrateSchema(db); err != nil {
		t.Fatalf("migrate federation test database: %v", err)
	}

	return db
}

func setupTestServices(t *testing.T) (*application.FederationService, *application.LedgerService, *infrastructure.Repos) {
	t.Helper()
	db := setupTestDB(t)
	repos := infrastructure.NewRepos(db)

	hashSvc := domain.NewHashService()
	sigSvc := domain.NewSignatureService()
	actorKeySvc := domain.NewActorKeyService(repos.ActorSigningKey)
	replaySvc := domain.NewReplayService(repos.LedgerEvent, hashSvc, sigSvc)

	policyRegistry := policy.NewRegistry()
	policyRegistry.Register(policy.SingleAdmin, policy.NewSingleAdminPolicy())

	ledgerSvc := application.NewLedgerService(
		repos.Federation,
		repos.LedgerEvent,
		repos.Membership,
		hashSvc,
		sigSvc,
		policyRegistry,
	)

	fedSvc := application.NewFederationService(
		repos.Federation,
		repos.Membership,
		repos.ActorRole,
		ledgerSvc,
		actorKeySvc,
		replaySvc,
	)

	return fedSvc, ledgerSvc, repos
}

func TestFederationContextsExposeOnlyClientScope(t *testing.T) {
	contexts := federationContexts(&federationpb.ListFederationsResponse{
		Federations: []*federationpb.FederationSummary{
			nil,
			{
				FederationId:           "federation-1",
				Name:                   "Development",
				Status:                 "active",
				PolicyType:             "single_admin",
				HeadSeq:                42,
				MemberStationCount:     3,
				SequencerStationPeerId: "station-admin",
				MyRole:                 "admin",
				Capability: &federationpb.ActorCapability{
					CanInvite: true,
				},
			},
			{
				FederationId: "federation-archived",
				Name:         "Archived",
				Status:       "archived",
			},
		},
	})

	if len(contexts.Contexts) != 1 {
		t.Fatalf("contexts = %d, want 1", len(contexts.Contexts))
	}
	context := contexts.Contexts[0]
	if context.FederationId != "federation-1" ||
		context.Name != "Development" ||
		context.Status != "active" {
		t.Fatalf("context = %+v", context)
	}
}

func TestFederationResolveViewUsesCanonicalHandleAndContext(t *testing.T) {
	for _, handle := range []string{
		"alice@station.example",
		"@alice@station.example",
	} {
		view := federationResolveView(
			"federation-1",
			&resolver.Resolved{
				Envelope: &profilepb.ActorProfileEnvelope{
					FederatedHandle: handle,
				},
				Locator: &locatorpb.ActorLocatorRecord{Seq: 74},
			},
		)
		if got, want := view.GetFederatedHandle(), "@alice@station.example"; got != want {
			t.Fatalf("resolve handle = %q, want %q", got, want)
		}
		if got := view.GetFederationId(); got != "federation-1" {
			t.Fatalf("resolve Federation context = %q", got)
		}
	}
}

func TestSeedTestnet_CreatesAndReplaysConsistently(t *testing.T) {
	ctx := context.Background()
	fedSvc, ledgerSvc, repos := setupTestServices(t)

	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, fedSvc, ledgerSvc); err != nil {
		t.Fatalf("seedTestnet failed: %v", err)
	}

	feds, err := repos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatalf("ListByStation failed: %v", err)
	}
	if len(feds) != 1 {
		t.Fatalf("expected 1 federation, got %d", len(feds))
	}

	fed := feds[0]
	if fed.Name != "Peers Testnet" {
		t.Errorf("expected name 'Peers Testnet', got '%s'", fed.Name)
	}
	if fed.Status != "active" {
		t.Errorf("expected status 'active', got '%s'", fed.Status)
	}

	state, err := fedSvc.Replay(ctx, fed.FederationID)
	if err != nil {
		t.Fatalf("Replay failed: %v", err)
	}

	if state.HeadSeq != 2 {
		t.Errorf("expected head_seq=2 (3 events), got %d", state.HeadSeq)
	}

	if len(state.ActiveMemberStations) != 3 {
		t.Errorf("expected 3 active stations, got %d: %v", len(state.ActiveMemberStations), state.ActiveMemberStations)
	}

	if subtle.ConstantTimeCompare(state.HeadHash, fed.HeadHash) != 1 {
		t.Errorf("replay head_hash does not match federation record head_hash")
	}

	if state.SequencerStationPeerID != "node-a" {
		t.Errorf("expected sequencer 'node-a', got '%s'", state.SequencerStationPeerID)
	}

	t.Logf("federation_id=%s, head_seq=%d, members=%d, sequencer=%s",
		fed.FederationID, state.HeadSeq, len(state.ActiveMemberStations), state.SequencerStationPeerID)
}

func TestNonSequencerAppendRejected(t *testing.T) {
	ctx := context.Background()
	fedSvc, ledgerSvc, repos := setupTestServices(t)

	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, fedSvc, ledgerSvc); err != nil {
		t.Fatalf("seedTestnet failed: %v", err)
	}

	feds, err := repos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatalf("ListByStation failed: %v", err)
	}
	fed := feds[0]

	_, err = ledgerSvc.AppendEvent(ctx, &application.AppendEventInput{
		FederationID:         fed.FederationID,
		EventType:            4,
		PayloadBytes:         []byte("test"),
		ActorPTID:            "ptid:v1:actor:peers:p:b",
		ActorFederatedHandle: "@b@two.peers.touch",
		StationPeerID:        "node-b",
	})

	if err == nil {
		t.Fatal("expected error for non-sequencer append, got nil")
	}

	t.Logf("correctly rejected non-sequencer append: %v", err)
}

func TestBootstrapReplicaMaterializesCanonicalLedgerAndStationURLs(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	federationID := federations[0].FederationID
	events, err := authorityLedger.FetchEvents(ctx, federationID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}

	replica, _, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:       federationID,
			LocalActorPTID:     "ptid:v1:actor:peers:p:b",
			LocalStationPeerID: "node-b",
			Events:             events,
		},
	); err != nil {
		t.Fatal(err)
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(ctx, "node-b")
	if err != nil || len(replicaFederations) != 1 {
		t.Fatalf("replica federations=%d err=%v", len(replicaFederations), err)
	}
	if replicaFederations[0].HeadSeq != 2 {
		t.Fatalf("replica head=%d want=2", replicaFederations[0].HeadSeq)
	}
	members, err := replicaRepos.Membership.ListByFederation(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 3 {
		t.Fatalf("replica member count=%d want=3", len(members))
	}
	for _, member := range members {
		if member.StationURL == "" {
			t.Fatalf("member %s lost Station URL", member.StationPeerID)
		}
	}
}

func TestBootstrapReplicaRejectsForgedLedgerBeforeMembershipWrites(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	events, err := authorityLedger.FetchEvents(
		ctx,
		federations[0].FederationID,
		0,
		100,
	)
	if err != nil {
		t.Fatal(err)
	}
	forged := make([]*federationpb.LedgerEvent, len(events))
	for index, event := range events {
		forged[index] = proto.Clone(event).(*federationpb.LedgerEvent)
	}
	forged[1].EventHash[0] ^= 0xff

	replica, _, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:       federations[0].FederationID,
			LocalActorPTID:     "ptid:v1:actor:peers:p:b",
			LocalStationPeerID: "node-b",
			Events:             forged,
		},
	); err == nil {
		t.Fatal("forged bootstrap ledger was accepted")
	}
	members, err := replicaRepos.Membership.ListByFederation(
		ctx,
		federations[0].FederationID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 0 {
		t.Fatalf("forged bootstrap wrote %d memberships", len(members))
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(replicaFederations) != 0 {
		t.Fatalf("forged bootstrap wrote %d Federation records", len(replicaFederations))
	}
}

func TestRemoteEventAdvancesHeadAndMembershipProjectionTogether(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	federationID := federations[0].FederationID
	events, err := authorityLedger.FetchEvents(ctx, federationID, 0, 100)
	if err != nil || len(events) != 3 {
		t.Fatalf("authority events=%d err=%v", len(events), err)
	}

	replica, replicaLedger, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:       federationID,
			LocalActorPTID:     "ptid:v1:actor:peers:p:b",
			LocalStationPeerID: "node-b",
			Events:             events[:2],
		},
	); err != nil {
		t.Fatal(err)
	}
	manager := NewLedgerSyncManager(
		replicaLedger,
		replicaRepos.Federation,
		replicaRepos.LedgerEvent,
		replicaRepos.SyncCursor,
		replicaRepos.Membership,
		NewLedgerEventPublisher(replicaRepos.ActorRole),
		domain.NewHashService(),
		nil,
		"node-b",
	)
	if err := manager.ApplyRemoteEvent(ctx, events[2]); err != nil {
		t.Fatal(err)
	}
	members, err := replicaRepos.Membership.ListByFederation(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 3 {
		t.Fatalf("membership projection count=%d want=3", len(members))
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(ctx, "node-b")
	if err != nil || len(replicaFederations) != 1 {
		t.Fatalf("replica federations=%d err=%v", len(replicaFederations), err)
	}
	if replicaFederations[0].HeadSeq != 2 {
		t.Fatalf("replica head=%d want=2", replicaFederations[0].HeadSeq)
	}
}
