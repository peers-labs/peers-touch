package operatorstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
	_ "modernc.org/sqlite"
)

const (
	sqliteSchemaVersion = 1
	sqliteBusyTimeoutMS = int64(2000)
	sqliteOpenTimeout   = 5 * time.Second
	terminalRetention   = 24 * time.Hour

	attemptRecordDomain   = "peers-touch/x-config/operator-attempt/v1\x00"
	assertionRecordDomain = "peers-touch/x-config/operator-assertion/v1\x00"
	sessionRecordDomain   = "peers-touch/x-config/operator-session/v1\x00"
)

type SQLiteStore struct {
	db    *sql.DB
	codec *recordCodec
}

type assertionConsumption struct {
	SchemaVersion   int       `json:"schema_version"`
	AssertionDigest []byte    `json:"assertion_digest"`
	SessionID       string    `json:"session_id"`
	ConsumedAt      time.Time `json:"consumed_at"`
}

func NewSQLiteStore(
	databasePath string,
	recordKey []byte,
) (*SQLiteStore, error) {
	databasePath = filepath.Clean(strings.TrimSpace(databasePath))
	if databasePath == "." || !filepath.IsAbs(databasePath) {
		return nil, errors.New("invalid_operator_sqlite_path")
	}
	parent := filepath.Dir(databasePath)
	parentInfo, err := os.Lstat(parent)
	if err != nil ||
		parentInfo.Mode()&os.ModeSymlink != 0 ||
		!parentInfo.IsDir() ||
		parentInfo.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("invalid_operator_sqlite_directory")
	}
	if info, statErr := os.Lstat(databasePath); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 ||
			!info.Mode().IsRegular() ||
			info.Mode().Perm()&0o077 != 0 {
			return nil, errors.New("invalid_operator_sqlite_permissions")
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, errors.New("operator_store_unavailable")
	}
	codec, err := newRecordCodec(recordKey)
	if err != nil {
		return nil, err
	}
	dsn := (&url.URL{
		Scheme: "file",
		Path:   databasePath,
		RawQuery: url.Values{
			"_pragma": []string{
				"busy_timeout(" +
					strconv.FormatInt(sqliteBusyTimeoutMS, 10) +
					")",
				"foreign_keys(ON)",
				"journal_mode(WAL)",
				"synchronous(FULL)",
			},
			"_txlock": []string{"immediate"},
		}.Encode(),
	}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, errors.New("operator_store_unavailable")
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), sqliteOpenTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, errors.New("operator_store_unavailable")
	}
	if err := os.Chmod(databasePath, 0o600); err != nil {
		_ = db.Close()
		return nil, errors.New("invalid_operator_sqlite_permissions")
	}
	store := &SQLiteStore{db: db, codec: codec}
	if err := store.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *SQLiteStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *SQLiteStore) CreateAttempt(
	ctx context.Context,
	attempt operator.LoginAttempt,
) error {
	if !validAttempt(attempt) {
		return operator.ErrCorrupt
	}
	if err := s.cleanup(ctx, attempt.CreatedAt.UTC()); err != nil {
		return err
	}
	key := attemptKey(attempt.AttemptID)
	payload, err := s.codec.encrypt(attemptAAD(key), attempt)
	if err != nil {
		return operator.ErrUnavailable
	}
	result, err := s.db.ExecContext(
		ctx,
		`INSERT INTO operator_login_attempts
			(attempt_digest, payload, expires_at_ms, consumed_at_ms)
		 VALUES (?, ?, ?, NULL)
		 ON CONFLICT(attempt_digest) DO NOTHING`,
		key,
		payload,
		attempt.ExpiresAt.UTC().UnixMilli(),
	)
	if err != nil {
		return operator.ErrUnavailable
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return operator.ErrUnavailable
	}
	if rows == 1 {
		return nil
	}
	existing, err := s.readAttempt(ctx, s.db, key)
	if err != nil {
		return err
	}
	if sameAttempt(*existing, attempt) {
		return nil
	}
	return operator.ErrAttemptExists
}

