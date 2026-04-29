package federation

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// PeerKey is the cached public key of a *remote* station, used
// by Verify to confirm an inbound peer JWT was signed by the
// claimed issuer.
//
// Trust model: TOFU on first sighting; strict on every
// subsequent token. A kid mismatch is ALWAYS a hard reject —
// pinned or not. Operators who legitimately need to follow a
// peer's key rotation must explicitly Forget the row first; the
// next inbound token then re-TOFUs the new kid. This makes "the
// peer's key changed" a deliberate operator decision rather than
// something the verifier can do silently.
//
// `Pinned` is the upgrade path to operator-managed trust: a
// dashboard endpoint flips it from false → true, after which
// the rejection error is `ErrPinnedKeyMismatch` rather than
// `ErrPeerKeyMismatch`. Both rejections are equally hard; the
// distinction exists for audit clarity.
type PeerKey struct {
	StationID     string
	Kid           string
	PubPEM        string
	FirstSeenAt   time.Time
	LastSeenAt    time.Time
	Pinned        bool
	PinnedByActor string
	PinnedAt      *time.Time
}

// PeerKeyTable is the canonical name of the framework's TOFU
// cache table. Owned by `auth/federation`; no other package
// should AutoMigrate it.
const PeerKeyTable = "auth_peer_keys"

// PeerKeyRow is the GORM model. Field shapes were lifted from
// the legacy `oss_peer_keys` so a future "rename only" migration
// is a SQL-level operation, not a code-level one.
type PeerKeyRow struct {
	StationID     string     `gorm:"primaryKey;type:varchar(255)"`
	Kid           string     `gorm:"type:varchar(64);not null;index"`
	PubPEM        string     `gorm:"type:text;not null"`
	FirstSeenAt   time.Time  `gorm:"not null"`
	LastSeenAt    time.Time  `gorm:"not null;index"`
	Pinned        bool       `gorm:"not null;default:false"`
	PinnedByActor string     `gorm:"type:varchar(255);index"`
	PinnedAt      *time.Time `gorm:""`
}

func (PeerKeyRow) TableName() string { return PeerKeyTable }

// Sentinel errors for the verifier path. `errors.Is` is the
// canonical way to branch on them.
var (
	// ErrPeerKeyMismatch fires when an UNPINNED row exists
	// and the new token's kid disagrees with the cached one.
	// The verifier rejects rather than silently re-TOFUing.
	ErrPeerKeyMismatch = errors.New("federation: peer key mismatch (TOFU)")

	// ErrPinnedKeyMismatch fires when a PINNED row exists and
	// the new token's kid disagrees. Operator must Forget the
	// row to allow re-pairing. Distinct from ErrPeerKeyMismatch
	// so audit + dashboard surfaces can highlight a pinned
	// rejection separately.
	ErrPinnedKeyMismatch = errors.New("federation: peer key mismatch (pinned)")
)

// PeerKeyStore is the persistence contract for the TOFU cache.
// Designed for the verifier hot path: every method takes
// context.Context, every method returns typed errors so the
// verifier can build precise audit lines without string-matching.
type PeerKeyStore interface {
	// Get returns the cached row for `stationID`, or
	// (nil, nil) when the peer has never been seen.
	Get(ctx context.Context, stationID string) (*PeerKey, error)

	// UpsertTOFU writes a fresh row when none exists; on an
	// existing row, advances LastSeenAt iff the kid matches,
	// otherwise returns ErrPeerKeyMismatch (or
	// ErrPinnedKeyMismatch). The Pinned/PinnedBy/PinnedAt
	// columns on the input row are ignored — pinning happens
	// through Pin / Unpin only.
	UpsertTOFU(ctx context.Context, in PeerKey) error

	// TouchLastSeen advances last_seen_at on a successful
	// verify. Best-effort: failure does not propagate so a slow
	// KV write can never deny a federated request. Called on the
	// verify hot path.
	TouchLastSeen(ctx context.Context, stationID string, ts time.Time)

	// List returns every cached peer, ordered by station_id
	// ascending. Used by the dashboard's federation peers
	// surface. Not on the hot path.
	List(ctx context.Context) ([]PeerKey, error)

	// Pin marks the row as operator-trusted. Returns ErrUnknownPeer
	// when the row is absent so the dashboard can surface a
	// useful message instead of silently no-oping.
	Pin(ctx context.Context, stationID, byActor string, at time.Time) error

	// Unpin reverses Pin. Idempotent: unpinning an already-
	// unpinned row succeeds silently.
	Unpin(ctx context.Context, stationID string) error

	// Forget removes the row entirely. Used by operators to
	// allow a re-TOFU after a peer's intentional key rotation.
	// Returns the deleted-row count for audit; 0 means "wasn't
	// there".
	Forget(ctx context.Context, stationID string) (int64, error)

	// DeleteUnpinnedOlderThan removes peer-key rows where
	// `pinned = false` AND `last_seen_at < olderThan`. Called
	// by the trim worker. Pinned rows are NEVER trimmed —
	// dropping an operator-managed trust row silently would
	// invalidate the trust decision. Returns the row count
	// actually removed so the worker can surface a heartbeat.
	DeleteUnpinnedOlderThan(ctx context.Context, olderThan time.Time) (int64, error)
}

