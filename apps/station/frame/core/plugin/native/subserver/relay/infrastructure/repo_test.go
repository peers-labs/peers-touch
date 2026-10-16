package infrastructure

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAutoMigratePurgesLegacyInvitePlaintext(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-legacy-invite?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	if err := db.Exec(`
		CREATE TABLE relay_invite (
			id INTEGER PRIMARY KEY,
			token TEXT,
			station_peer_id TEXT,
			status INTEGER
		)
	`).Error; err != nil {
		t.Fatalf("create legacy invite table: %v", err)
	}
	if err := db.Exec(
		"CREATE UNIQUE INDEX idx_relay_invite_token ON relay_invite(token)",
	).Error; err != nil {
		t.Fatalf("create legacy invite index: %v", err)
	}
	if err := db.Exec(
		"CREATE INDEX idx_relay_invite_station_peer_id ON relay_invite(station_peer_id)",
	).Error; err != nil {
		t.Fatalf("create legacy invite identity index: %v", err)
	}
	if err := db.Exec(
		"INSERT INTO relay_invite (id, token, station_peer_id, status) VALUES (?, ?, ?, ?)",
		1,
		"legacy-plaintext-secret",
		"legacy-station",
		domain.InviteStatusActive,
	).Error; err != nil {
		t.Fatalf("insert legacy invite: %v", err)
	}

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("repeat Relay schema migration: %v", err)
	}
	if db.Migrator().HasColumn(&invitePO{}, "token") {
		t.Fatal("legacy plaintext token column still exists")
	}
	if db.Migrator().HasColumn(&invitePO{}, "station_peer_id") {
		t.Fatal("legacy invite Station identity column still exists")
	}
	var count int64
	if err := db.Model(&invitePO{}).Count(&count).Error; err != nil {
		t.Fatalf("count migrated invites: %v", err)
	}
	if count != 0 {
		t.Fatalf("legacy invites survived hard-cut migration: %d", count)
	}
	var schema string
	if err := db.Raw(
		"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'relay_invite'",
	).Scan(&schema).Error; err != nil {
		t.Fatalf("read Relay invite schema: %v", err)
	}
	if strings.Contains(strings.ToLower(schema), "token") {
		t.Fatalf("Relay invite schema still contains token column: %s", schema)
	}
}

func TestAutoMigrateMakesRelayInvitesPermanent(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-permanent-invite?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	if err := db.Exec(`
		CREATE TABLE relay_invite (
			id INTEGER PRIMARY KEY,
			secret_digest TEXT,
			intended_station_peer_id TEXT,
			label TEXT,
			max_clients INTEGER,
			bandwidth_limit INTEGER,
			status INTEGER,
			consumed_by TEXT,
			consumed_at DATETIME,
			expires_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)
	`).Error; err != nil {
		t.Fatalf("create expiring invite table: %v", err)
	}
	if err := db.Exec(
		"CREATE INDEX idx_relay_invite_expires_at ON relay_invite(expires_at)",
	).Error; err != nil {
		t.Fatalf("create expiry index: %v", err)
	}
	now := time.Now().UTC()
	for _, row := range []struct {
		id     int
		digest string
		status int
	}{
		{id: 1, digest: "active", status: 1},
		{id: 2, digest: "consumed", status: 2},
		{id: 3, digest: "expired", status: 3},
		{id: 4, digest: "revoked", status: 4},
	} {
		if err := db.Exec(
			`INSERT INTO relay_invite (
				id, secret_digest, status, expires_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?)`,
			row.id,
			row.digest,
			row.status,
			now.Add(-time.Hour),
			now,
			now,
		).Error; err != nil {
			t.Fatalf("insert legacy invite %d: %v", row.id, err)
		}
	}

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate permanent invite schema: %v", err)
	}
	var schema string
	if err := db.Raw(
		"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'relay_invite'",
	).Scan(&schema).Error; err != nil {
		t.Fatalf("read permanent invite schema: %v", err)
	}
	if db.Migrator().HasColumn(&invitePO{}, "expires_at") {
		t.Fatalf("permanent Relay invite schema still has expires_at: %s", schema)
	}
	if strings.Contains(strings.ToLower(schema), "expires_at") {
		t.Fatalf("permanent Relay invite schema contains expiry: %s", schema)
	}
	invites, err := repo.ListInvites(t.Context())
	if err != nil {
		t.Fatalf("list migrated invites: %v", err)
	}
	if len(invites) != 2 {
		t.Fatalf("migrated invites = %d, want active and consumed only", len(invites))
	}
	statuses := map[string]domain.InviteStatus{}
	for _, invite := range invites {
		statuses[invite.SecretDigest] = invite.Status
	}
	if statuses["active"] != domain.InviteStatusActive ||
		statuses["consumed"] != domain.InviteStatusConsumed {
		t.Fatalf("unexpected migrated invite states: %+v", statuses)
	}
}

