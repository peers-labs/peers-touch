package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// PeerKeyRepository owns both halves of the OSS federation trust
// store: the *local* station's signing keypair (kept in oss_meta
// KV rows) and the *remote* peer public keys (kept in oss_peer_keys).
//
// Co-locating them in one repo is deliberate. Mint and verify are
// two sides of the same protocol, and a future audit / dashboard
// surface ("show me my federation key + everyone we trust") will
// query both halves in the same request.
type PeerKeyRepository interface {
	// LoadLocalKey returns the (privPEM, pubPEM, kid) currently
	// stamped in oss_meta. Returns ErrNoLocalKey when the rows are
	// missing — callers (the federation key cache) generate, then
	// SaveLocalKey.
	LoadLocalKey(ctx context.Context) (privPEM, pubPEM, kid string, err error)

	// SaveLocalKey persists the keypair under the canonical meta
	// keys. Idempotent: subsequent calls overwrite, which is the
	// behaviour a future rotation tool wants.
	SaveLocalKey(ctx context.Context, privPEM, pubPEM, kid string) error

	// GetCurrentKID returns just the KID currently stamped in
	// `oss_meta`. Returns ("", nil) when no key has been generated
	// yet — callers should treat that as "no rotation observable"
	// and keep using whatever they've cached.
	//
	// This is the cheap probe the federation key cache uses on
	// every Get() once its `recheckTTL` has elapsed: a single
	// indexed lookup we can compare against the in-memory KID to
	// notice a dashboard-driven rotation. Reading the full
	// keypair (LoadLocalKey) would be wasteful since the
	// overwhelmingly common outcome is "no change".
	GetCurrentKID(ctx context.Context) (string, error)

	// GetPeer returns the cached row for this peer station, or
	// (nil, nil) if it has never been seen.
	GetPeer(ctx context.Context, peerStationID string) (*ossmodel.PeerKey, error)

	// UpsertTOFU writes a fresh TOFU row when none exists, or
	// returns ErrPinnedKeyMismatch when an existing pinned row's
	// KID does not match. For unpinned rows, a KID mismatch is
	// also a hard error (ErrPeerKeyMismatch) — TOFU rotation is
	// out of scope in v1.
	UpsertTOFU(ctx context.Context, row ossmodel.PeerKey) error

	// TouchLastSeen advances last_seen_at on a successful verify.
	// Best-effort: failure is not propagated so a slow KV write
	// can never deny a federated GET.
	TouchLastSeen(ctx context.Context, peerStationID string, ts time.Time)

	// DeleteUnpinnedOlderThan removes peer-key rows where
	// `pinned = false` AND `last_seen_at < olderThan`. Pinned
	// rows are NEVER trimmed — once an operator promotes a peer
	// to pinned, dropping the cache silently would invalidate
	// the trust decision. Returns the row count actually
	// removed so the worker can audit / surface a heartbeat
	// number.
	//
	// Used exclusively by the PeerKeyTrim worker. The TOFU
	// inbound verifier re-creates rows on demand, so a trimmed
	// peer simply re-TOFUs on its next federated request —
	// matching the documented "non-pinned trust expires after N
	// days of silence" contract.
	DeleteUnpinnedOlderThan(ctx context.Context, olderThan time.Time) (int64, error)
}

// Sentinel errors. Callers branch on these to distinguish "first
// sighting" (continue with TOFU insert) from "key mismatch"
// (refuse the request).
var (
	ErrNoLocalKey         = errors.New("oss: federation: local key not yet generated")
	ErrPeerKeyMismatch    = errors.New("oss: federation: peer key mismatch (TOFU)")
	ErrPinnedKeyMismatch  = errors.New("oss: federation: peer key mismatch (pinned)")
)

type peerKeyRepo struct {
	dbName string
	clock  func() time.Time
}

func NewPeerKeyRepository(dbName string) PeerKeyRepository {
	return &peerKeyRepo{dbName: dbName, clock: time.Now}
}