func (s *SQLiteStore) FindAttempt(
	ctx context.Context,
	attemptID string,
	now time.Time,
) (*operator.LoginAttempt, error) {
	key := attemptKey(attemptID)
	attempt, err := s.readAttempt(ctx, s.db, key)
	if err != nil {
		return nil, err
	}
	if attempt.AttemptID != attemptID {
		return nil, operator.ErrCorrupt
	}
	if attempt.ConsumedAt != nil {
		return nil, operator.ErrAttemptConsumed
	}
	if !now.UTC().Before(attempt.ExpiresAt) {
		return nil, operator.ErrAttemptExpired
	}
	return cloneAttempt(*attempt), nil
}

func (s *SQLiteStore) CompleteLogin(
	ctx context.Context,
	attemptID string,
	assertionDigest []byte,
	session operator.Session,
) error {
	if attemptID == "" ||
		len(assertionDigest) != sha256.Size ||
		!validSession(session) {
		return operator.ErrCorrupt
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return operator.ErrUnavailable
	}
	defer func() { _ = tx.Rollback() }()

	attemptKey := attemptKey(attemptID)
	attempt, err := s.readAttempt(ctx, tx, attemptKey)
	if err != nil {
		return err
	}
	if attempt.AttemptID != attemptID {
		return operator.ErrCorrupt
	}
	if attempt.ConsumedAt != nil {
		return operator.ErrAttemptConsumed
	}
	if !session.IssuedAt.UTC().Before(attempt.ExpiresAt) {
		return operator.ErrAttemptExpired
	}

	assertionKey := digestKey(assertionDigest)
	var marker int
	switch err := tx.QueryRowContext(
		ctx,
		`SELECT 1 FROM operator_assertion_consumptions
		 WHERE assertion_digest = ?`,
		assertionKey,
	).Scan(&marker); {
	case err == nil:
		return operator.ErrAssertionReplay
	case errors.Is(err, sql.ErrNoRows):
	default:
		return operator.ErrUnavailable
	}

	sessionKey := digestKey(session.TokenDigest)
	var existingSessionID string
	switch err := tx.QueryRowContext(
		ctx,
		`SELECT session_id FROM operator_sessions WHERE token_digest = ?`,
		sessionKey,
	).Scan(&existingSessionID); {
	case err == nil:
		if existingSessionID == session.SessionID {
			return operator.ErrAttemptConsumed
		}
		return operator.ErrConflict
	case errors.Is(err, sql.ErrNoRows):
	default:
		return operator.ErrUnavailable
	}

	consumedAt := session.IssuedAt.UTC()
	attempt.ConsumedAt = &consumedAt
	attemptPayload, err := s.codec.encrypt(attemptAAD(attemptKey), attempt)
	if err != nil {
		return operator.ErrUnavailable
	}
	result, err := tx.ExecContext(
		ctx,
		`UPDATE operator_login_attempts
		 SET payload = ?, consumed_at_ms = ?
		 WHERE attempt_digest = ? AND consumed_at_ms IS NULL`,
		attemptPayload,
		consumedAt.UnixMilli(),
		attemptKey,
	)
	if err != nil {
		return operator.ErrUnavailable
	}
	if rows, rowErr := result.RowsAffected(); rowErr != nil {
		return operator.ErrUnavailable
	} else if rows != 1 {
		return operator.ErrAttemptConsumed
	}

	consumption := assertionConsumption{
		SchemaVersion:   1,
		AssertionDigest: append([]byte(nil), assertionDigest...),
		SessionID:       session.SessionID,
		ConsumedAt:      consumedAt,
	}
	assertionPayload, err := s.codec.encrypt(
		assertionAAD(assertionKey),
		consumption,
	)
	if err != nil {
		return operator.ErrUnavailable
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO operator_assertion_consumptions
			(assertion_digest, session_id, payload, consumed_at_ms)
		 VALUES (?, ?, ?, ?)`,
		assertionKey,
		session.SessionID,
		assertionPayload,
		consumedAt.UnixMilli(),
	); err != nil {
		return operator.ErrUnavailable
	}

	sessionPayload, err := s.codec.encrypt(sessionAAD(sessionKey), session)
	if err != nil {
		return operator.ErrUnavailable
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO operator_sessions
			(token_digest, session_id, payload, expires_at_ms, revoked_at_ms)
		 VALUES (?, ?, ?, ?, NULL)`,
		sessionKey,
		session.SessionID,
		sessionPayload,
		session.ExpiresAt.UTC().UnixMilli(),
	); err != nil {
		return operator.ErrUnavailable
	}
	if err := tx.Commit(); err != nil {
		return operator.ErrUnavailable
	}
	return nil
}