// ErrUnknownPeer is returned by Pin when no row matches.
var ErrUnknownPeer = errors.New("federation: peer key: unknown station")

// ---- GORM implementation ----------------------------------------------------

type gormPeerKeyStore struct {
	dbName string
	db     *gorm.DB
	clock  func() time.Time
}

// NewPeerKeyStoreGORM returns a store that resolves *gorm.DB
// lazily via the framework's injected store on every call.
func NewPeerKeyStoreGORM(dbName string) PeerKeyStore {
	return &gormPeerKeyStore{dbName: dbName, clock: time.Now}
}

// NewPeerKeyStoreGORMWithDB binds the store to a specific
// *gorm.DB. Tests + advanced wiring use this.
func NewPeerKeyStoreGORMWithDB(db *gorm.DB) PeerKeyStore {
	return &gormPeerKeyStore{db: db, clock: time.Now}
}

func (s *gormPeerKeyStore) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
	if err != nil {
		return nil, fmt.Errorf("federation: peerkeystore: db lookup %q: %w", s.dbName, err)
	}
	return db, nil
}

func (s *gormPeerKeyStore) Get(ctx context.Context, stationID string) (*PeerKey, error) {
	if stationID == "" {
		return nil, errors.New("federation: peerkeystore: Get: empty station id")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row PeerKeyRow
	err = db.Where("station_id = ?", stationID).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return rowToPeerKey(row), nil
}

func (s *gormPeerKeyStore) UpsertTOFU(ctx context.Context, in PeerKey) error {
	if in.StationID == "" || in.Kid == "" || in.PubPEM == "" {
		return errors.New("federation: peerkeystore: UpsertTOFU: missing fields")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	now := s.clock()
	if in.FirstSeenAt.IsZero() {
		in.FirstSeenAt = now
	}
	if in.LastSeenAt.IsZero() {
		in.LastSeenAt = now
	}
	var existing PeerKeyRow
	err = db.Where("station_id = ?", in.StationID).First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			row := PeerKeyRow{
				StationID:   in.StationID,
				Kid:         in.Kid,
				PubPEM:      in.PubPEM,
				FirstSeenAt: in.FirstSeenAt,
				LastSeenAt:  in.LastSeenAt,
			}
			return db.Create(&row).Error
		}
		return err
	}
	if existing.Kid != in.Kid {
		if existing.Pinned {
			return ErrPinnedKeyMismatch
		}
		return ErrPeerKeyMismatch
	}
	return db.Model(&PeerKeyRow{}).
		Where("station_id = ?", in.StationID).
		Update("last_seen_at", now).Error
}

func (s *gormPeerKeyStore) TouchLastSeen(ctx context.Context, stationID string, ts time.Time) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}
	_ = db.Model(&PeerKeyRow{}).
		Where("station_id = ?", stationID).
		Update("last_seen_at", ts).Error
}

