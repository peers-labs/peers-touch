package federation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SlotCurrent and SlotPrev are the only valid `slot` values.
// Exported as named constants so call sites read as
// `KeyStore.Load(ctx, federation.SlotCurrent)` rather than
// stringly-typed lookups.
const (
	SlotCurrent = "current"
	SlotPrev    = "prev"
)

// ErrNoLocalKey is returned by KeyStore.Load when the requested
// slot is empty. KeyCache treats this as "I should generate one";
// every other caller treats it as a fatal init-time error.
var (
	ErrNoLocalKey = errors.New("federation: keystore: slot empty")

	// ErrLocalKeyReplacementRequiresRotation prevents callers from bypassing
	// archive-before-retire by overwriting an existing current key.
	ErrLocalKeyReplacementRequiresRotation = errors.New(
		"federation: keystore: replacing current key requires rotation",
	)
)

// AuthLocalKeyTable is the table name owned by the framework's
// federation package. Exported so the framework's bootstrap can
// reference it from a single literal — no other code should
// touch the table directly.
const AuthLocalKeyTable = "auth_local_keys"

// AuthLocalKeyRow is the GORM model for the local keypair table.
//
// Schema choice: a 2-row table keyed by `Slot` (rather than a
// generic KV) because:
//
//   - Slot is a closed enum (`current`, `prev`) with strict
//     transitions; modelling it as a column lets the type system
//     and GORM's primary-key constraints catch misuse before
//     the SQL layer.
//   - Atomic rotation is `BEGIN; UPDATE current; UPDATE prev;
//     COMMIT;` — trivial in this shape, awkward in a KV.
//   - The future "publish my federation keys to the dashboard"
//     endpoint reads exactly two rows by primary key, no JOIN.
type AuthLocalKeyRow struct {
	Slot        string    `gorm:"primaryKey;type:varchar(16)"`
	Kid         string    `gorm:"type:varchar(64);not null;index"`
	PrivPEM     string    `gorm:"type:text;not null"`
	PubPEM      string    `gorm:"type:text;not null"`
	GeneratedAt time.Time `gorm:"not null"`
	UpdatedAt   time.Time `gorm:"not null"`
}

// TableName binds the model to the canonical table name above so
// renaming it requires a single source change.
func (AuthLocalKeyRow) TableName() string { return AuthLocalKeyTable }

// KeyStore is the persistence contract for the local signing
// keypair. The surface is small and atomic by design — every
// mutation that touches more than one slot is exposed as a
// single method (Rotate, ClearPrev) rather than something the
// caller composes from primitive Load/Save calls. That way the
// "rotation is transactional" invariant lives inside the impl,
// not the caller.
type KeyStore interface {
	// Load returns the LocalKey persisted in `slot`, or
	// (nil, ErrNoLocalKey) when the row does not exist.
	Load(ctx context.Context, slot string) (*LocalKey, error)

	// LoadCurrentKid is the cheap probe KeyCache uses to
	// detect a dashboard-driven rotation. Returns "" without
	// error when no current row is present.
	LoadCurrentKid(ctx context.Context) (string, error)

	// PutCurrent installs the initial key or accepts an exact
	// idempotent replay. Replacing an existing current key must
	// use Rotate so the outgoing public key is archived first.
	PutCurrent(ctx context.Context, k *LocalKey) error

	// Rotate atomically archives the outgoing public key, demotes
	// the existing `current` (if any) into `prev`, then writes
	// `newKey` into `current`. stationPeerID is mandatory because
	// retained proof keys never use a blank/local sentinel.
	Rotate(ctx context.Context, stationPeerID string, newKey *LocalKey) (*RotateResult, error)

	// ClearPrev removes exactly the expected `prev` row after the
	// dual-sign grace window. A concurrent rotation leaves its newly
	// demoted key intact and returns cleared=false.
	ClearPrev(
		ctx context.Context,
		expectedKeyID string,
		expectedUpdatedAt time.Time,
	) (cleared bool, err error)
}

// RotateResult records the outcome of a successful Rotate. The
// dashboard's audit / API layer projects this into the response
// shape it returns to the operator.
type RotateResult struct {
	NewKid      string
	PreviousKid string
	RotatedAt   time.Time
}

// gormKeyStore is the production implementation. Constructed
// either with NewKeyStoreGORM (uses the global injected store)
// or with NewKeyStoreGORMWithDB (passes a *gorm.DB directly,
// for tests + advanced wiring).
type gormKeyStore struct {
	dbName string
	db     *gorm.DB // optional; when set, bypasses the global store lookup
	clock  func() time.Time
}

// NewKeyStoreGORM returns a KeyStore that resolves its *gorm.DB
// lazily via the framework's injected store on every call. This
// is the production constructor — callers do NOT need a DB
// handle at construction time, which keeps wiring simple inside
// `auth.Service.Init`.
func NewKeyStoreGORM(dbName string) KeyStore {
	return &gormKeyStore{dbName: dbName, clock: time.Now}
}

// NewKeyStoreGORMWithDB returns a KeyStore bound to a specific
// *gorm.DB. Used by tests and by callers that prefer to manage
// their own pool. The dbName field is left empty because the
// resolver is bypassed — store.GetRDS is never called.
func NewKeyStoreGORMWithDB(db *gorm.DB) KeyStore {
	return &gormKeyStore{db: db, clock: time.Now}
}

func (s *gormKeyStore) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
	if err != nil {
		return nil, fmt.Errorf("federation: keystore: db lookup %q: %w", s.dbName, err)
	}
	return db, nil
}

