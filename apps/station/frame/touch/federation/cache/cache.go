package cache

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Origin tags mirror frame/touch/actor.Origin* constants. Defined here
// so the cache package does not import the actor package (which would
// create a cycle: actor imports federation/cache for write-through).
const (
	originLocal        = "local"
	originRemoteCached = "remote_cached"
)

// Visibility numerics mirror modelpb.ActorVisibility. We hold them as
// package-private constants for the same reason — the cache package
// stays as a small leaf that only needs the int16 wire values.
const (
	visibilityHidden   = 1
	visibilityByHandle = 2
	visibilityIndexed  = 3
)

// ErrCacheMiss is returned by Lookup when no usable cached row exists
// for the requested handle. The resolver treats it identically to a
// fresh DHT lookup decision.
var ErrCacheMiss = errors.New("federation cache: miss")

// ErrStaleEnvelope is returned by Upsert when the supplied envelope
// would replace a fresher cached row (lower locator seq). Defensive:
// callers always pass freshly-verified envelopes, but the check stops
// a buggy retry loop from rolling the cache backward.
var ErrStaleEnvelope = errors.New("federation cache: envelope older than cached row")

// Cached is the in-process projection returned by Lookup. It carries
// the touch_actor row plus the cached envelope expiry so the caller
// (resolver) can build its own response without re-reading the DB.
type Cached struct {
	Actor          *db.Actor
	CachedUntilUTC time.Time
}

// UpsertInput is the verified-envelope view the cache needs to persist
// or refresh a remote_cached row.
type UpsertInput struct {
	// Envelope is the verified profile envelope returned by the home
	// station. The caller MUST have run fedprofile.Verify on it AND
	// cross-checked its signing_key_pem against the locator record.
	Envelope *profilepb.ActorProfileEnvelope

	// Locator is the locator record that authenticated the envelope.
	// Stored alongside so cache freshness can be compared by seq, not
	// just by wall-clock.
	Locator *locatorpb.ActorLocatorRecord

	// Now overrides time.Now (tests). Zero falls back to time.Now.
	Now time.Time
}

// Lookup resolves a federated handle to its cached touch_actor row.
//
// Returns ErrCacheMiss when:
//   - no row exists for this handle, OR
//   - the row exists but origin != remote_cached (a coincident local
//     row never serves as a federation cache), OR
//   - the row's CachedUntilUnixMs is in the past relative to Now.
//
// The intentional non-error of "row exists but visibility != BY_HANDLE
// / INDEXED" returns a Cached value with Actor.Visibility set so the
// caller can surface "withdrawn / hidden" UI states without hitting
// the DHT again immediately. Concrete callers (resolver) decide
// whether to short-circuit on tombstone or refresh.
func Lookup(ctx context.Context, handle string) (*Cached, error) {
	canon, err := locator.CanonicalHandle(handle)
	if err != nil {
		return nil, fmt.Errorf("federation cache: %w", err)
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("federation cache: db: %w", err)
	}

	var row db.Actor
	err = rds.Where("federated_handle = ? AND origin = ?", canon, originRemoteCached).
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCacheMiss
		}
		return nil, fmt.Errorf("federation cache: select: %w", err)
	}

	now := time.Now()
	if row.CachedUntilUnixMs <= 0 || now.UnixMilli() >= row.CachedUntilUnixMs {
		return nil, ErrCacheMiss
	}

	return &Cached{
		Actor:          &row,
		CachedUntilUTC: time.UnixMilli(row.CachedUntilUnixMs).UTC(),
	}, nil
}

