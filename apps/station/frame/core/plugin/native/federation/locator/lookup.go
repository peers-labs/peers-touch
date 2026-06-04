// lookup.go — Lookup queries the federation DHT for an actor locator
// record by handle. The function is the read-side counterpart of Publisher.
//
// Tombstone semantics: a tombstone is a valid (signed, fresh) record whose
// `Tombstone == true`. Lookup returns it transparently; the caller decides
// whether to fall back to a cached row, return "user not found", or refresh
// the local actor cache. We do NOT return ErrNotFound for tombstones —
// "actor explicitly withdrew" is different from "no record".

package locator

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/libp2p/go-libp2p/core/routing"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	pb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	"google.golang.org/protobuf/proto"
)

// ErrNotFound is returned when the DHT has no record for the given handle.
// It is distinct from ErrSignatureInvalid / ErrRecordStale so callers can
// take different remedial action ("retry later" vs "evict cache").
var ErrNotFound = errors.New("locator: not found")

// Lookup is the read-side accessor for the federation DHT. It carries no
// state itself but exists as a value receiver so future enhancements (LRU
// cache, pending-request coalescing) have a place to land without adding
// new top-level helpers.
type Lookup struct {
	now func() time.Time
}

// LookupConfig configures a Lookup. Production callers pass the zero value.
type LookupConfig struct {
	Now func() time.Time
}

// NewLookup constructs a Lookup. now defaults to time.Now when nil.
func NewLookup(cfg LookupConfig) *Lookup {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Lookup{now: cfg.Now}
}

// GetByHandle resolves a federated handle to its (verified) locator record.
// Errors:
//   - ErrNotFound if the DHT has no value for the key
//   - ErrSignatureInvalid / ErrRecordStale / ErrHandleMismatch if the record
//     fails verification (callers may fall back to a cached profile)
//   - any wrapped routing error
func (l *Lookup) GetByHandle(ctx context.Context, handle string) (*pb.ActorLocatorRecord, error) {
	canon, err := CanonicalHandle(handle)
	if err != nil {
		return nil, fmt.Errorf("locator: lookup: %w", err)
	}
	key, err := DHTKey(canon)
	if err != nil {
		return nil, fmt.Errorf("locator: lookup: derive key: %w", err)
	}

	router := federation.Routing()
	if router == nil {
		return nil, fmt.Errorf("locator: lookup: routing not registered")
	}

	value, err := router.GetValue(ctx, key)
	if err != nil {
		if errors.Is(err, routing.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("locator: lookup: GetValue %s: %w", key, err)
	}
	if len(value) == 0 {
		return nil, ErrNotFound
	}

	rec := &pb.ActorLocatorRecord{}
	if err := proto.Unmarshal(value, rec); err != nil {
		return nil, fmt.Errorf("locator: lookup: unmarshal: %w", err)
	}
	if err := Verify(rec, VerifyOptions{ExpectedHandle: canon, Now: l.clock()}); err != nil {
		return nil, err
	}
	return rec, nil
}

func (l *Lookup) clock() time.Time {
	if l == nil || l.now == nil {
		return time.Now()
	}
	return l.now()
}
