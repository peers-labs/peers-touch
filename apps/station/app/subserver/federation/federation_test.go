package federation

import (
	"context"
	"crypto/subtle"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
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
