// federation_self.go — user-self-service helpers for federation identity.
//
// Where locator_hook.go owns the WRITE side of the federation contract
// (sign + DHT publish), this file owns the user-driven control plane:
// "what is my federated handle right now?" and "I want to flip my
// visibility". Both are called from the public Hertz handlers in
// frame/touch/federation_api_handler.go and stay scoped to a single
// authenticated actor.
//
// Layering rules:
//   - Touch_actor row is the source of truth for visibility. The DHT
//     is a projection — UpdateVisibility writes the row first, then
//     fires the publish asynchronously.
//   - Federation identity columns (federated_handle / home_station_*)
//     are NEVER updated here: they are immutable from SignUp's point
//     of view. Domain rotations are an out-of-scope handover envelope.
//   - The function never returns wire-format protos. That projection
//     happens in the handler so this file remains independent of HTTP.

package actor

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// FederationSelfSnapshot is the read-side view callers want when
// rendering "my federation status" UIs. All fields are scoped to the
// requesting actor's local row — never a remote_cached projection.
type FederationSelfSnapshot struct {
	ActorID           uint64
	PreferredUsername string
	FederatedHandle   string
	HomeStationPeerID string
	HomeStationDomain string
	Visibility        int16
	VisibilityLabel   string
	LocatorSeq        uint64
	Origin            string
}

// VisibilityFromLabel converts a wire-format human label ("by_handle"
// / "indexed" / "hidden") to the int16 we persist. The function is
// strict: unknown labels return ErrInvalidVisibility so a typo can
// never silently downgrade a user's discoverability.
func VisibilityFromLabel(label string) (int16, error) {
	switch strings.ToLower(strings.TrimSpace(label)) {
	case "hidden":
		return VisibilityHidden, nil
	case "by_handle":
		return VisibilityByHandle, nil
	case "indexed":
		return VisibilityIndexed, nil
	default:
		return 0, fmt.Errorf("%w: %q (expected 'by_handle' | 'indexed' | 'hidden')", ErrInvalidVisibility, label)
	}
}

// VisibilityLabel is the inverse of VisibilityFromLabel — a stable
// string the UI can display verbatim. UNSPECIFIED is reported as
// "hidden" (matching the locator publisher's tombstone behaviour) so
// the user never sees an internal sentinel.
func VisibilityLabel(v int16) string {
	switch v {
	case VisibilityByHandle:
		return "by_handle"
	case VisibilityIndexed:
		return "indexed"
	case VisibilityHidden:
		return "hidden"
	default:
		return "hidden"
	}
}

// ErrInvalidVisibility flags an unparsable visibility label coming
// from the API caller. The handler maps it to HTTP 400.
var ErrInvalidVisibility = errors.New("invalid visibility")

// ErrNotLocal flags an attempt to mutate a row that is not local to
// this station — e.g., a stale numeric ID pointing at a remote_cached
// row. The handler maps it to HTTP 403.
var ErrNotLocal = errors.New("actor is not local to this station")

// GetFederationSelf returns the federation-relevant snapshot for the
// given LOCAL actor. Returns gorm.ErrRecordNotFound if no row exists,
// ErrNotLocal if the row exists but is a remote_cached projection.
func GetFederationSelf(ctx context.Context, actorID uint64) (*FederationSelfSnapshot, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("get rds: %w", err)
	}

	var row db.Actor
	if err := rds.First(&row, actorID).Error; err != nil {
		return nil, err
	}
	if row.Origin != OriginLocal {
		return nil, ErrNotLocal
	}

	return snapshotFromRow(&row), nil
}

// UpdateVisibility flips the requesting actor's visibility column and
// schedules an async republish so the DHT picks up the change. The
// function is intentionally non-transactional w.r.t. the publish: the
// row is the authority, the DHT is best-effort.
//
// Concurrent UpdateVisibility calls for the same actor are serialised
// by the underlying touch_actor.locator_seq atomic increment in
// PublishVisibility — every call produces a fresh seq, so the publish
// fan-out never deadlocks even if the user spams the toggle.
func UpdateVisibility(ctx context.Context, actorID uint64, target int16) (*FederationSelfSnapshot, error) {
	if target != VisibilityHidden && target != VisibilityByHandle && target != VisibilityIndexed {
		return nil, fmt.Errorf("%w: numeric=%d", ErrInvalidVisibility, target)
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("get rds: %w", err)
	}

	var row db.Actor
	if err := rds.First(&row, actorID).Error; err != nil {
		return nil, err
	}
	if row.Origin != OriginLocal {
		return nil, ErrNotLocal
	}

	if row.Visibility != target {
		if err := rds.Model(&db.Actor{}).
			Where("id = ?", actorID).
			UpdateColumn("visibility", target).Error; err != nil {
			return nil, fmt.Errorf("update visibility: %w", err)
		}
		row.Visibility = target
	}

	// Trigger the locator publish asynchronously. We reuse the same
	// fire-and-forget helper SignUp wires, so the HTTP caller never
	// pays DHT latency to flip a switch. PublishVisibility is internally
	// atomic on locator_seq so racing flips do not produce duplicate
	// records at the same seq.
	publishVisibilityAsync(actorID)

	return snapshotFromRow(&row), nil
}

// snapshotFromRow centralises the projection so GetFederationSelf and
// UpdateVisibility never disagree on the response shape — see also
// federation_api_handler.go where the snapshot is rendered to JSON.
func snapshotFromRow(row *db.Actor) *FederationSelfSnapshot {
	return &FederationSelfSnapshot{
		ActorID:           row.ID,
		PreferredUsername: row.PreferredUsername,
		FederatedHandle:   row.FederatedHandle,
		HomeStationPeerID: row.HomeStationPeerID,
		HomeStationDomain: row.HomeStationDomain,
		Visibility:        row.Visibility,
		VisibilityLabel:   VisibilityLabel(row.Visibility),
		LocatorSeq:        row.LocatorSeq,
		Origin:            row.Origin,
	}
}

// IsRecordNotFound is a small re-export so the handler package does not
// need to import gorm directly just to map "no such actor" to 404.
func IsRecordNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
