// resolver.go — single entry point ResolveByHandle. The surface is
// deliberately small: callers hand us a handle, we hand back a verified
// envelope plus the locator pointer that authenticated it.

package resolver

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	fedcache "github.com/peers-labs/peers-touch/station/frame/touch/federation/cache"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/encoding/protojson"
)

// Public errors. The resolver maps DHT / network / signature failures
// onto a small, stable surface so callers can branch on them without
// string-matching wrapped errors.
var (
	ErrLocalIdentityMissing = errors.New("resolver: local station identity not registered")
	ErrRelayUnavailable     = errors.New("resolver: relay-client not registered")
	ErrEmptyResponse        = errors.New("resolver: empty profile response")
	ErrTombstoned           = errors.New("resolver: actor withdrawn (tombstone)")
	// ErrFederationNotReady fires before any DHT GetValue when the
	// kad-DHT routing table has fewer peers than the configured
	// readiness threshold (federation.min-dht-peers). The handler
	// maps this to HTTP 503 so a Desktop client can show "joining
	// federation, retry shortly" instead of a multi-second hang.
	ErrFederationNotReady = errors.New("resolver: federation not ready")
)

// Resolved is the return shape: the verified envelope plus the locator
// record that authenticated it. Callers may inspect the locator for
// origin / mounts / seq metadata.
type Resolved struct {
	Envelope *profilepb.ActorProfileEnvelope
	Locator  *locatorpb.ActorLocatorRecord

	// IsLocal indicates the handle resolved to this station's own
	// PeerID — the resolver bypassed both the federation cache and the
	// /relay/forward leg.
	IsLocal bool

	// FromCache is true when the resolver served the envelope from the
	// federation cache without contacting the DHT or the home station.
	// Diagnostic value only; the envelope contents are identical.
	FromCache bool
}

// Resolver carries cross-call state. The struct is goroutine-safe; one
// per process is fine.
type Resolver struct {
	httpClient    *http.Client
	now           func() time.Time
	lookupTimeout time.Duration
	remoteTimeout time.Duration
	skipCache     bool
}

// Config tunes the resolver. Zero value gives sensible production
// defaults.
type Config struct {
	HTTPClient    *http.Client
	Now           func() time.Time
	LookupTimeout time.Duration
	RemoteTimeout time.Duration

	// SkipCache disables the federation cache read-through path. Set
	// for diagnostic resolves where the operator wants to confirm the
	// network leg is healthy without a stale cache shadowing the
	// answer. The write-through still runs so subsequent reads see a
	// fresh row.
	SkipCache bool
}

