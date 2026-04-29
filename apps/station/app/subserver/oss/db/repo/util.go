// Package repo — small helpers shared across repo implementations.
//
// We deliberately keep these helpers portable across the two
// supported gorm dialects (postgres via pgx/v5, sqlite via
// mattn/go-sqlite3) so that tests can stay on sqlite while production
// runs postgres.
package repo

import (
	"errors"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/oklog/ulid/v2"
)

var (
	ulidEntropy   ulid.MonotonicReader
	ulidEntropyMu sync.Mutex
)

func init() {
	// `ulid.Make` works fine for one-off use, but the bootstrap
	// path generates many ULIDs in a tight loop and a shared
	// monotonic reader gives us strict ordering — useful when
	// debugging migration flakes by raw timestamp.
	src := rand.New(rand.NewSource(time.Now().UnixNano())) //nolint:gosec // bootstrap, not security-sensitive
	ulidEntropy = ulid.Monotonic(src, 0)
}

// newULID returns a 26-char ULID string anchored at the given clock.
// Falls back to a fresh random ULID if the monotonic reader hits its
// rare overflow.
func newULID(now time.Time) string {
	ulidEntropyMu.Lock()
	defer ulidEntropyMu.Unlock()
	id, err := ulid.New(ulid.Timestamp(now), ulidEntropy)
	if err != nil {
		return ulid.Make().String()
	}
	return id.String()
}

// isUniqueViolation tests whether err is a unique-constraint
// violation, regardless of the underlying gorm dialect.
//
//   - Postgres: pgconn.PgError with SQLSTATE class 23 ("integrity
//     constraint violation"); we narrow to 23505 ("unique_violation").
//   - SQLite:   the driver wraps the SQLITE_CONSTRAINT_UNIQUE error
//     into a generic Go error whose message starts with
//     "UNIQUE constraint failed".
//
// We do not import the sqlite driver package here to avoid coupling
// — string match is sufficient since this branch is only ever taken
// in tests.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return true
	}
	if strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return true
	}
	return false
}