func (s *SQLiteStore) FindSession(
	ctx context.Context,
	tokenDigest []byte,
	now time.Time,
) (*operator.Session, error) {
	if len(tokenDigest) != sha256.Size {
		return nil, operator.ErrCorrupt
	}
	key := digestKey(tokenDigest)
	var payload []byte
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT payload FROM operator_sessions WHERE token_digest = ?`,
		key,
	).Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, operator.ErrSessionNotFound
		}
		return nil, operator.ErrUnavailable
	}
	session, err := s.decodeSession(key, payload, tokenDigest)
	if err != nil {
		return nil, err
	}
	if session.RevokedAt != nil {
		return nil, operator.ErrSessionRevoked
	}
	if !now.UTC().Before(session.ExpiresAt) {
		return nil, operator.ErrSessionExpired
	}
	out := cloneSessionValue(*session)
	return &out, nil
}

func (s *SQLiteStore) RevokeSession(
	ctx context.Context,
	tokenDigest []byte,
	now time.Time,
) error {
	if len(tokenDigest) != sha256.Size {
		return operator.ErrCorrupt
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return operator.ErrUnavailable
	}
	defer func() { _ = tx.Rollback() }()
	key := digestKey(tokenDigest)
	var payload []byte
	if err := tx.QueryRowContext(
		ctx,
		`SELECT payload FROM operator_sessions WHERE token_digest = ?`,
		key,
	).Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return operator.ErrSessionNotFound
		}
		return operator.ErrUnavailable
	}
	session, err := s.decodeSession(key, payload, tokenDigest)
	if err != nil {
		return err
	}
	if session.RevokedAt != nil {
		return nil
	}
	revokedAt := now.UTC()
	session.RevokedAt = &revokedAt
	encoded, err := s.codec.encrypt(sessionAAD(key), session)
	if err != nil {
		return operator.ErrUnavailable
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE operator_sessions
		 SET payload = ?, revoked_at_ms = ?
		 WHERE token_digest = ? AND revoked_at_ms IS NULL`,
		encoded,
		revokedAt.UnixMilli(),
		key,
	); err != nil {
		return operator.ErrUnavailable
	}
	if err := tx.Commit(); err != nil {
		return operator.ErrUnavailable
	}
	return nil
}

