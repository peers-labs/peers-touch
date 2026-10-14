// locator_hook.go — bridges the actor write path to the federation locator
// publisher. Phase A defines the federation columns on touch_actor; this
// file is the Phase B hook that keeps those columns in sync with the DHT.
//
// Design tenets:
//
//  1. The hook is a thin orchestrator. ALL DHT mechanics (signing, key
//     derivation, PutValue) live in frame/core/plugin/native/federation/locator.
//     This file only decides "publish now or tombstone now" and increments
//     touch_actor.locator_seq under transactional control.
//
//  2. Publish failures are logged, never propagated to the HTTP caller. The
//     write-side source of truth is the local touch_actor row; the DHT is a
//     best-effort projection. A failed publish leaves locator_seq incremented
//     so the NEXT successful publish supersedes whatever (older) record may
//     still be in flight on remote DHT replicas.
//
//  3. Local rows only. The publisher refuses to broadcast remote_cached
//     rows; this guard is enforced both here (cheap early return) and in
//     locator.Publisher (defence in depth).

package actor

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// OriginLocal / OriginRemoteCached are the persisted values for
// touch_actor.origin. They mirror the ActorOrigin proto enum but are stored
// as short strings for SQL ergonomics (greppable in dump files, no enum
// migration required if a third value is added).
const (
	OriginLocal        = "local"
	OriginRemoteCached = "remote_cached"
)

// Visibility constants mirror modelpb.ActorVisibility numerics so the int16
// column maps 1:1 with the wire enum.
const (
	VisibilityHidden   int16 = int16(modelpb.ActorVisibility_ACTOR_VISIBILITY_HIDDEN)
	VisibilityByHandle int16 = int16(modelpb.ActorVisibility_ACTOR_VISIBILITY_BY_HANDLE)
	VisibilityIndexed  int16 = int16(modelpb.ActorVisibility_ACTOR_VISIBILITY_INDEXED)
)

// publisherSingleton lazily binds the package-level locator.Publisher to the
// federation key cache. Lazy because the publisher's KeyCache dependency is
// only valid after `peers.yml` is materialised — calling NewPublisher at
// package-init time would race against config load.
//
// Note: the underlying KeyCache is itself the process-wide singleton owned
// by `authfed.Singleton()`. We keep one `sync.Once` here only because
// `locator.NewPublisher` does additional argument-validation work the cache
// itself does not — once-Do prevents repeating that work on every publish.
var (
	publisherOnce sync.Once
	publisher     *locator.Publisher
	publisherErr  error
)

func getPublisher() (*locator.Publisher, error) {
	publisherOnce.Do(func() {
		p, err := locator.NewPublisher(locator.PublisherConfig{Keys: authfed.Singleton()})
		if err != nil {
			publisherErr = fmt.Errorf("locator hook: build publisher: %w", err)
			return
		}
		publisher = p
	})
	if publisherErr != nil {
		return nil, publisherErr
	}
	return publisher, nil
}

// fillFederationFieldsForLocalSignUp materialises the federation columns at
// SignUp time. Caller passes the in-progress *db.Actor before Create — the
// resulting row carries all federation-visible state from row birth.
//
// The function is fail-soft on missing local identity: a station that has
// not finished bootstrap yet (extremely early signup, or a manual SQL
// insert) leaves the row with empty federation fields and Visibility = 0
// (UNSPECIFIED == effectively hidden). The next visibility flip via
// PublishVisibility() can backfill once identity becomes available.
func fillFederationFieldsForLocalSignUp(a *db.Actor) {
	a.Origin = OriginLocal
	if a.Visibility == 0 {
		a.Visibility = VisibilityByHandle // sane default — discoverable by exact handle
	}

	id := fednode.LocalIdentitySnapshot()
	if id.StationDomain != "" {
		a.HomeStationDomain = id.StationDomain
		a.FederatedHandle = "@" + a.PreferredUsername + "@" + id.StationDomain
	}
	if id.StationPeerID != "" {
		a.HomeStationPeerID = id.StationPeerID.String()
	}
}

