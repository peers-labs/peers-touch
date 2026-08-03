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

	db.Exec(`CREATE TABLE IF NOT EXISTS federation (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		federation_id VARCHAR(30) NOT NULL UNIQUE,
		name VARCHAR(255) NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		status VARCHAR(20) NOT NULL DEFAULT 'active',
		policy_type VARCHAR(30) NOT NULL DEFAULT 'single_admin',
		sequencer_station_peer_id VARCHAR(128) NOT NULL,
		genesis_hash BLOB NOT NULL,
		head_hash BLOB NOT NULL,
		head_seq INTEGER NOT NULL DEFAULT 0,
		created_by_actor_id VARCHAR(64) NOT NULL,
		created_by_station_peer_id VARCHAR(128) NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS federation_ledger_event (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		event_id VARCHAR(30) NOT NULL UNIQUE,
		federation_id VARCHAR(30) NOT NULL,
		seq INTEGER NOT NULL,
		prev_hash BLOB NOT NULL,
		event_hash BLOB NOT NULL,
		event_type INTEGER NOT NULL,
		payload_bytes BLOB NOT NULL,
		payload_hash BLOB NOT NULL,
		actor_id VARCHAR(64) NOT NULL,
		actor_federated_handle VARCHAR(255) NOT NULL DEFAULT '',
		station_peer_id VARCHAR(128) NOT NULL,
		sequencer_station_peer_id VARCHAR(128) NOT NULL,
		actor_signature BLOB NOT NULL,
		station_signature BLOB NOT NULL,
		sequencer_signature BLOB NOT NULL,
		created_at_unix_ms INTEGER NOT NULL,
		UNIQUE(federation_id, seq)
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS federation_station_membership (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		federation_id VARCHAR(30) NOT NULL,
		station_peer_id VARCHAR(128) NOT NULL,
		station_name VARCHAR(255) NOT NULL DEFAULT '',
		station_url VARCHAR(512) NOT NULL DEFAULT '',
		role VARCHAR(30) NOT NULL DEFAULT 'member_station',
		status VARCHAR(20) NOT NULL DEFAULT 'active',
		joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		approved_by_event_id VARCHAR(30) NOT NULL DEFAULT '',
		UNIQUE(federation_id, station_peer_id)
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS federation_actor_role (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		federation_id VARCHAR(30) NOT NULL,
		actor_id VARCHAR(64) NOT NULL,
		actor_federated_handle VARCHAR(255) NOT NULL DEFAULT '',
		station_peer_id VARCHAR(128) NOT NULL,
		role VARCHAR(30) NOT NULL,
		granted_by_event_id VARCHAR(30) NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		revoked_at DATETIME,
		UNIQUE(federation_id, actor_id)
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS actor_signing_key (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		actor_id VARCHAR(64) NOT NULL UNIQUE,
		public_key BLOB NOT NULL,
		encrypted_private_key BLOB NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		rotated_at DATETIME
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS federation_sync_cursor (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		federation_id VARCHAR(30) NOT NULL,
		remote_station_peer_id VARCHAR(128) NOT NULL,
		last_seen_head_hash BLOB,
		last_seen_head_seq INTEGER NOT NULL DEFAULT 0,
		last_applied_seq INTEGER NOT NULL DEFAULT 0,
		last_sync_at DATETIME,
		status VARCHAR(30) NOT NULL DEFAULT 'healthy',
		error_code INTEGER NOT NULL DEFAULT 0,
		error_message TEXT NOT NULL DEFAULT '',
		UNIQUE(federation_id, remote_station_peer_id)
	)`)

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
		FederationID:  fed.FederationID,
		EventType:     4,
		PayloadBytes:  []byte("test"),
		ActorID:       "actor-b",
		ActorHandle:   "@b@two.peers.touch",
		StationPeerID: "node-b",
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
			LocalActorID:       "actor-b",
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
			LocalActorID:       "actor-b",
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
			LocalActorID:       "actor-b",
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
