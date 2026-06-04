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
	"strings"
	"sync"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/invalidation"
	invpb "github.com/peers-labs/peers-touch/station/frame/touch/federation/invalidation/pb"
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

// PublishVisibilityOption tunes the side-effects of PublishVisibility.
// The zero value matches the user-driven case (broadcast invalidation
// fires after a successful publish); maintenance callers must pass an
// explicit option to disable broadcast.
type PublishVisibilityOption func(*publishVisibilityOpts)

type publishVisibilityOpts struct {
	suppressBroadcast bool
}

// WithoutBroadcast tells PublishVisibility NOT to fire the relay
// invalidation broadcast on success.
//
// Use this from the periodic republisher path, where the locator_seq
// bump is purely a freshness keep-alive and receivers' caches are
// already valid. Firing a broadcast on every republish would generate
// per-actor relay traffic every Republisher.Interval, which is a
// thunder herd with no semantic meaning (the envelope content didn't
// change).
//
// The user-driven paths (SignUp, UpdateVisibility, UpdateProfile,
// the operator-triggered locatorPublish endpoint) MUST NOT pass this
// option — they want fast cache invalidation across the federation.
func WithoutBroadcast() PublishVisibilityOption {
	return func(o *publishVisibilityOpts) { o.suppressBroadcast = true }
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
//
// Side-effects (Tier C1 push-style invalidation):
//   - HIDDEN/UNSPECIFIED branch always emits a REASON_TOMBSTONE broadcast.
//   - BY_HANDLE/INDEXED branch emits a REASON_VISIBILITY_FLIP broadcast
//     by default. Maintenance callers (republisher) opt out with
//     WithoutBroadcast().
func PublishVisibility(ctx context.Context, actorID uint64, opts ...PublishVisibilityOption) error {
	var o publishVisibilityOpts
	for _, apply := range opts {
		apply(&o)
	}
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
	tx := rds.Model(&db.Actor{}).
		Where("id = ?", actorID).
		UpdateColumn("locator_seq", gorm.Expr("locator_seq + 1"))
	if tx.Error != nil {
		return fmt.Errorf("locator hook: bump seq for actor %d: %w", actorID, tx.Error)
	}
	if err := rds.Select("locator_seq", "federated_handle", "home_station_peer_id", "home_station_domain", "visibility").First(&a, actorID).Error; err != nil {
		return fmt.Errorf("locator hook: reload actor %d: %w", actorID, err)
	}

	in := locator.PublishInput{
		Handle:           a.FederatedHandle,
		Seq:              a.LocatorSeq,
		InboxRelayMounts: currentInboxRelayMounts(),
	}

	switch a.Visibility {
	case VisibilityByHandle, VisibilityIndexed:
		if err := pub.Publish(ctx, in); err != nil {
			logger.Warnf(ctx, "[locator hook] publish failed handle=%s seq=%d err=%v", a.FederatedHandle, a.LocatorSeq, err)
			return err
		}
		logger.Infof(ctx, "[locator hook] published handle=%s seq=%d visibility=%d", a.FederatedHandle, a.LocatorSeq, a.Visibility)
		// Tier C1 — push-style invalidation. The receiver gates on
		// `event.LocatorSeq >= cached.LocatorSeq`, so a fresh seq
		// always wins; emitting the broadcast unconditionally on a
		// user-driven publish is correct (any receiver with a cached
		// envelope will refetch on demand, picking up whatever
		// content/visibility changed).
		//
		// Maintenance republishes pass WithoutBroadcast() because
		// they bump the seq purely for freshness — the envelope
		// content is identical and broadcasting on every loop would
		// flood the relay with no semantic gain.
		if !o.suppressBroadcast {
			publishInvalidationAsync(a.FederatedHandle, a.LocatorSeq, invpb.FederationInvalidation_REASON_VISIBILITY_FLIP)
		}
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
		// Tier C1 — push-style invalidation. The DHT tombstone reaches
		// remote stations slowly (next republish or peer's TTL). The
		// pub/sub broadcast lets every station mounted on the same
		// relay drop their cached envelope NOW, so a hidden actor stops
		// surfacing within seconds rather than hours.
		//
		// Best-effort: a relay-down or empty-fan-out is logged inside
		// publishInvalidationAsync and does NOT fail the user-visible
		// PUT path. The slow path (DHT tombstone + receiver TTL) is
		// always there as a safety net.
		publishInvalidationAsync(a.FederatedHandle, a.LocatorSeq, invpb.FederationInvalidation_REASON_TOMBSTONE)
	}
	return nil
}

// publishInvalidationAsync emits a Broadcast frame on the relay
// stream. We fire-and-forget because:
//
//   - The user-visible path (PUT visibility) returned successfully as
//     soon as the row was updated; the invalidation broadcast is a
//     speed-of-propagation optimisation, not a correctness gate.
//   - Errors are mapped to log lines + Prometheus once we add metrics;
//     they never bubble into the response.
//   - A 5s timeout caps the goroutine lifetime when the relay is
//     down (the underlying Publish has its own SetWriteDeadline; the
//     timeout here just prevents goroutine leaks if the registry
//     handle hangs synchronously for some reason).
func publishInvalidationAsync(handle string, seq uint64, reason invpb.FederationInvalidation_Reason) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		rc := fednode.RelayClient()
		if rc == nil {
			// "no registered relay-client" is the SAME observable state
			// as "stream down" from the perspective of an operator:
			// the broadcast didn't go out and the slow path will catch
			// up. Counted under the same label so dashboards don't
			// distinguish between two flavours of the same outcome.
			invalidation.RecordPublishRelayNotConnected()
			logger.Debugf(ctx, "[locator hook] skipping invalidation handle=%s seq=%d (relay-client not registered)", handle, seq)
			return
		}

		body, err := invalidation.Encode(&invpb.FederationInvalidation{
			FederatedHandle: handle,
			LocatorSeq:      seq,
			Reason:          reason,
		})
		if err != nil {
			invalidation.RecordPublishEncodeError()
			logger.Warnf(ctx, "[locator hook] invalidation encode handle=%s err=%v", handle, err)
			return
		}

		if err := rc.Publish(ctx, invalidation.Topic, body); err != nil {
			// Treat NOT-CONNECTED as debug-level: the slow path will
			// still propagate via DHT republish + receiver TTL. Other
			// errors imply a write failure mid-flight; warn so they
			// surface in dashboards.
			if errors.Is(err, fednode.ErrRelayNotConnected) {
				invalidation.RecordPublishRelayNotConnected()
				logger.Debugf(ctx, "[locator hook] invalidation skipped handle=%s seq=%d (relay stream down)", handle, seq)
				return
			}
			invalidation.RecordPublishError()
			logger.Warnf(ctx, "[locator hook] invalidation publish handle=%s seq=%d err=%v", handle, seq, err)
			return
		}

		invalidation.RecordPublishOK()
		logger.Infof(ctx, "[locator hook] invalidation published handle=%s seq=%d reason=%s",
			handle, seq, reason.String())
	}()
}