func (s *gormPeerKeyStore) List(ctx context.Context) ([]PeerKey, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []PeerKeyRow
	if err := db.Order("station_id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]PeerKey, 0, len(rows))
	for _, r := range rows {
		out = append(out, *rowToPeerKey(r))
	}
	return out, nil
}

func (s *gormPeerKeyStore) Pin(ctx context.Context, stationID, byActor string, at time.Time) error {
	if stationID == "" {
		return errors.New("federation: peerkeystore: Pin: empty station id")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	pinnedAt := at
	res := db.Model(&PeerKeyRow{}).
		Where("station_id = ?", stationID).
		Updates(map[string]any{
			"pinned":          true,
			"pinned_by_actor": byActor,
			"pinned_at":       pinnedAt,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrUnknownPeer
	}
	return nil
}

func (s *gormPeerKeyStore) Unpin(ctx context.Context, stationID string) error {
	if stationID == "" {
		return errors.New("federation: peerkeystore: Unpin: empty station id")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.Model(&PeerKeyRow{}).
		Where("station_id = ?", stationID).
		Updates(map[string]any{
			"pinned":          false,
			"pinned_by_actor": "",
			"pinned_at":       nil,
		}).Error
}

func (s *gormPeerKeyStore) Forget(ctx context.Context, stationID string) (int64, error) {
	if stationID == "" {
		return 0, errors.New("federation: peerkeystore: Forget: empty station id")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	res := db.Where("station_id = ?", stationID).Delete(&PeerKeyRow{})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

func (s *gormPeerKeyStore) DeleteUnpinnedOlderThan(ctx context.Context, olderThan time.Time) (int64, error) {
	if olderThan.IsZero() {
		return 0, nil
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	res := db.Where("pinned = ? AND last_seen_at < ?", false, olderThan).
		Delete(&PeerKeyRow{})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

func rowToPeerKey(r PeerKeyRow) *PeerKey {
	return &PeerKey{
		StationID:     r.StationID,
		Kid:           r.Kid,
		PubPEM:        r.PubPEM,
		FirstSeenAt:   r.FirstSeenAt,
		LastSeenAt:    r.LastSeenAt,
		Pinned:        r.Pinned,
		PinnedByActor: r.PinnedByActor,
		PinnedAt:      r.PinnedAt,
	}
}

// ---- InMemoryPeerKeyStore --------------------------------------------------

// InMemoryPeerKeyStore is a RAM-only PeerKeyStore for tests and
// ephemeral deployments. Same semantic contract as the GORM impl.
type InMemoryPeerKeyStore struct {
	mu    sync.RWMutex
	rows  map[string]*PeerKey
	clock func() time.Time
}

// NewInMemoryPeerKeyStore returns an empty in-memory store.
func NewInMemoryPeerKeyStore(opts ...InMemoryPeerKeyOption) *InMemoryPeerKeyStore {
	s := &InMemoryPeerKeyStore{rows: map[string]*PeerKey{}, clock: time.Now}
	for _, o := range opts {
		o(s)
	}
	return s
}

// InMemoryPeerKeyOption mirrors the keystore options shape.
type InMemoryPeerKeyOption func(*InMemoryPeerKeyStore)

// WithMemoryPeerClock overrides the in-memory store's clock.
func WithMemoryPeerClock(fn func() time.Time) InMemoryPeerKeyOption {
	return func(s *InMemoryPeerKeyStore) { s.clock = fn }
}

func (s *InMemoryPeerKeyStore) Get(ctx context.Context, stationID string) (*PeerKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	row, ok := s.rows[stationID]
	if !ok {
		return nil, nil
	}
	cp := *row
	return &cp, nil
}

func (s *InMemoryPeerKeyStore) UpsertTOFU(ctx context.Context, in PeerKey) error {
	if in.StationID == "" || in.Kid == "" || in.PubPEM == "" {
		return errors.New("federation: mempeerkeystore: missing fields")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	if in.FirstSeenAt.IsZero() {
		in.FirstSeenAt = now
	}
	if in.LastSeenAt.IsZero() {
		in.LastSeenAt = now
	}
	existing, ok := s.rows[in.StationID]
	if !ok {
		row := PeerKey{
			StationID:   in.StationID,
			Kid:         in.Kid,
			PubPEM:      in.PubPEM,
			FirstSeenAt: in.FirstSeenAt,
			LastSeenAt:  in.LastSeenAt,
		}
		s.rows[in.StationID] = &row
		return nil
	}
	if existing.Kid != in.Kid {
		if existing.Pinned {
			return ErrPinnedKeyMismatch
		}
		return ErrPeerKeyMismatch
	}
	existing.LastSeenAt = now
	return nil
}

func (s *InMemoryPeerKeyStore) TouchLastSeen(ctx context.Context, stationID string, ts time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if row, ok := s.rows[stationID]; ok {
		row.LastSeenAt = ts
	}
}

func (s *InMemoryPeerKeyStore) List(ctx context.Context) ([]PeerKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]PeerKey, 0, len(s.rows))
	for _, row := range s.rows {
		out = append(out, *row)
	}
	return out, nil
}

func (s *InMemoryPeerKeyStore) Pin(ctx context.Context, stationID, byActor string, at time.Time) error {
	if stationID == "" {
		return errors.New("federation: mempeerkeystore: Pin: empty id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	row, ok := s.rows[stationID]
	if !ok {
		return ErrUnknownPeer
	}
	row.Pinned = true
	row.PinnedByActor = byActor
	pinned := at
	row.PinnedAt = &pinned
	return nil
}

func (s *InMemoryPeerKeyStore) Unpin(ctx context.Context, stationID string) error {
	if stationID == "" {
		return errors.New("federation: mempeerkeystore: Unpin: empty id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	row, ok := s.rows[stationID]
	if !ok {
		return nil
	}
	row.Pinned = false
	row.PinnedByActor = ""
	row.PinnedAt = nil
	return nil
}

func (s *InMemoryPeerKeyStore) Forget(ctx context.Context, stationID string) (int64, error) {
	if stationID == "" {
		return 0, errors.New("federation: mempeerkeystore: Forget: empty id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.rows[stationID]; !ok {
		return 0, nil
	}
	delete(s.rows, stationID)
	return 1, nil
}

func (s *InMemoryPeerKeyStore) DeleteUnpinnedOlderThan(ctx context.Context, olderThan time.Time) (int64, error) {
	if olderThan.IsZero() {
		return 0, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int64
	for id, row := range s.rows {
		if !row.Pinned && row.LastSeenAt.Before(olderThan) {
			delete(s.rows, id)
			n++
		}
	}
	return n, nil
}