// PublishVisibility synchronises the DHT with the actor's current
// Visibility column. It MUST be called after every write that flips
// Visibility (SignUp, future UpdateVisibility endpoint).
//
// Behaviour by visibility state:
//   - HIDDEN: tombstone the handle in the DHT.
//   - BY_HANDLE / INDEXED: publish a fresh signed record.
//   - UNSPECIFIED (0): treated as HIDDEN; the locator stays silent.
//
// The function increments touch_actor.locator_seq atomically before signing
// so two concurrent publishes never reuse a seq.
func PublishVisibility(ctx context.Context, actorID uint64) error {
	return publishVisibility(ctx, actorID, true)
}

// RepublishVisibility refreshes the signed DHT record lifetime without
// advancing the semantic locator revision used by remote cache revalidation.
func RepublishVisibility(ctx context.Context, actorID uint64) error {
	return publishVisibility(ctx, actorID, false)
}

func publishVisibility(
	ctx context.Context,
	actorID uint64,
	advanceSequence bool,
) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return fmt.Errorf("locator hook: db: %w", err)
	}

	var a db.Actor
	if err := rds.First(&a, actorID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil // actor gone — nothing to publish
		}
		return fmt.Errorf("locator hook: load actor %d: %w", actorID, err)
	}

	// Defensive: only local rows produce DHT writes. Remote-cached rows
	// must not be re-published — the home station is the only authority.
	if a.Origin != OriginLocal {
		return nil
	}
	if a.FederatedHandle == "" {
		// Identity wasn't ready at SignUp — try once more now.
		fillFederationFieldsForLocalSignUp(&a)
		if a.FederatedHandle == "" {
			logger.Warnf(ctx, "[locator hook] actor %d still has no federated handle; bootstrap not ready, skipping publish", actorID)
			return nil
		}
	}

	pub, err := getPublisher()
	if err != nil {
		return err
	}

	// Atomically bump locator_seq and read the post-update value. We read
	// `a` after the UPDATE so the in-memory copy carries the seq we will
	// sign with — pre-increment to avoid race with a parallel PublishVisibility.
	if advanceSequence || a.LocatorSeq == 0 {
		tx := rds.Model(&db.Actor{}).
			Where("id = ?", actorID).
			UpdateColumn("locator_seq", gorm.Expr("locator_seq + 1"))
		if tx.Error != nil {
			return fmt.Errorf(
				"locator hook: bump seq for actor %d: %w",
				actorID,
				tx.Error,
			)
		}
	}
	if err := rds.Select("locator_seq", "federated_handle", "home_station_peer_id", "home_station_domain", "visibility").First(&a, actorID).Error; err != nil {
		return fmt.Errorf("locator hook: reload actor %d: %w", actorID, err)
	}

	in := locator.PublishInput{
		Handle: a.FederatedHandle,
		Seq:    a.LocatorSeq,
	}

	switch a.Visibility {
	case VisibilityByHandle, VisibilityIndexed:
		if err := pub.Publish(ctx, in); err != nil {
			logger.Warnf(ctx, "[locator hook] publish failed handle=%s seq=%d err=%v", a.FederatedHandle, a.LocatorSeq, err)
			return err
		}
		logger.Infof(ctx, "[locator hook] published handle=%s seq=%d visibility=%d", a.FederatedHandle, a.LocatorSeq, a.Visibility)
	default:
		// HIDDEN or UNSPECIFIED — tombstone removes the handle from
		// remote DHT replicas. We tombstone unconditionally on hidden
		// even when no prior publish exists; receivers ignore tombstones
		// for unknown handles.
		if err := pub.Tombstone(ctx, in); err != nil {
			logger.Warnf(ctx, "[locator hook] tombstone failed handle=%s seq=%d err=%v", a.FederatedHandle, a.LocatorSeq, err)
			return err
		}
		logger.Infof(ctx, "[locator hook] tombstoned handle=%s seq=%d", a.FederatedHandle, a.LocatorSeq)
	}
	return nil
}

// publishVisibilityAsync is the fire-and-forget variant SignUp/UpdateProfile
// can dispatch from a tight HTTP handler. We give the publish a generous
// timeout because PutValue queries multiple DHT peers; a 30s ceiling keeps
// the goroutine from leaking forever if the network is broken.
func publishVisibilityAsync(actorID uint64) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := PublishVisibility(ctx, actorID); err != nil {
			logger.Warnf(ctx, "[locator hook] async publish actor=%d err=%v", actorID, err)
		}
	}()
}