func TestConsumeInviteAndCreateEnrollmentIsAtomic(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-atomic-enrollment?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	invite := &domain.Invite{
		SecretDigest: "digest",
		Status:       domain.InviteStatusActive,
	}
	if err := repo.CreateInvite(context.Background(), invite); err != nil {
		t.Fatalf("create invite: %v", err)
	}
	enrollment := &domain.Enrollment{
		StationPeerID:          "station-peer",
		NodePeerID:             "node-peer",
		StationRootPublicKey:   []byte{1, 2, 3},
		NodeAuthorizationEpoch: 1,
		NodeAuthorizationUntil: time.Now().UTC().Add(time.Hour),
		CredentialJTI:          "jti-1",
	}
	activated, err := repo.ConsumeInviteAndCreateEnrollment(
		context.Background(),
		invite.ID,
		enrollment,
		1,
	)
	if err != nil {
		t.Fatalf("activate enrollment: %v", err)
	}
	if activated.Generation != 1 ||
		activated.Status != domain.EnrollmentStatusOffline {
		t.Fatalf("unexpected activated enrollment: %+v", activated)
	}
	if _, err := repo.ConsumeInviteAndCreateEnrollment(
		context.Background(),
		invite.ID,
		enrollment,
		1,
	); !errors.Is(err, domain.ErrInviteAlreadyConsumed) {
		t.Fatalf("consumed invite replay error = %v", err)
	}

	restartedRepo := NewGormRepo(db)
	if _, err := restartedRepo.ConsumeInviteAndCreateEnrollment(
		context.Background(),
		invite.ID,
		enrollment,
		1,
	); !errors.Is(err, domain.ErrInviteAlreadyConsumed) {
		t.Fatalf("consumed invite replay after restart error = %v", err)
	}
}

func TestDeleteInviteOnlyRemovesActiveInvite(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-delete-invite?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	active := &domain.Invite{
		SecretDigest: "active-delete",
		Status:       domain.InviteStatusActive,
	}
	if err := repo.CreateInvite(t.Context(), active); err != nil {
		t.Fatalf("create active invite: %v", err)
	}
	if err := repo.DeleteInvite(t.Context(), active.ID); err != nil {
		t.Fatalf("delete active invite: %v", err)
	}
	if _, err := repo.GetInviteBySecretDigest(
		t.Context(),
		active.SecretDigest,
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("deleted active invite lookup error = %v", err)
	}

	consumed := &domain.Invite{
		SecretDigest: "consumed-survives-delete",
		Status:       domain.InviteStatusActive,
	}
	if err := repo.CreateInvite(t.Context(), consumed); err != nil {
		t.Fatalf("create consumed invite: %v", err)
	}
	if _, err := repo.ConsumeInviteAndCreateEnrollment(
		t.Context(),
		consumed.ID,
		&domain.Enrollment{
			StationPeerID:          "station-consumed",
			NodePeerID:             "node-consumed",
			StationRootPublicKey:   []byte{1, 2, 3},
			NodeAuthorizationEpoch: 1,
			NodeAuthorizationUntil: time.Now().UTC().Add(time.Hour),
			CredentialJTI:          "jti-consumed",
		},
		1,
	); err != nil {
		t.Fatalf("consume invite: %v", err)
	}
	if err := repo.DeleteInvite(
		t.Context(),
		consumed.ID,
	); !errors.Is(err, domain.ErrInviteAlreadyConsumed) {
		t.Fatalf("delete consumed invite error = %v", err)
	}
	persisted, err := repo.GetInviteBySecretDigest(
		t.Context(),
		consumed.SecretDigest,
	)
	if err != nil {
		t.Fatalf("load consumed invite after delete attempt: %v", err)
	}
	if persisted.Status != domain.InviteStatusConsumed ||
		persisted.ConsumedBy != "station-consumed" {
		t.Fatalf("consumed replay record was mutated: %+v", persisted)
	}
}