func (s *SQLiteStore) migrate(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return errors.New("operator_store_unavailable")
	}
	switch version {
	case 0:
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return errors.New("operator_store_unavailable")
		}
		defer func() { _ = tx.Rollback() }()
		for _, statement := range []string{
			`CREATE TABLE operator_login_attempts (
				attempt_digest TEXT PRIMARY KEY,
				payload BLOB NOT NULL,
				expires_at_ms INTEGER NOT NULL,
				consumed_at_ms INTEGER
			) STRICT`,
			`CREATE TABLE operator_assertion_consumptions (
				assertion_digest TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				payload BLOB NOT NULL,
				consumed_at_ms INTEGER NOT NULL
			) STRICT`,
			`CREATE TABLE operator_sessions (
				token_digest TEXT PRIMARY KEY,
				session_id TEXT NOT NULL UNIQUE,
				payload BLOB NOT NULL,
				expires_at_ms INTEGER NOT NULL,
				revoked_at_ms INTEGER
			) STRICT`,
			`CREATE INDEX operator_attempt_expiry
			 ON operator_login_attempts(expires_at_ms)`,
			`CREATE INDEX operator_assertion_consumed
			 ON operator_assertion_consumptions(consumed_at_ms)`,
			`CREATE INDEX operator_session_expiry
			 ON operator_sessions(expires_at_ms)`,
			`PRAGMA user_version = 1`,
		} {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return errors.New("operator_store_unavailable")
			}
		}
		if err := tx.Commit(); err != nil {
			return errors.New("operator_store_unavailable")
		}
	case sqliteSchemaVersion:
	default:
		return errors.New("unsupported_operator_store_schema")
	}
	for _, query := range []string{
		`SELECT attempt_digest, payload, expires_at_ms, consumed_at_ms
		 FROM operator_login_attempts LIMIT 0`,
		`SELECT assertion_digest, session_id, payload, consumed_at_ms
		 FROM operator_assertion_consumptions LIMIT 0`,
		`SELECT token_digest, session_id, payload, expires_at_ms, revoked_at_ms
		 FROM operator_sessions LIMIT 0`,
	} {
		rows, err := s.db.QueryContext(ctx, query)
		if err != nil {
			return errors.New("operator_store_corrupt")
		}
		_ = rows.Close()
	}
	var quickCheck string
	if err := s.db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&quickCheck); err != nil ||
		quickCheck != "ok" {
		return errors.New("operator_store_corrupt")
	}
	return nil
}

func (s *SQLiteStore) cleanup(ctx context.Context, now time.Time) error {
	cutoff := now.UTC().Add(-terminalRetention).UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return operator.ErrUnavailable
	}
	defer func() { _ = tx.Rollback() }()
	for _, statement := range []string{
		`DELETE FROM operator_login_attempts
		 WHERE expires_at_ms < ?`,
		`DELETE FROM operator_assertion_consumptions
		 WHERE consumed_at_ms < ?`,
		`DELETE FROM operator_sessions
		 WHERE expires_at_ms < ?`,
	} {
		if _, err := tx.ExecContext(ctx, statement, cutoff); err != nil {
			return operator.ErrUnavailable
		}
	}
	if err := tx.Commit(); err != nil {
		return operator.ErrUnavailable
	}
	return nil
}

type queryRower interface {
	QueryRowContext(
		ctx context.Context,
		query string,
		args ...any,
	) *sql.Row
}

func (s *SQLiteStore) readAttempt(
	ctx context.Context,
	query queryRower,
	key string,
) (*operator.LoginAttempt, error) {
	var payload []byte
	if err := query.QueryRowContext(
		ctx,
		`SELECT payload FROM operator_login_attempts
		 WHERE attempt_digest = ?`,
		key,
	).Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, operator.ErrAttemptNotFound
		}
		return nil, operator.ErrUnavailable
	}
	var attempt operator.LoginAttempt
	if err := s.codec.decrypt(attemptAAD(key), payload, &attempt); err != nil ||
		!validAttempt(attempt) ||
		attemptKey(attempt.AttemptID) != key {
		return nil, operator.ErrCorrupt
	}
	return &attempt, nil
}

func (s *SQLiteStore) decodeSession(
	key string,
	payload []byte,
	tokenDigest []byte,
) (*operator.Session, error) {
	var session operator.Session
	if err := s.codec.decrypt(sessionAAD(key), payload, &session); err != nil ||
		!validSession(session) ||
		!bytes.Equal(session.TokenDigest, tokenDigest) {
		return nil, operator.ErrCorrupt
	}
	return &session, nil
}

func attemptKey(attemptID string) string {
	digest := sha256.Sum256([]byte(attemptID))
	return hex.EncodeToString(digest[:])
}

func digestKey(digest []byte) string {
	return hex.EncodeToString(digest)
}

func attemptAAD(key string) string {
	return attemptRecordDomain + key
}

func assertionAAD(key string) string {
	return assertionRecordDomain + key
}

func sessionAAD(key string) string {
	return sessionRecordDomain + key
}