func (r *peerKeyRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *peerKeyRepo) LoadLocalKey(ctx context.Context) (string, string, string, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return "", "", "", err
	}
	priv, err := readMeta(db, ossmodel.MetaKeyFederationPrivKey)
	if err != nil {
		return "", "", "", err
	}
	pub, err := readMeta(db, ossmodel.MetaKeyFederationPubKey)
	if err != nil {
		return "", "", "", err
	}
	kid, err := readMeta(db, ossmodel.MetaKeyFederationKID)
	if err != nil {
		return "", "", "", err
	}
	if priv == "" || pub == "" || kid == "" {
		return "", "", "", ErrNoLocalKey
	}
	return priv, pub, kid, nil
}

func (r *peerKeyRepo) GetCurrentKID(ctx context.Context) (string, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return "", err
	}
	return readMeta(db, ossmodel.MetaKeyFederationKID)
}

func (r *peerKeyRepo) SaveLocalKey(ctx context.Context, priv, pub, kid string) error {
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	now := r.clock()
	if err := writeMeta(db, ossmodel.MetaKeyFederationPrivKey, priv, now); err != nil {
		return err
	}
	if err := writeMeta(db, ossmodel.MetaKeyFederationPubKey, pub, now); err != nil {
		return err
	}
	return writeMeta(db, ossmodel.MetaKeyFederationKID, kid, now)
}

func (r *peerKeyRepo) GetPeer(ctx context.Context, peerStationID string) (*ossmodel.PeerKey, error) {
	if peerStationID == "" {
		return nil, errors.New("oss: peer key: empty peer station id")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row ossmodel.PeerKey
	err = db.Where("peer_station_id = ?", peerStationID).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *peerKeyRepo) UpsertTOFU(ctx context.Context, row ossmodel.PeerKey) error {
	if row.PeerStationID == "" || row.KID == "" || row.PublicKeyPEM == "" {
		return errors.New("oss: peer key upsert: missing fields")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	now := r.clock()
	if row.FirstSeenAt.IsZero() {
		row.FirstSeenAt = now
	}
	if row.LastSeenAt.IsZero() {
		row.LastSeenAt = now
	}

	var existing ossmodel.PeerKey
	err = db.Where("peer_station_id = ?", row.PeerStationID).First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return db.Create(&row).Error
		}
		return err
	}
	if existing.KID != row.KID {
		if existing.Pinned {
			return ErrPinnedKeyMismatch
		}
		// Unpinned mismatch is *also* a hard reject in v1. We do
		// not silently rotate TOFU keys — that would let a peer
		// reset trust without operator awareness.
		return ErrPeerKeyMismatch
	}
	// Same kid; refresh LastSeenAt only.
	return db.Model(&ossmodel.PeerKey{}).
		Where("peer_station_id = ?", row.PeerStationID).
		Update("last_seen_at", now).Error
}

func (r *peerKeyRepo) TouchLastSeen(ctx context.Context, peerStationID string, ts time.Time) {
	db, err := r.getDB(ctx)
	if err != nil {
		return
	}
	_ = db.Model(&ossmodel.PeerKey{}).
		Where("peer_station_id = ?", peerStationID).
		Update("last_seen_at", ts).Error
}

func (r *peerKeyRepo) DeleteUnpinnedOlderThan(ctx context.Context, olderThan time.Time) (int64, error) {
	if olderThan.IsZero() {
		return 0, nil
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	res := db.Where("pinned = ? AND last_seen_at < ?", false, olderThan).
		Delete(&ossmodel.PeerKey{})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

// --- private meta helpers ---

func readMeta(db *gorm.DB, key string) (string, error) {
	var m ossmodel.Meta
	err := db.Where("key = ?", key).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return m.Value, nil
}

func writeMeta(db *gorm.DB, key, value string, now time.Time) error {
	res := db.Model(&ossmodel.Meta{}).
		Where("key = ?", key).
		Updates(map[string]any{"value": value, "updated_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return db.Create(&ossmodel.Meta{Key: key, Value: value, UpdatedAt: now}).Error
	}
	return nil
}