// Upsert writes (or refreshes) a remote_cached touch_actor row from a
// verified envelope. The function is idempotent: repeatedly upserting
// the same envelope leaves the row stable except for UpdatedAt.
//
// Returns ErrStaleEnvelope when the supplied locator seq is strictly
// less than what the cache already holds — older records never
// overwrite newer ones. Tombstoned envelopes set visibility to
// HIDDEN and zero out CachedUntilUnixMs so the next Lookup falls back
// to a fresh DHT roundtrip.
func Upsert(ctx context.Context, in UpsertInput) error {
	if in.Envelope == nil {
		return errors.New("federation cache: nil envelope")
	}
	if in.Locator == nil {
		return errors.New("federation cache: nil locator")
	}

	canon := strings.TrimSpace(in.Envelope.GetFederatedHandle())
	if canon == "" {
		return errors.New("federation cache: envelope missing federated_handle")
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return fmt.Errorf("federation cache: db: %w", err)
	}

	now := in.Now
	if now.IsZero() {
		now = time.Now()
	}

	// Defensive: a buggy caller racing two upserts for the same handle
	// must not roll back the cache. If a row exists with a higher seq,
	// reject the write.
	var existing db.Actor
	err = rds.Where("federated_handle = ?", canon).First(&existing).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		existing = db.Actor{} // fall through to insert path
	case err != nil:
		return fmt.Errorf("federation cache: select existing: %w", err)
	default:
		if existing.Origin == originLocal {
			// Never overwrite a local row from federation traffic — that
			// would let a malicious peer hijack the local actor's
			// touch_actor row. The resolver upstream MUST short-circuit
			// "handle resolves to my own peer id" before calling Upsert,
			// but we belt-and-braces enforce it here too.
			return fmt.Errorf("federation cache: refusing to overwrite local row for %s", canon)
		}
		if in.Locator.GetSeq() < existing.LocatorSeq {
			return ErrStaleEnvelope
		}
	}

	row := buildRow(canon, in, now, &existing)

	// ON CONFLICT (federated_handle) DO UPDATE — Postgres-friendly upsert
	// that keeps INSERT semantics (preserves CreatedAt) while letting a
	// repeated call simply refresh the federation columns.
	tx := rds.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "federated_handle"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name", "summary", "icon", "image", "url",
			"home_station_peer_id", "home_station_domain",
			"origin", "visibility", "locator_seq", "cached_until_unix_ms",
			"updated_at",
		}),
	}).Create(&row)
	if tx.Error != nil {
		return fmt.Errorf("federation cache: upsert: %w", tx.Error)
	}
	return nil
}

// EvictResult describes what Evict did, so callers (the invalidation
// handler today, an admin tool tomorrow) can log a single line per
// event without re-querying the table.
type EvictResult struct {
	// Found is true when a remote_cached row matching the handle
	// existed before eviction; false means the station never cached
	// this handle and the call was a no-op.
	Found bool
	// PreviousSeq is the locator seq the cached row carried before
	// eviction, or 0 when Found is false. Useful for logs where we
	// want to confirm the invalidation seq was monotonically newer.
	PreviousSeq uint64
}

// Evict marks the cached envelope for `handle` as stale so the next
// Lookup returns ErrCacheMiss and forces the resolver to re-fetch.
//
// We deliberately implement this as a soft delete rather than a row
// removal:
//
//   - Local rows (origin=local) are NEVER touched. The same handle
//     can name a real local actor on another station; we must not
//     let an invalidation event delete that station's authoritative
//     identity. The WHERE clause makes this impossible.
//
//   - For remote_cached rows we zero CachedUntilUnixMs and flip
//     visibility to HIDDEN. Lookup checks both: zero expiry returns
//     ErrCacheMiss directly, and the visibility downgrade keeps any
//     UI surface that read the row pre-evict from accidentally
//     surfacing it as "active". The row stays so the resolver can
//     compare locator seqs the next time the publisher's record
//     reaches us via DHT.
//
// The function is idempotent: a second Evict on the same handle is a
// no-op (Found stays true on the first hit, false thereafter when
// the row's expiry is already zero — we re-write zero anyway, which
// is harmless).
//
// Errors are propagated with context so the invalidation handler can
// log them without flattening; a transient DB error here is not a
// federation correctness problem (the row is still going to be re-
// resolved on TTL expiry).
func Evict(ctx context.Context, handle string) (EvictResult, error) {
	canon, err := locator.CanonicalHandle(handle)
	if err != nil {
		return EvictResult{}, fmt.Errorf("federation cache: %w", err)
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return EvictResult{}, fmt.Errorf("federation cache: db: %w", err)
	}

	var existing db.Actor
	err = rds.Where("federated_handle = ? AND origin = ?", canon, originRemoteCached).
		First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return EvictResult{Found: false}, nil
		}
		return EvictResult{}, fmt.Errorf("federation cache: select: %w", err)
	}

	// Single UPDATE: preserve every column except the freshness
	// markers. Re-querying the row above lets us return PreviousSeq
	// and avoids a second SELECT in the caller's log path.
	tx := rds.Model(&db.Actor{}).
		Where("id = ? AND origin = ?", existing.ID, originRemoteCached).
		Updates(map[string]interface{}{
			"visibility":           int16(visibilityHidden),
			"cached_until_unix_ms": int64(0),
			"updated_at":           time.Now(),
		})
	if tx.Error != nil {
		return EvictResult{}, fmt.Errorf("federation cache: evict update: %w", tx.Error)
	}

	return EvictResult{
		Found:       true,
		PreviousSeq: existing.LocatorSeq,
	}, nil
}