func (s *gormKeyStore) Load(ctx context.Context, slot string) (*LocalKey, error) {
	if slot != SlotCurrent && slot != SlotPrev {
		return nil, fmt.Errorf("federation: keystore: invalid slot %q", slot)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row AuthLocalKeyRow
	err = db.Where("slot = ?", slot).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNoLocalKey
		}
		return nil, err
	}
	key, err := ParseLocalKey(
		row.PrivPEM,
		row.PubPEM,
		row.Kid,
		row.GeneratedAt,
	)
	if err != nil {
		return nil, err
	}
	key.UpdatedAt = row.UpdatedAt
	return key, nil
}

func (s *gormKeyStore) LoadCurrentKid(ctx context.Context) (string, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return "", err
	}
	var row AuthLocalKeyRow
	err = db.Select("kid").Where("slot = ?", SlotCurrent).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return row.Kid, nil
}

func (s *gormKeyStore) PutCurrent(ctx context.Context, k *LocalKey) error {
	if k == nil || k.IsZero() {
		return errors.New("federation: keystore: PutCurrent: key is empty")
	}
	localKeyLifecycleMu.Lock()
	defer localKeyLifecycleMu.Unlock()

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	now := s.clock()
	return db.Transaction(func(tx *gorm.DB) error {
		var existing AuthLocalKeyRow
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("slot = ?", SlotCurrent).
			First(&existing).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			return tx.Create(rowFromLocalKey(SlotCurrent, k, now)).Error
		case err != nil:
			return err
		case existing.Kid == k.Kid &&
			existing.PrivPEM == k.PrivPEM &&
			existing.PubPEM == k.PubPEM:
			return nil
		default:
			return ErrLocalKeyReplacementRequiresRotation
		}
	})
}

func (s *gormKeyStore) Rotate(
	ctx context.Context,
	stationPeerID string,
	newKey *LocalKey,
) (*RotateResult, error) {
	stationPeerID = strings.TrimSpace(stationPeerID)
	if stationPeerID == "" {
		return nil, errors.New("federation: keystore: Rotate: station peer id is required")
	}
	if newKey == nil || newKey.IsZero() {
		return nil, errors.New("federation: keystore: Rotate: key is empty")
	}
	localKeyLifecycleMu.Lock()
	defer localKeyLifecycleMu.Unlock()

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.clock()

	var existing AuthLocalKeyRow
	hasExisting := false

	err = db.Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("slot = ?", SlotCurrent).
			First(&existing).Error
		switch {
		case err == nil:
			hasExisting = true
		case errors.Is(err, gorm.ErrRecordNotFound):
			hasExisting = false
		default:
			return err
		}

		if hasExisting && existing.Kid == newKey.Kid {
			// Refuse rather than overwrite because doing so would
			// destroy the previous key without a real rotation.
			return errors.New("federation: keystore: Rotate: new kid identical to current")
		}

		if hasExisting {
			if err := archiveContentProofVerificationKey(
				tx,
				stationPeerID,
				existing,
				now,
			); err != nil {
				return err
			}
			demoted := existing
			demoted.Slot = SlotPrev
			demoted.UpdatedAt = now
			if err := upsertRowTx(tx, demoted); err != nil {
				return err
			}
		}
		return upsertSlot(tx, SlotCurrent, newKey, now)
	})
	if err != nil {
		return nil, err
	}

	res := &RotateResult{NewKid: newKey.Kid, RotatedAt: now}
	if hasExisting {
		res.PreviousKid = existing.Kid
	}
	return res, nil
}

func (s *gormKeyStore) ClearPrev(
	ctx context.Context,
	expectedKeyID string,
	expectedUpdatedAt time.Time,
) (bool, error) {
	expectedKeyID = strings.TrimSpace(expectedKeyID)
	if expectedKeyID == "" || expectedUpdatedAt.IsZero() {
		return false, errors.New(
			"federation: keystore: ClearPrev: expected identity is required",
		)
	}
	localKeyLifecycleMu.Lock()
	defer localKeyLifecycleMu.Unlock()

	db, err := s.getDB(ctx)
	if err != nil {
		return false, err
	}
	cleared := false
	err = db.Transaction(func(tx *gorm.DB) error {
		var previous AuthLocalKeyRow
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("slot = ?", SlotPrev).
			First(&previous).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if previous.Kid != expectedKeyID ||
			!previous.UpdatedAt.Equal(expectedUpdatedAt) {
			return nil
		}
		result := tx.Where(
			"slot = ? AND kid = ?",
			SlotPrev,
			expectedKeyID,
		).Delete(&AuthLocalKeyRow{})
		if result.Error != nil {
			return result.Error
		}
		cleared = result.RowsAffected == 1
		return nil
	})
	return cleared, err
}

func upsertSlot(db *gorm.DB, slot string, k *LocalKey, now time.Time) error {
	row := AuthLocalKeyRow{
		Slot:        slot,
		Kid:         k.Kid,
		PrivPEM:     k.PrivPEM,
		PubPEM:      k.PubPEM,
		GeneratedAt: orNow(k.GeneratedAt, now),
		UpdatedAt:   now,
	}
	return upsertRowTx(db, row)
}

func upsertRowTx(tx *gorm.DB, row AuthLocalKeyRow) error {
	res := tx.Model(&AuthLocalKeyRow{}).Where("slot = ?", row.Slot).Updates(map[string]any{
		"kid":          row.Kid,
		"priv_pem":     row.PrivPEM,
		"pub_pem":      row.PubPEM,
		"generated_at": row.GeneratedAt,
		"updated_at":   row.UpdatedAt,
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		return nil
	}
	return tx.Create(&row).Error
}

func orNow(t, fallback time.Time) time.Time {
	if t.IsZero() {
		return fallback
	}
	return t
}
