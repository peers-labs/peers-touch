package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAttachmentControllerIsolatesNodesAndStations(t *testing.T) {
	db := openAttachmentTestDB(t, "attachment-node-isolation")
	station := testPeerID(t).String()
	relayID := testPeerID(t)
	root := t.TempDir()
	var controllers []*AttachmentController
	for _, owner := range []string{station, station, testPeerID(t).String()} {
		runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeOff})
		t.Cleanup(func() { _ = runtime.Close() })
		controller, err := NewAttachmentController(db, runtime, owner, root)
		if err != nil {
			t.Fatal(err)
		}
		if err := controller.Initialize(t.Context()); err != nil {
			t.Fatal(err)
		}
		row := relayAttachmentPO{
			StationPeerID: owner, NodePeerID: runtime.host.ID().String(),
			RelayPeerID: relayID.String(), ControlOrigin: "http://127.0.0.1:1",
			DialAddresses:  []string{"/ip4/127.0.0.1/tcp/1/p2p/" + relayID.String()},
			CredentialFile: filepath.Join(controller.credentialRoot, relayID.String()+".json"),
			Source:         attachmentSourceInvitation, Enabled: true, Label: owner + "/" + runtime.host.ID().String(),
		}
		if err := controller.upsertDesired(t.Context(), &row); err != nil {
			t.Fatal(err)
		}
		if err := controller.Initialize(t.Context()); err != nil {
			t.Fatal(err)
		}
		controllers = append(controllers, controller)
	}
	for _, controller := range controllers {
		items, err := controller.ListAttachments(t.Context())
		if err != nil || len(items) != 1 ||
			items[0].Label != controller.stationPeerID+"/"+controller.nodePeerID {
			t.Fatalf("foreign Node attachment visible: %+v, err=%v", items, err)
		}
	}
	if controllers[0].credentialRoot == controllers[1].credentialRoot {
		t.Fatal("Node credential directories collide")
	}
	deleted, err := controllers[0].DeleteAttachment(t.Context(), relayID.String())
	if err != nil || !deleted.CleanupPending ||
		controllers[0].controlHasTarget(relayID) {
		t.Fatalf("local disable failed: %+v, err=%v", deleted, err)
	}
	for _, other := range controllers[1:] {
		items, err := other.ListAttachments(t.Context())
		if err != nil || len(items) != 1 || !items[0].Enabled ||
			items[0].CleanupPending || !other.controlHasTarget(relayID) {
			t.Fatalf("delete changed another owner: %+v, err=%v", items, err)
		}
		if _, err := other.RetryAttachment(t.Context(), relayID.String()); err != nil {
			t.Fatalf("other Node retry failed: %v", err)
		}
	}
	unknown := testPeerID(t).String()
	if _, err := controllers[0].DeleteAttachment(t.Context(), unknown); !errors.Is(err, ErrAttachmentNotFound) {
		t.Fatalf("unknown target accepted: %v", err)
	}
}

func TestAttachmentScopeMigratesLegacyPrimaryKeyWithoutGuessingOwner(t *testing.T) {
	db := openAttachmentTestDB(t, "attachment-legacy-migration")
	testAttachmentScopeMigration(t, db)
}

func TestAttachmentScopeMigrationPostgreSQL(t *testing.T) {
	db, _, _ := openAttachmentPostgreSQLTestDB(t)
	testAttachmentScopeMigration(t, db)
}

func TestAttachmentScopeMigrationFencesPostgreSQL(t *testing.T) {
	db, dsn, schema := openAttachmentPostgreSQLTestDB(t)
	testAttachmentMigrationFencesLegacyWriters(t, db, dsn, schema)
}