func TestDeleteAndConsumeInviteHaveOneWinner(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-delete-consume-race?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	for iteration := 0; iteration < 20; iteration++ {
		invite := &domain.Invite{
			SecretDigest: "race-" + time.Now().UTC().String(),
			Status:       domain.InviteStatusActive,
		}
		if err := repo.CreateInvite(t.Context(), invite); err != nil {
			t.Fatalf("create race invite %d: %v", iteration, err)
		}

		start := make(chan struct{})
		var wait sync.WaitGroup
		var deleteErr error
		var consumeErr error
		wait.Add(2)
		go func() {
			defer wait.Done()
			<-start
			deleteErr = repo.DeleteInvite(t.Context(), invite.ID)
		}()
		go func() {
			defer wait.Done()
			<-start
			_, consumeErr = repo.ConsumeInviteAndCreateEnrollment(
				t.Context(),
				invite.ID,
				&domain.Enrollment{
					StationPeerID:          "station-race",
					NodePeerID:             "node-race",
					StationRootPublicKey:   []byte{1, 2, 3},
					NodeAuthorizationEpoch: uint64(iteration + 1),
					NodeAuthorizationUntil: time.Now().UTC().Add(time.Hour),
					CredentialJTI:          "jti-race",
				},
				1,
			)
		}()
		close(start)
		wait.Wait()

		deleteWon := deleteErr == nil
		consumeWon := consumeErr == nil
		if deleteWon == consumeWon {
			t.Fatalf(
				"iteration %d winners delete=%v consume=%v",
				iteration,
				deleteErr,
				consumeErr,
			)
		}
		if !deleteWon &&
			!errors.Is(deleteErr, domain.ErrInviteAlreadyConsumed) {
			t.Fatalf("iteration %d delete error = %v", iteration, deleteErr)
		}
		if !consumeWon &&
			!errors.Is(consumeErr, domain.ErrInviteAlreadyConsumed) {
			t.Fatalf("iteration %d consume error = %v", iteration, consumeErr)
		}
	}
}