// currentInboxRelayMounts returns the relay-mount labels (today: a
// single relay base URL) the station is reachable through right now,
// for embedding into the next signed locator record.
//
// Tier B2 — the locator's inbox_relay_mounts field is a hint that
// lets remote resolvers detect "we share a relay, forward should
// work" vs. "we're on different relays, this resolve will fail
// unless relay-to-relay federation handles it". Receivers still
// authoritatively look up the live mount table on the relay before
// forwarding; we publish the hint to keep the cold-cache path
// informed.
//
// Empty slice when:
//   - relay-client subserver is disabled (single-station deploy
//     where the station is directly reachable, no relay hop needed
//     or even possible)
//   - relay-client is enabled but has not yet finished register
//     (initial startup window — the next periodic republish will
//     re-emit with mounts populated, see frame/touch/federation/
//     republisher).
//
// We deliberately use BaseURL — a stable canonical identifier —
// rather than the human label (`opts.Label` is the *station's* name
// on the relay, not the relay's identity). Two stations mounted on
// the same relay produce the same BaseURL, which is the comparison
// the resolver needs.
func currentInboxRelayMounts() []string {
	rc := fednode.RelayClient()
	if rc == nil {
		return nil
	}
	base := strings.TrimSpace(rc.BaseURL())
	if base == "" {
		return nil
	}
	// Trim trailing slash so two stations using "https://relay/"
	// vs. "https://relay" round-trip to the same string. The
	// resolver does the same trim at compare time.
	base = strings.TrimRight(base, "/")
	return []string{base}
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
