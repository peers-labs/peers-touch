// publisher.go — Publisher signs an ActorLocatorRecord and writes it to the
// DHT. The publisher is bound to a single station's identity (it refuses to
// publish records for other stations) and to a single Ed25519 signing key
// (the federation auth key cache).
//
// Errors are returned, never swallowed: callers (the actor write path) log
// and retry on the next visibility change. Publishing is best-effort by
// design — the source-of-truth lives in touch_actor.locator_seq + the next
// re-publish tick (Phase C).

package locator

import (
	"context"
	"fmt"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
)

// Publisher writes signed locator records to the federation DHT.
//
// Construct it once per process (the actor write path keeps a singleton).
// Publisher is goroutine-safe — every Publish call is independent.
type Publisher struct {
	keys *authfed.KeyCache
	now  func() time.Time
}

// PublisherConfig wires a publisher to its dependencies. Callers MUST pass
// a valid KeyCache; everything else is optional.
type PublisherConfig struct {
	// Keys is the cache that holds the station's federation Ed25519 key.
	// Reused unmodified across calls — the publisher does NOT take
	// ownership.
	Keys *authfed.KeyCache

	// Now is wall-clock for stamping records. Tests inject deterministic
	// clocks; production passes nil and gets time.Now.
	Now func() time.Time
}

// NewPublisher returns a Publisher bound to the supplied key cache.
func NewPublisher(cfg PublisherConfig) (*Publisher, error) {
	if cfg.Keys == nil {
		return nil, fmt.Errorf("locator: publisher: nil key cache")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Publisher{keys: cfg.Keys, now: cfg.Now}, nil
}

// PublishInput is the actor-row-derived view the publisher needs.
type PublishInput struct {
	Handle           string
	InboxRelayMounts []string
	// Seq is the monotonic counter from touch_actor.locator_seq; the
	// caller pre-increments before invoking Publish.
	Seq uint64
}

// Publish signs and writes a live (non-tombstone) record.
//
// The function:
//
//  1. Resolves the local station identity (PeerID + domain) via federation.
//     Refuses to publish if either is missing.
//  2. Refuses to publish if the handle's host portion does not match the
//     local station's domain — preventing a buggy caller from broadcasting
//     a remote-cached row back into the DHT.
//  3. Mints a signed pb.ActorLocatorRecord via Sign.
//  4. PutValue's the binary proto on the federation DHT.
func (p *Publisher) Publish(ctx context.Context, in PublishInput) error {
	return p.put(ctx, in, false)
}

// Tombstone signs and writes a withdrawal record. Same identity / handle
// validations as Publish.
func (p *Publisher) Tombstone(ctx context.Context, in PublishInput) error {
	return p.put(ctx, in, true)
}

func (p *Publisher) put(ctx context.Context, in PublishInput, tombstone bool) error {
	canon, err := CanonicalHandle(in.Handle)
	if err != nil {
		return fmt.Errorf("locator: publish: %w", err)
	}

	id := federation.LocalIdentitySnapshot()
	if id.StationPeerID == "" || strings.TrimSpace(id.StationDomain) == "" {
		return ErrPublisherIdentity
	}

	// Defensive: the canonical handle is "user@host". The publisher MUST
	// only sign records whose host portion matches the local station's
	// configured domain. Without this guard a buggy caller could publish
	// remote-cached rows back into the DHT, splitting authority.
	parts := strings.SplitN(canon, "@", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return fmt.Errorf("locator: publish: handle missing host: %q", canon)
	}
	if !strings.EqualFold(parts[1], id.StationDomain) {
		return fmt.Errorf("locator: publish: handle host %q != local station domain %q", parts[1], id.StationDomain)
	}

	key, err := DHTKey(canon)
	if err != nil {
		return fmt.Errorf("locator: publish: derive key: %w", err)
	}

	localKey, err := p.keys.Get(ctx)
	if err != nil {
		return fmt.Errorf("locator: publish: load station key: %w", err)
	}

	_, value, err := Sign(SignInput{
		Handle:            canon,
		HomeStationPeerID: id.StationPeerID.String(),
		HomeStationDomain: id.StationDomain,
		InboxRelayMounts:  in.InboxRelayMounts,
		Tombstone:         tombstone,
		Seq:               in.Seq,
		Now:               p.now(),
		LocalKey:          localKey,
	})
	if err != nil {
		return fmt.Errorf("locator: publish: sign: %w", err)
	}

	router := federation.Routing()
	if router == nil {
		return fmt.Errorf("locator: publish: routing not registered (bootstrap subserver not started?)")
	}
	if err := router.PutValue(ctx, key, value); err != nil {
		return fmt.Errorf("locator: publish: PutValue %s: %w", key, err)
	}

	logger.Infof(ctx, "[locator] published key=%s seq=%d tombstone=%v size=%d", key, in.Seq, tombstone, len(value))
	return nil
}
