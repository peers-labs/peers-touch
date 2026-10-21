package operatorstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
)

func TestSQLiteStorePersistsSessionAndRevocationAcrossRestart(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "operator-auth.sqlite")
	recordKey := bytes.Repeat([]byte{0x41}, 32)
	now := time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)
	attempt := testAttempt("attempt-restart", now)
	assertionDigest := sha256.Sum256([]byte("assertion-restart"))
	session := testSession("session-restart", "token-restart", now)

	store := openSQLiteStore(t, databasePath, recordKey)
	if err := store.CreateAttempt(context.Background(), attempt); err != nil {
		t.Fatalf("create attempt: %v", err)
	}
	if _, err := store.FindAttempt(
		context.Background(),
		attempt.AttemptID,
		now,
	); err != nil {
		t.Fatalf("find attempt: %v", err)
	}
	if err := store.CompleteLogin(
		context.Background(),
		attempt.AttemptID,
		assertionDigest[:],
		session,
	); err != nil {
		t.Fatalf("complete login: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close first store: %v", err)
	}

	store = openSQLiteStore(t, databasePath, recordKey)
	if _, err := store.FindSession(
		context.Background(),
		session.TokenDigest,
		now.Add(time.Minute),
	); err != nil {
		t.Fatalf("session did not survive restart: %v", err)
	}
	if err := store.RevokeSession(
		context.Background(),
		session.TokenDigest,
		now.Add(2*time.Minute),
	); err != nil {
		t.Fatalf("revoke session: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close revoked store: %v", err)
	}

	store = openSQLiteStore(t, databasePath, recordKey)
	t.Cleanup(func() { _ = store.Close() })
	if _, err := store.FindSession(
		context.Background(),
		session.TokenDigest,
		now.Add(3*time.Minute),
	); !errors.Is(err, operator.ErrSessionRevoked) {
		t.Fatalf("revocation did not survive restart: %v", err)
	}
	if _, err := store.FindAttempt(
		context.Background(),
		attempt.AttemptID,
		now.Add(3*time.Minute),
	); !errors.Is(err, operator.ErrAttemptConsumed) {
		t.Fatalf("attempt replay was not rejected: %v", err)
	}

	secondAttempt := testAttempt("attempt-assertion-replay", now)
	if err := store.CreateAttempt(
		context.Background(),
		secondAttempt,
	); err != nil {
		t.Fatalf("create replay attempt: %v", err)
	}
	secondSession := testSession("session-replay", "token-replay", now)
	if err := store.CompleteLogin(
		context.Background(),
		secondAttempt.AttemptID,
		assertionDigest[:],
		secondSession,
	); !errors.Is(err, operator.ErrAssertionReplay) {
		t.Fatalf("assertion replay was not rejected: %v", err)
	}
}

func TestSQLiteStoreCompleteLoginHasOneConcurrentWinner(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "operator-auth.sqlite")
	store := openSQLiteStore(
		t,
		databasePath,
		bytes.Repeat([]byte{0x42}, 32),
	)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 10, 20, 11, 0, 0, 0, time.UTC)
	attempt := testAttempt("attempt-concurrent", now)
	if err := store.CreateAttempt(context.Background(), attempt); err != nil {
		t.Fatalf("create attempt: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for index := 0; index < 2; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			assertionDigest := sha256.Sum256(
				[]byte{byte(index + 1)},
			)
			results <- store.CompleteLogin(
				context.Background(),
				attempt.AttemptID,
				assertionDigest[:],
				testSession(
					"session-concurrent-"+string(rune('a'+index)),
					"token-concurrent-"+string(rune('a'+index)),
					now,
				),
			)
		}(index)
	}
	close(start)
	wait.Wait()
	close(results)

	successes := 0
	consumed := 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, operator.ErrAttemptConsumed):
			consumed++
		default:
			t.Fatalf("unexpected concurrent completion result: %v", err)
		}
	}
	if successes != 1 || consumed != 1 {
		t.Fatalf(
			"concurrent completion results successes=%d consumed=%d",
			successes,
			consumed,
		)
	}
}