// New constructs a resolver. The zero Config is fine.
func New(cfg Config) *Resolver {
	r := &Resolver{
		httpClient:    cfg.HTTPClient,
		now:           cfg.Now,
		lookupTimeout: cfg.LookupTimeout,
		remoteTimeout: cfg.RemoteTimeout,
		skipCache:     cfg.SkipCache,
	}
	if r.httpClient == nil {
		r.httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	if r.now == nil {
		r.now = time.Now
	}
	if r.lookupTimeout <= 0 {
		r.lookupTimeout = 15 * time.Second
	}
	if r.remoteTimeout <= 0 {
		r.remoteTimeout = 15 * time.Second
	}
	return r
}

// ResolveByHandle is the single entry point. Returns:
//   - Resolved on success
//   - locator.ErrNotFound if the DHT has no record for this handle
//   - ErrTombstoned if the locator record marks the actor as withdrawn
//   - any wrapped verification / network error
//
// fetcher and keys are used only on the local fast-path; remote
// resolution does not consult them. Callers can pass nil for both when
// they only ever resolve foreign handles.
func (r *Resolver) ResolveByHandle(
	ctx context.Context,
	handle string,
	fetcher fedprofile.LocalProfileFetcher,
	keys *authfed.KeyCache,
) (*Resolved, error) {
	canon, err := locator.CanonicalHandle(handle)
	if err != nil {
		return nil, err
	}

	id := fednode.LocalIdentitySnapshot()
	if id.StationPeerID == "" || strings.TrimSpace(id.StationDomain) == "" {
		return nil, ErrLocalIdentityMissing
	}

	// Cache fast-path: serve a fresh remote_cached row without touching
	// the DHT. We skip the cache entirely when the handle is locally
	// owned (the local fast-path is already cheaper than a DB lookup
	// and bypasses pollution risks).
	if !r.skipCache {
		if cached, err := fedcache.Lookup(ctx, canon); err == nil && cached != nil {
			env, locrec := cachedToProtos(cached, canon)
			if env != nil && locrec != nil {
				return &Resolved{Envelope: env, Locator: locrec, IsLocal: false, FromCache: true}, nil
			}
		}
	}

	rec, err := r.lookupLocator(ctx, canon)
	if err != nil {
		return nil, err
	}
	if rec.GetTombstone() {
		// Persist the withdrawal so subsequent lookups don't replay
		// the slow DHT/relay path on a known-dead handle. Best-effort —
		// a write failure does not change the caller-visible outcome.
		_ = fedcache.Upsert(ctx, fedcache.UpsertInput{
			Envelope: tombstoneEnvelope(canon, rec),
			Locator:  rec,
			Now:      r.now(),
		})
		return nil, ErrTombstoned
	}

	if rec.GetHomeStationPeerId() == id.StationPeerID.String() {
		return r.resolveLocal(ctx, canon, rec, fetcher, keys)
	}
	res, err := r.resolveRemote(ctx, canon, rec)
	if err != nil {
		return nil, err
	}
	// Write-through: persist the verified envelope so the next read is
	// served from the cache. Failures are logged, never propagated —
	// the resolver's correctness contract is "verified envelope on
	// success", not "envelope safely cached".
	if cerr := fedcache.Upsert(ctx, fedcache.UpsertInput{
		Envelope: res.Envelope,
		Locator:  res.Locator,
		Now:      r.now(),
	}); cerr != nil {
		logger.Warnf(ctx, "[resolver] cache upsert failed handle=%s err=%v", canon, cerr)
	}
	return res, nil
}

// cachedToProtos rebuilds the resolver-return-shape protos from a
// cached touch_actor row. We deliberately reconstruct rather than
// store the raw envelope/locator bytes to keep the schema small —
// the cache holds the projection a UI will render, not the
// cryptographic transport message.
//
// Signing-related fields (signature / signing_key_pem / signing_key_kid)
// stay zero-valued. Callers that receive a cache hit get a profile they
// can render but MUST NOT re-emit downstream as a signed envelope: the
// home station is the only legitimate signer for a given handle.
func cachedToProtos(c *fedcache.Cached, canon string) (*profilepb.ActorProfileEnvelope, *locatorpb.ActorLocatorRecord) {
	if c == nil || c.Actor == nil {
		return nil, nil
	}
	a := c.Actor

	localPart := canon
	if at := strings.IndexByte(canon, '@'); at >= 0 {
		localPart = canon[:at]
	}

	profile := &modelpb.ActorProfile{
		Username:     localPart,
		Acct:         localPart,
		DisplayName:  a.Name,
		Note:         a.Summary,
		Avatar:       a.Icon,
		Header:       a.Image,
		Url:          a.Url,
		ServerDomain: a.HomeStationDomain,
	}
	if a.PTID != "" {
		profile.PeersTouch = &modelpb.PeersTouchInfo{NetworkId: a.PTID}
	}

	env := &profilepb.ActorProfileEnvelope{
		FederatedHandle:   canon,
		HomeStationPeerId: a.HomeStationPeerID,
		HomeStationDomain: a.HomeStationDomain,
		ExpiresAtUnixMs:   a.CachedUntilUnixMs,
		Profile:           profile,
	}
	rec := &locatorpb.ActorLocatorRecord{
		FederatedHandle:   canon,
		HomeStationPeerId: a.HomeStationPeerID,
		HomeStationDomain: a.HomeStationDomain,
		Seq:               a.LocatorSeq,
	}
	return env, rec
}

// tombstoneEnvelope synthesises a placeholder envelope for cache
// upsert when the locator returns a withdrawal. We do not have a
// signed envelope from the home station here (tombstones do not carry
// profile content), so the row is stored with cached_until=0 to force
// re-resolution on next access — the upsert exists purely to flip
// visibility to HIDDEN in the local cache so the UI can render the
// "withdrawn" state.
func tombstoneEnvelope(canon string, rec *locatorpb.ActorLocatorRecord) *profilepb.ActorProfileEnvelope {
	return &profilepb.ActorProfileEnvelope{
		FederatedHandle:   canon,
		HomeStationPeerId: rec.GetHomeStationPeerId(),
		HomeStationDomain: rec.GetHomeStationDomain(),
		ExpiresAtUnixMs:   0,
	}
}

func (r *Resolver) lookupLocator(ctx context.Context, canon string) (*locatorpb.ActorLocatorRecord, error) {
	// Phase E.2 readiness gate. We bail BEFORE issuing the DHT
	// GetValue when the routing table has fewer peers than the
	// configured threshold — kad-dht would otherwise burn the full
	// timeout (typically 15s here) on a guaranteed-empty query, and
	// the caller pays that latency for nothing. The gate is owned
	// by the federation package so the bootstrap subserver remains
	// the single source of truth for "do we have peers to ask?".
	if h := fednode.GetRoutingHealth(); !h.Ready {
		return nil, fmt.Errorf("%w: peers=%d/%d connected=%d seeds=%d/%d",
			ErrFederationNotReady, h.PeersInRoutingTable, h.MinDHTPeers,
			h.ConnectedPeers, h.SeedsConnected, h.SeedsConfigured)
	}

	lookupCtx, cancel := context.WithTimeout(ctx, r.lookupTimeout)
	defer cancel()
	lookup := locator.NewLookup(locator.LookupConfig{})
	rec, err := lookup.GetByHandle(lookupCtx, canon)
	if err != nil {
		// kad-DHT does not implement a negative-cache protocol —
		// it either returns routing.ErrNotFound (which the locator
		// package translates to ErrNotFound) or it exhausts its
		// peer budget and we trip our own context deadline. Both
		// signals mean the same thing to the caller: "no record
		// for this handle is reachable from us right now". We
		// normalise here so handler-side mapping has exactly one
		// not-found case to switch on.
		if ctxErr := lookupCtx.Err(); errors.Is(ctxErr, context.DeadlineExceeded) {
			return nil, fmt.Errorf("resolver: locator: %w", locator.ErrNotFound)
		}
		return nil, fmt.Errorf("resolver: locator: %w", err)
	}
	return rec, nil
}

// resolveLocal builds the envelope from the in-process DB without going
// over the network. It still signs (and re-verifies) so callers do not
// need a special "is_local" branch in their consumer code.
func (r *Resolver) resolveLocal(
	ctx context.Context,
	canon string,
	rec *locatorpb.ActorLocatorRecord,
	fetcher fedprofile.LocalProfileFetcher,
	keys *authfed.KeyCache,
) (*Resolved, error) {
	if fetcher == nil {
		return nil, errors.New("resolver: local fast-path requested but fetcher missing")
	}
	if keys == nil {
		return nil, errors.New("resolver: local fast-path requested but key cache missing")
	}

	env, _, err := fedprofile.Build(ctx, fedprofile.BuildInput{
		Handle:  canon,
		Fetcher: fetcher,
		Keys:    keys,
		Now:     r.now,
	})
	if err != nil {
		return nil, fmt.Errorf("resolver: local build: %w", err)
	}

	if vErr := fedprofile.Verify(env, fedprofile.VerifyOptions{
		ExpectedHandle:        canon,
		ExpectedSigningKeyPEM: rec.GetSigningKeyPem(),
		Now:                   r.now(),
	}); vErr != nil {
		return nil, fmt.Errorf("resolver: local verify: %w", vErr)
	}

	return &Resolved{Envelope: env, Locator: rec, IsLocal: true}, nil
}

// relayMountMatches reports whether `localBase` appears in the
// locator-advertised mount list. Comparison is trailing-slash-
// tolerant — the locator hook publishes the trimmed form, but a
// future relay-client implementation that publishes its own mount
// list might not be as careful, so we trim both sides at compare
// time. Case-sensitive: relay base URLs are URL-typed strings, and
// the host portion is the only part that's case-insensitive in
// strict RFC reading; in practice all our relays normalize to
// lowercase host so an EqualFold here would buy nothing.
func relayMountMatches(mounts []string, localBase string) bool {
	want := strings.TrimRight(strings.TrimSpace(localBase), "/")
	if want == "" {
		return false
	}
	for _, m := range mounts {
		if strings.TrimRight(strings.TrimSpace(m), "/") == want {
			return true
		}
	}
	return false
}

// resolveRemote forwards GET /actor/federation/profile?handle=<canon>
// through the local relay-client. The resolver does not dial the home
// station directly: locator.proto's contract is that all federation
// traffic flows through a relay so NAT-bound stations remain reachable.
func (r *Resolver) resolveRemote(
	ctx context.Context,
	canon string,
	rec *locatorpb.ActorLocatorRecord,
) (*Resolved, error) {
	rc := fednode.RelayClient()
	if rc == nil {
		return nil, ErrRelayUnavailable
	}
	base := strings.TrimRight(rc.BaseURL(), "/")
	if base == "" {
		return nil, ErrRelayUnavailable
	}
	token := rc.Token()
	if token == "" {
		return nil, ErrRelayUnavailable
	}

	// Tier B2 — soft hint. The locator record can advertise the
	// relay base-URLs the home station publishes through. If our
	// local relay's base does NOT appear in that list, our forward
	// is at the mercy of relay-to-relay federation (not yet
	// implemented) and most likely will fail with 404 at the relay's
	// mount table.
	//
	// We attempt the forward anyway — the proto explicitly marks
	// inbox_relay_mounts as a hint, and the relay's live mount table
	// is the authoritative answer. A misconfigured but recoverable
	// hint must not turn into a hard outage. Log loudly so an
	// operator sees the cross-relay split during testing.
	if mounts := rec.GetInboxRelayMounts(); len(mounts) > 0 && !relayMountMatches(mounts, base) {
		logger.Warnf(ctx,
			"[resolver] handle=%s home_relays=%v local_relay=%s no overlap; "+
				"attempting forward via local relay, expect 404 if relays do not federate",
			canon, mounts, base)
	}

	target := fmt.Sprintf("%s/relay/forward/%s/actor/federation/profile?handle=%s",
		base,
		url.PathEscape(rec.GetHomeStationPeerId()),
		url.QueryEscape(canon),
	)

	reqCtx, cancel := context.WithTimeout(ctx, r.remoteTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("resolver: build forward request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("resolver: forward GET: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("resolver: read forward body: %w", err)
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("resolver: home station returned 404 for %s", canon)
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("resolver: forward status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if len(body) == 0 {
		return nil, ErrEmptyResponse
	}

	env := &profilepb.ActorProfileEnvelope{}
	if err := protojson.Unmarshal(body, env); err != nil {
		return nil, fmt.Errorf("resolver: parse envelope: %w", err)
	}

	if vErr := fedprofile.Verify(env, fedprofile.VerifyOptions{
		ExpectedHandle:        canon,
		ExpectedSigningKeyPEM: rec.GetSigningKeyPem(),
		Now:                   r.now(),
	}); vErr != nil {
		logger.Warnf(ctx, "[resolver] envelope verify failed handle=%s err=%v", canon, vErr)
		return nil, fmt.Errorf("resolver: verify envelope: %w", vErr)
	}

	return &Resolved{Envelope: env, Locator: rec, IsLocal: false}, nil
}