func TestEnrollmentIdentityIsStationAndNodeScoped(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-multi-node-enrollment?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	createEnrollment := func(
		stationPeerID,
		nodePeerID,
		digest string,
	) *domain.Enrollment {
		invite := &domain.Invite{
			SecretDigest: digest,
			Status:       domain.InviteStatusActive,
		}
		if err := repo.CreateInvite(t.Context(), invite); err != nil {
			t.Fatalf("create invite: %v", err)
		}
		enrollment, err := repo.ConsumeInviteAndCreateEnrollment(
			t.Context(),
			invite.ID,
			&domain.Enrollment{
				StationPeerID:          stationPeerID,
				NodePeerID:             nodePeerID,
				StationRootPublicKey:   []byte{1, 2, 3},
				NodeAuthorizationEpoch: 1,
				NodeAuthorizationUntil: time.Now().UTC().Add(time.Hour),
				CredentialJTI:          "jti-" + nodePeerID,
			},
			1,
		)
		if err != nil {
			t.Fatalf("activate %s: %v", nodePeerID, err)
		}
		return enrollment
	}

	first := createEnrollment("station-peer", "node-a", "digest-a")
	second := createEnrollment("station-peer", "node-b", "digest-b")
	if first.ID == second.ID {
		t.Fatal("two Station nodes shared one enrollment row")
	}
	if _, err := repo.GetEnrollment(
		t.Context(),
		"station-peer",
		"node-b",
	); err != nil {
		t.Fatalf("load second Station node: %v", err)
	}
	if _, err := repo.RevokeEnrollment(
		t.Context(),
		"station-peer",
		"node-a",
	); err != nil {
		t.Fatalf("revoke first Station node: %v", err)
	}
	remaining, err := repo.GetEnrollment(
		t.Context(),
		"station-peer",
		"node-b",
	)
	if err != nil {
		t.Fatalf("load remaining Station node: %v", err)
	}
	if remaining.Status == domain.EnrollmentStatusRevoked {
		t.Fatal("revoking one Station node revoked its sibling")
	}

	invite := &domain.Invite{
		SecretDigest: "digest-reused-node",
		Status:       domain.InviteStatusActive,
	}
	if err := repo.CreateInvite(t.Context(), invite); err != nil {
		t.Fatalf("create reused-node invite: %v", err)
	}
	if _, err := repo.ConsumeInviteAndCreateEnrollment(
		t.Context(),
		invite.ID,
		&domain.Enrollment{
			StationPeerID:          "other-station",
			NodePeerID:             "node-b",
			StationRootPublicKey:   []byte{4, 5, 6},
			NodeAuthorizationEpoch: 1,
			NodeAuthorizationUntil: time.Now().UTC().Add(time.Hour),
			CredentialJTI:          "jti-reused-node",
		},
		1,
	); err == nil {
		t.Fatal("one Node PeerID enrolled under two logical Stations")
	}
}

func TestRecoveryCASCommitsJTIAndMonotonicAuthorityTogether(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:relay-recovery-cas?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	until := time.Now().UTC().Add(time.Hour)
	row := enrollmentPO{StationPeerID: "station", NodePeerID: "node", Generation: 1,
		CredentialJTI: "old", NodeAuthorizationEpoch: 2, NodeAuthorizationUntil: until,
		Status: domain.EnrollmentStatusOffline}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	identity := domain.NodeIdentity{StationPeerID: row.StationPeerID, NodePeerID: row.NodePeerID,
		EnrollmentID: row.ID, Generation: row.Generation, JTI: row.CredentialJTI}
	if _, err := repo.RotateNodeCredential(t.Context(), identity, "regressed", 1, until); !errors.Is(err, domain.ErrNodeCredentialStale) {
		t.Fatalf("repository accepted epoch regression: %v", err)
	}
	start := make(chan struct{})
	type result struct {
		jti string
		err error
	}
	results := make(chan result, 2)
	expiries := map[string]time.Time{"a": until, "b": until.Add(-30 * time.Minute)}
	for jti, expiry := range expiries {
		go func(jti string, expiry time.Time) {
			<-start
			// Independent repository instances share no process mutex.
			_, err := NewGormRepo(db).RotateNodeCredential(t.Context(), identity, jti, 2, expiry)
			results <- result{jti, err}
		}(jti, expiry)
	}
	close(start)
	winner := ""
	for range expiries {
		outcome := <-results
		if outcome.err == nil {
			if winner != "" {
				t.Fatal("two recoveries committed")
			}
			winner = outcome.jti
		} else if !errors.Is(outcome.err, domain.ErrNodeCredentialStale) {
			t.Fatal(outcome.err)
		}
	}
	committed, err := repo.GetEnrollment(t.Context(), row.StationPeerID, row.NodePeerID)
	if err != nil || winner == "" || committed.CredentialJTI != winner ||
		committed.NodeAuthorizationEpoch != 2 || !committed.NodeAuthorizationUntil.Equal(expiries[winner]) {
		t.Fatalf("recovery CAS split authority: %+v winner=%s err=%v", committed, winner, err)
	}
}