func openAttachmentPostgreSQLTestDB(t *testing.T) (*gorm.DB, string, string) {
	t.Helper()
	dsn := os.Getenv("PEERS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("PEERS_TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal("open PostgreSQL test database")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	schema := fmt.Sprintf("attachment_test_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec("DROP SCHEMA " + schema + " CASCADE") })
	if err := db.Exec("SET search_path TO " + schema).Error; err != nil {
		t.Fatal(err)
	}
	return db, dsn, schema
}

func TestOffModeHintsDoNotPreemptPersistedAttachment(t *testing.T) {
	db := openAttachmentTestDB(t, "attachment-off-mode-hints")
	target := Target{RelayPeerID: testPeerID(t), ControlOrigin: "http://127.0.0.1:1",
		Addresses: []string{"/ip4/127.0.0.1/tcp/1"}, CredentialFile: filepath.Join(t.TempDir(), "hint.json")}
	runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeOff, Targets: []Target{target}})
	defer runtime.Close()
	controller, err := NewAttachmentController(db, runtime, testPeerID(t).String(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := migrateAttachmentScope(db); err != nil {
		t.Fatal(err)
	}
	if err := controller.upsertDesired(t.Context(), &relayAttachmentPO{
		StationPeerID: controller.stationPeerID, NodePeerID: controller.nodePeerID,
		RelayPeerID: target.RelayPeerID.String(), ControlOrigin: target.ControlOrigin,
		DialAddresses: target.Addresses, CredentialFile: target.CredentialFile,
		Source: attachmentSourceInvitation, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatal("off-mode restart failed:", err)
	}
	if len(runtime.targets()) != 1 || !controller.controlHasTarget(target.RelayPeerID) {
		t.Fatal("persisted attachment was not restored into both target sets")
	}
}

func TestUnverifiedLegacyTombstoneBlocksBootstrapResurrection(t *testing.T) {
	db := openAttachmentTestDB(t, "attachment-unowned-tombstone")
	target := Target{RelayPeerID: testPeerID(t), ControlOrigin: "http://127.0.0.1:1",
		Addresses: []string{"/ip4/127.0.0.1/tcp/1"}, InviteToken: "boot-hint",
		CredentialFile: filepath.Join(t.TempDir(), "missing.json")}
	if err := migrateAttachmentScope(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&relayAttachmentPO{RelayPeerID: target.RelayPeerID.String(),
		ControlOrigin: target.ControlOrigin, DialAddresses: target.Addresses,
		CredentialFile: target.CredentialFile, Source: attachmentSourceBootstrap,
		LastError: "legacy owner unverified"}).Error; err != nil {
		t.Fatal(err)
	}
	runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeCustom, Targets: []Target{target}})
	defer runtime.Close()
	controller, err := NewAttachmentController(db, runtime, testPeerID(t).String(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(runtime.targets()) != 0 || controller.controlHasTarget(target.RelayPeerID) {
		t.Fatal("bootstrap hint resurrected an unresolved legacy attachment")
	}
	var count int64
	if err := controller.ownedDB(t.Context()).Model(&relayAttachmentPO{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("bootstrap assigned unknown ownership: count=%d err=%v", count, err)
	}
}

func testAttachmentMigrationFencesLegacyWriters(t *testing.T, db *gorm.DB, dsn, schema string) {
	t.Helper()
	if err := db.Exec(`CREATE TABLE station_relay_attachment (
		relay_peer_id TEXT PRIMARY KEY, control_origin TEXT, dial_addresses TEXT,
		credential_file TEXT, source TEXT, enabled BOOLEAN
	)`).Error; err != nil {
		t.Fatal(err)
	}
	relayID := testPeerID(t).String()
	if err := db.Exec(`INSERT INTO station_relay_attachment VALUES (?, ?, ?, ?, ?, ?)`,
		relayID, "http://127.0.0.1:1", `["/ip4/127.0.0.1/tcp/1"]`,
		filepath.Join(t.TempDir(), "missing.json"), attachmentSourceInvitation, true).Error; err != nil {
		t.Fatal(err)
	}
	probe, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlProbe, err := probe.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlProbe.SetMaxOpenConns(1)
	defer sqlProbe.Close()
	if err := probe.Exec("SET search_path TO " + schema).Error; err != nil {
		t.Fatal(err)
	}
	captured, proceed := make(chan struct{}), make(chan struct{})
	const callback = "test:pause_attachment_snapshot"
	if err := db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "station_relay_attachment" {
			close(captured)
			<-proceed
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer db.Callback().Query().Remove(callback)
	var release sync.Once
	defer release.Do(func() { close(proceed) })
	done := make(chan error, 1)
	go func() { done <- migrateAttachmentScope(db) }()
	select {
	case <-captured:
	case err := <-done:
		t.Fatalf("migration did not capture legacy rows: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("migration snapshot timed out")
	}
	// The snapshot must exclude legacy writes through the table swap.
	err = probe.Transaction(func(tx *gorm.DB) error {
		return tx.Exec("LOCK TABLE station_relay_attachment IN ROW EXCLUSIVE MODE NOWAIT").Error
	})
	var state interface{ SQLState() string }
	if !errors.As(err, &state) || state.SQLState() != "55P03" {
		t.Errorf("legacy writer was not fenced while snapshot was held: %v", err)
	}
	release.Do(func() { close(proceed) })
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := probe.Exec("UPDATE station_relay_attachment SET enabled = false WHERE relay_peer_id = ?", relayID).Error; err != nil {
		t.Fatal("legacy write did not resume after migration:", err)
	}
}

func testAttachmentScopeMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	type legacyAttachment struct {
		RelayPeerID    string `gorm:"primaryKey"`
		ControlOrigin  string
		DialAddresses  []string `gorm:"serializer:json"`
		CredentialFile string
		Enabled        bool
		Source         string
	}
	table := (&relayAttachmentPO{}).TableName()
	if err := db.Table(table).Migrator().CreateTable(&legacyAttachment{}); err != nil {
		t.Fatal(err)
	}
	key, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	relayID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	station, node := testPeerID(t).String(), testPeerID(t).String()
	now := time.Now().UTC()
	rawKey, err := key.Raw()
	if err != nil {
		t.Fatal(err)
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"type": "relay_enrollment", "station_peer_id": station, "node_peer_id": node,
		"iss": relayID.String(), "aud": "peers-touch-relay-enrollment",
		"sub": "relay-access:" + station + ":" + node,
		"iat": now.Add(-time.Hour).Unix(), "exp": now.Add(-45 * time.Minute).Unix(),
	}).SignedString(ed25519.PrivateKey(rawKey))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "legacy-credential.json")
	if err := persistRelayCredential(path, relayCredential{Token: token}); err != nil {
		t.Fatal(err)
	}
	rows := []legacyAttachment{
		{RelayPeerID: relayID.String(), ControlOrigin: "http://127.0.0.1:1",
			DialAddresses: []string{"/ip4/127.0.0.1/tcp/1"}, CredentialFile: path, Enabled: true, Source: attachmentSourceInvitation},
		{RelayPeerID: testPeerID(t).String(), CredentialFile: filepath.Join(t.TempDir(), "missing.json")},
	}
	if err := db.Table(table).Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateAttachmentScope(db); err != nil {
		t.Fatal(err)
	}
	var migrated []relayAttachmentPO
	if err := db.Order("relay_peer_id").Find(&migrated).Error; err != nil {
		t.Fatal(err)
	}
	if len(migrated) != 2 {
		t.Fatalf("migration lost rows: %+v", migrated)
	}
	for _, row := range migrated {
		if row.RelayPeerID == relayID.String() {
			if row.StationPeerID != station || row.NodePeerID != node || !row.Enabled {
				t.Fatalf("verified owner not preserved: %+v", row)
			}
		} else if row.StationPeerID != "" || row.NodePeerID != "" || row.LastError == "" {
			t.Fatalf("migration guessed unresolved ownership: %+v", row)
		}
	}
	// The old Relay-only primary key must actually be gone.
	copyRow := migrated[0]
	copyRow.StationPeerID, copyRow.NodePeerID = testPeerID(t).String(), testPeerID(t).String()
	if err := db.Create(&copyRow).Error; err != nil {
		t.Fatalf("legacy primary key survived migration: %v", err)
	}
	if err := migrateAttachmentScope(db); err != nil {
		t.Fatalf("repeated migration failed: %v", err)
	}
}