func TestSQLiteStoreFailsClosedForPermissionsSchemaCorruptionAndLock(
	t *testing.T,
) {
	t.Run("insecure directory", func(t *testing.T) {
		directory := t.TempDir()
		if err := os.Chmod(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		if _, err := NewSQLiteStore(
			filepath.Join(directory, "operator-auth.sqlite"),
			bytes.Repeat([]byte{0x43}, 32),
		); err == nil {
			t.Fatal("insecure operator directory was accepted")
		}
	})

	t.Run("unsupported schema", func(t *testing.T) {
		databasePath := filepath.Join(t.TempDir(), "operator-auth.sqlite")
		if err := os.Chmod(filepath.Dir(databasePath), 0o700); err != nil {
			t.Fatal(err)
		}
		database, err := sql.Open("sqlite", databasePath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.Exec("PRAGMA user_version = 99"); err != nil {
			t.Fatal(err)
		}
		if err := database.Close(); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(databasePath, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := NewSQLiteStore(
			databasePath,
			bytes.Repeat([]byte{0x44}, 32),
		); err == nil {
			t.Fatal("unsupported operator schema was accepted")
		}
	})

	t.Run("symlink database", func(t *testing.T) {
		directory := t.TempDir()
		if err := os.Chmod(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(directory, "target.sqlite")
		if err := os.WriteFile(target, nil, 0o600); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(directory, "operator-auth.sqlite")
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
		if _, err := NewSQLiteStore(
			link,
			bytes.Repeat([]byte{0x44}, 32),
		); err == nil {
			t.Fatal("symlink operator database was accepted")
		}
	})

	t.Run("corrupt encrypted record", func(t *testing.T) {
		databasePath := filepath.Join(t.TempDir(), "operator-auth.sqlite")
		store := openSQLiteStore(
			t,
			databasePath,
			bytes.Repeat([]byte{0x45}, 32),
		)
		t.Cleanup(func() { _ = store.Close() })
		now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
		attempt := testAttempt("attempt-corrupt", now)
		if err := store.CreateAttempt(
			context.Background(),
			attempt,
		); err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.Exec(
			`UPDATE operator_login_attempts SET payload = ?
			 WHERE attempt_digest = ?`,
			[]byte("not-an-envelope"),
			attemptKey(attempt.AttemptID),
		); err != nil {
			t.Fatal(err)
		}
		if _, err := store.FindAttempt(
			context.Background(),
			attempt.AttemptID,
			now,
		); !errors.Is(err, operator.ErrCorrupt) {
			t.Fatalf("corrupt attempt did not fail closed: %v", err)
		}
	})

	t.Run("writer lock", func(t *testing.T) {
		databasePath := filepath.Join(t.TempDir(), "operator-auth.sqlite")
		store := openSQLiteStore(
			t,
			databasePath,
			bytes.Repeat([]byte{0x46}, 32),
		)
		t.Cleanup(func() { _ = store.Close() })
		locker, err := sql.Open("sqlite", databasePath)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = locker.Close() })
		if _, err := locker.Exec("BEGIN IMMEDIATE"); err != nil {
			t.Fatal(err)
		}
		defer func() { _, _ = locker.Exec("ROLLBACK") }()
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		err = store.CreateAttempt(
			ctx,
			testAttempt(
				"attempt-locked",
				time.Date(2026, 10, 20, 13, 0, 0, 0, time.UTC),
			),
		)
		if !errors.Is(err, operator.ErrUnavailable) {
			t.Fatalf("locked operator store returned %v", err)
		}
	})
}

func TestSQLiteStoreEmptyRecreationInvalidatesPriorSession(t *testing.T) {
	directory := t.TempDir()
	databasePath := filepath.Join(directory, "operator-auth.sqlite")
	recordKey := bytes.Repeat([]byte{0x47}, 32)
	now := time.Date(2026, 10, 20, 14, 0, 0, 0, time.UTC)
	store := openSQLiteStore(t, databasePath, recordKey)
	attempt := testAttempt("attempt-recreate", now)
	assertionDigest := sha256.Sum256([]byte("assertion-recreate"))
	session := testSession("session-recreate", "token-recreate", now)
	if err := store.CreateAttempt(context.Background(), attempt); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteLogin(
		context.Background(),
		attempt.AttemptID,
		assertionDigest[:],
		session,
	); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Remove(databasePath + suffix); err != nil &&
			!errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
	}
	store = openSQLiteStore(t, databasePath, recordKey)
	t.Cleanup(func() { _ = store.Close() })
	if _, err := store.FindSession(
		context.Background(),
		session.TokenDigest,
		now.Add(time.Minute),
	); !errors.Is(err, operator.ErrSessionNotFound) {
		t.Fatalf("recreated store retained prior session: %v", err)
	}
}

func openSQLiteStore(
	t *testing.T,
	databasePath string,
	recordKey []byte,
) *SQLiteStore {
	t.Helper()
	if err := os.Chmod(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatalf("secure sqlite directory: %v", err)
	}
	store, err := NewSQLiteStore(databasePath, recordKey)
	if err != nil {
		t.Fatalf("open sqlite operator store: %v", err)
	}
	return store
}

func testAttempt(id string, now time.Time) operator.LoginAttempt {
	return operator.LoginAttempt{
		SchemaVersion:    1,
		AttemptID:        id,
		ReceiverVerifier: bytes.Repeat([]byte{0x51}, 32),
		CreatedAt:        now.UTC(),
		ExpiresAt:        now.UTC().Add(10 * time.Minute),
	}
}

func testSession(id string, token string, now time.Time) operator.Session {
	tokenDigest := sha256.Sum256([]byte(token))
	csrfDigest := sha256.Sum256([]byte("csrf-" + token))
	return operator.Session{
		SchemaVersion:   1,
		SessionID:       id,
		TokenDigest:     tokenDigest[:],
		CSRFDigest:      csrfDigest[:],
		Provider:        "github",
		ProviderSubject: "subject-42",
		AssertionID:     "assertion-" + id,
		IssuedAt:        now.UTC(),
		ExpiresAt:       now.UTC().Add(time.Hour),
	}
}