// buildRow projects an envelope + locator into a touch_actor row ready
// for upsert. Centralised here so the column layout stays in sync with
// Lookup's read path.
func buildRow(canon string, in UpsertInput, now time.Time, existing *db.Actor) db.Actor {
	envProfile := in.Envelope.GetProfile()

	cachedUntil := in.Envelope.GetExpiresAtUnixMs()
	visibility := int16(visibilityByHandle)
	if in.Locator.GetTombstone() {
		visibility = int16(visibilityHidden)
		// Tombstoned rows MUST NOT be considered fresh by Lookup —
		// withdrawals are a strong signal to refresh on next access.
		cachedUntil = 0
	}

	row := db.Actor{
		ID:                existing.ID,
		PreferredUsername: canon, // remote rows hold the full handle to avoid colliding with local preferred_username uniqueness.
		Namespace:         strings.TrimSpace(existing.Namespace),
		FederatedHandle:   canon,
		HomeStationPeerID: in.Envelope.GetHomeStationPeerId(),
		HomeStationDomain: in.Envelope.GetHomeStationDomain(),
		Origin:            originRemoteCached,
		Visibility:        visibility,
		LocatorSeq:        in.Locator.GetSeq(),
		CachedUntilUnixMs: cachedUntil,
		UpdatedAt:         now,
	}
	if row.Namespace == "" {
		row.Namespace = "peers"
	}
	if row.ID == 0 {
		row.ID = id.NextID()
		row.CreatedAt = now
	} else {
		row.CreatedAt = existing.CreatedAt
	}

	// Populate display fields from the envelope's ActorProfile body.
	// Sensitive columns (email, password_hash, public_key, ...) stay
	// empty for remote rows — no remote station ever materialises
	// authentication state on this station.
	if envProfile != nil {
		row.Name = envProfile.GetDisplayName()
		row.Summary = envProfile.GetNote()
		row.Icon = envProfile.GetAvatar()
		row.Image = envProfile.GetHeader()
		row.Url = envProfile.GetUrl()
		row.PTID = strings.TrimSpace(envProfile.GetPeersTouch().GetNetworkId())
	}
	// Remote rows never expose an email; force a unique synthetic value
	// to satisfy the column's NOT NULL + UNIQUE INDEX constraint without
	// risking accidental email collisions across federations.
	if row.Email == "" {
		row.Email = "remote+" + canon
	}
	// Likewise, the ActivityPub keys are not transferred across
	// federations in MVP. Keep zero-length strings so the NOT NULL
	// columns hold but no consumer mistakes them for real keys.
	if row.PasswordHash == "" {
		row.PasswordHash = "remote-cached"
	}
	if row.Type == "" {
		row.Type = "Person"
	}
	if row.Kind == "" {
		row.Kind = "p"
	}
	return row
}
