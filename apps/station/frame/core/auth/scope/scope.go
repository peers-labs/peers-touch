// Package scope owns the registry of token issuance scopes.
//
// Every token a subserver mints — whether it is a user-facing
// access JWT, a dashboard admin JWT, or a federation peer JWT —
// belongs to exactly one named scope. The scope's `Policy`
// declares the bounds the framework will enforce on its behalf
// before any cryptographic signing happens:
//
//   - TTLMax           — the longest lifetime any token in this
//     scope may carry. Longer mints refuse
//     with ErrTTLExceedsPolicy.
//   - AudienceRequired — when true, mints without an audience
//     refuse with ErrAudienceRequired.
//   - AllowedClaimKeys — when non-empty, the only custom claim
//     keys the mint will accept; everything
//     else refuses with ErrClaimNotAllowed.
//     Empty means "no custom claims at all" —
//     callers that legitimately need open
//     claim shape must register the wildcard
//     sentinel `AnyClaimKey`.
//
// The registry is **init-time only**. Subservers register their
// scopes inside their `Init()` callback; once any subserver has
// transitioned to Start the registry seals and any further
// `Register` calls panic. This catches the mistake where a
// runtime feature toggle would silently widen what tokens a
// process can issue — token-issuance policy must be readable
// off a static binary, the same way iptables rules must be
// readable off /etc/.
//
// Strict by design (per user lock-in 2026-04-29):
//
//   - Mint against an unregistered scope → ErrUnknownScope (the
//     mint refuses outright; there is no implicit "any scope"
//     fallback).
//   - All policy violations are returned as typed sentinels so
//     the call site can map them to deterministic HTTP codes.
package scope

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// AnyClaimKey is the wildcard sentinel callers may register in
// `Policy.AllowedClaimKeys` when they really do need an open
// claim shape (e.g. an OAuth2 provider that mirrors third-party
// claims). The Mint path treats this as "skip the allow-list
// check entirely" — the policy still applies for TTL and
// audience.
const AnyClaimKey = "*"

// Policy is the static contract a scope advertises to the
// framework. Empty fields have well-defined defaults documented
// per-field; we explicitly DO NOT expose a "permissive" default
// constructor — every consumer is forced to think about what
// they are signing.
type Policy struct {
	// TTLMax is the upper bound on token lifetime. Required:
	// a zero / negative TTLMax is rejected at Register time.
	// Mints that ask for TTL > TTLMax are rejected with
	// ErrTTLExceedsPolicy; mints that ask for TTL <= 0 are
	// clamped UP to TTLMax (the registrant decided the longest
	// safe lifetime; making it the default for "I don't care"
	// callers means the policy is the single source of truth).
	TTLMax time.Duration

	// AudienceRequired, when true, makes a missing or empty
	// `aud` claim a hard failure. Defaults to false because
	// dashboard-admin tokens have no meaningful audience.
	AudienceRequired bool

	// AllowedClaimKeys lists the custom claim keys the mint
	// will accept. Standard registered claims (iss / aud / sub
	// / exp / iat / jti) are always allowed and need not be
	// listed. Empty means "no custom claims at all"; use
	// `[]string{AnyClaimKey}` for the wildcard escape hatch.
	AllowedClaimKeys []string
}

// Scope is the registry record. `Name` is the lookup key that
// callers pass to Mint; `Description` is documentation for the
// audit / dashboard surface.
type Scope struct {
	Name        string
	Policy      Policy
	Description string
}

// Sentinel errors. Each one maps to a distinct misconfiguration
// condition the call site can branch on; collapsing them into
// strings would force string matching at boundaries.
var (
	// ErrUnknownScope is returned when a mint references a
	// scope name no one has registered. Catches typos in
	// `auth.Mint("oss-fed-pul", …)`.
	ErrUnknownScope = errors.New("auth.scope: scope is not registered")

	// ErrTTLExceedsPolicy is returned when the requested TTL
	// is strictly greater than the scope's TTLMax. Per-call
	// TTL of zero is treated as "use the max" and never errors.
	ErrTTLExceedsPolicy = errors.New("auth.scope: requested TTL exceeds policy TTLMax")

	// ErrAudienceRequired is returned when AudienceRequired is
	// true and the mint did not pass a non-empty audience.
	ErrAudienceRequired = errors.New("auth.scope: audience is required by policy")

	// ErrClaimNotAllowed is returned when a custom claim key is
	// not in AllowedClaimKeys and the wildcard sentinel is not
	// registered.
	ErrClaimNotAllowed = errors.New("auth.scope: claim key is not in policy AllowedClaimKeys")

	// ErrRegistrySealed is returned (and panicked, in the
	// MustRegister path) when registration is attempted after
	// the registry has been sealed by Seal(). Tests that need
	// to re-register routinely should call ResetForTest().
	ErrRegistrySealed = errors.New("auth.scope: registry is sealed; register inside Init()")

	// ErrAlreadyRegistered is returned on duplicate scope
	// names. Two subservers must not silently share a scope —
	// the policy unification has to be intentional.
	ErrAlreadyRegistered = errors.New("auth.scope: scope is already registered")

	// ErrInvalidPolicy is returned when the policy itself is
	// malformed (TTLMax <= 0, name empty, etc).
	ErrInvalidPolicy = errors.New("auth.scope: invalid policy")
)

// registry is the process-global scope table. We use a singleton
// so framework code does not have to thread a *Registry through
// every Mint call — token issuance is a cross-cutting concern,
// the same way logging is.
type registry struct {
	mu     sync.RWMutex
	scopes map[string]Scope
	sealed bool
}

var globalRegistry = &registry{scopes: map[string]Scope{}}

// Register validates and stores a scope. Returns:
//
//   - ErrInvalidPolicy if the scope is malformed.
//   - ErrAlreadyRegistered if the same name has been registered.
//   - ErrRegistrySealed if Seal() has been called.
//
// Callers that want a panic-on-failure shape (most subserver
// init code does) should use MustRegister.
func Register(s Scope) error {
	if err := validate(s); err != nil {
		return err
	}
	globalRegistry.mu.Lock()
	defer globalRegistry.mu.Unlock()
	if globalRegistry.sealed {
		return ErrRegistrySealed
	}
	if _, exists := globalRegistry.scopes[s.Name]; exists {
		return fmt.Errorf("%w: %s", ErrAlreadyRegistered, s.Name)
	}
	globalRegistry.scopes[s.Name] = s
	return nil
}

// MustRegister panics on any Register error. The standard shape
// inside subserver `Init()`:
//
//	scope.MustRegister(scope.Scope{
//	    Name:        "oss-federation-pull",
//	    Description: "outbound peer JWT for cross-station file GET",
//	    Policy: scope.Policy{
//	        TTLMax:           60 * time.Second,
//	        AudienceRequired: true,
//	        AllowedClaimKeys: []string{"oss_key"},
//	    },
//	})
func MustRegister(s Scope) {
	if err := Register(s); err != nil {
		panic(fmt.Sprintf("auth.scope: must-register %q: %v", s.Name, err))
	}
}

// Get returns the scope by name. Returns ErrUnknownScope if it
// does not exist. The returned Scope is a value copy so callers
// cannot mutate the registry.
func Get(name string) (Scope, error) {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()
	s, ok := globalRegistry.scopes[name]
	if !ok {
		return Scope{}, fmt.Errorf("%w: %s", ErrUnknownScope, name)
	}
	return s, nil
}

// MustGet is the panic-on-missing variant — useful in tests and
// init-time wiring where the absence of a scope is a programmer
// error, not a runtime condition.
func MustGet(name string) Scope {
	s, err := Get(name)
	if err != nil {
		panic(fmt.Sprintf("auth.scope: must-get %q: %v", name, err))
	}
	return s
}

// Seal freezes the registry. Subsequent Register calls fail
// with ErrRegistrySealed. The framework's main lifecycle
// invokes this once all subservers have transitioned out of
// Init. Idempotent — Seal'ing twice is a no-op.
func Seal() {
	globalRegistry.mu.Lock()
	globalRegistry.sealed = true
	globalRegistry.mu.Unlock()
}

// IsSealed exposes the sealed bit for diagnostics. Tests that
// inspect the registry state use this; production code never
// needs it.
func IsSealed() bool {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()
	return globalRegistry.sealed
}

// ListAll returns a stable-ordered snapshot of every registered
// scope. The dashboard's audit / debug surface uses this; the
// hot mint path does not, so the alloc is acceptable.
func ListAll() []Scope {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()
	out := make([]Scope, 0, len(globalRegistry.scopes))
	for _, s := range globalRegistry.scopes {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// ResetForTest restores the registry to the empty / unsealed
// state. Production code MUST NOT call this; it lives in the
// same file (rather than a `*_test.go`) only because Go's test
// helper export pattern would otherwise force every consumer
// test to import this package via an underscore alias. The name
// is deliberately ugly to discourage accidental use.
func ResetForTest() {
	globalRegistry.mu.Lock()
	globalRegistry.scopes = map[string]Scope{}
	globalRegistry.sealed = false
	globalRegistry.mu.Unlock()
}

// validate enforces the static rules a Scope must satisfy at
// register time. Kept private so the only way to inject a
// malformed scope is to bypass the package — the registry trusts
// its own contents after this passes.
func validate(s Scope) error {
	name := strings.TrimSpace(s.Name)
	if name == "" {
		return fmt.Errorf("%w: name is empty", ErrInvalidPolicy)
	}
	if name != s.Name {
		// Catch leading / trailing whitespace at registration
		// time rather than letting it sneak through into Get
		// lookups where the trimming would have to be applied
		// at every call site.
		return fmt.Errorf("%w: name has surrounding whitespace", ErrInvalidPolicy)
	}
	if s.Policy.TTLMax <= 0 {
		return fmt.Errorf("%w: TTLMax must be > 0", ErrInvalidPolicy)
	}
	for _, k := range s.Policy.AllowedClaimKeys {
		if k == "" {
			return fmt.Errorf("%w: AllowedClaimKeys contains empty string", ErrInvalidPolicy)
		}
	}
	return nil
}

// CheckMint applies the policy to a proposed mint. The Mint
// implementation in `auth/federation` and the wrapper code in
// `auth` both call this before doing any signing — keeping the
// policy enforcement here means a future "log every refused
// mint" hook lives in one place.
//
// `requestedTTL` of zero means "use TTLMax" (the canonical
// "I don't care" convention) and is never an error.
//
// `customClaims` may be nil; the check is on key presence, not
// value content.
//
// Returns nil on success, or one of the typed sentinels above.
func CheckMint(scopeName, audience string, requestedTTL time.Duration, customClaims map[string]string) (Scope, error) {
	s, err := Get(scopeName)
	if err != nil {
		return Scope{}, err
	}
	if requestedTTL > s.Policy.TTLMax {
		return s, fmt.Errorf("%w: scope=%s requested=%s max=%s",
			ErrTTLExceedsPolicy, scopeName, requestedTTL, s.Policy.TTLMax)
	}
	if s.Policy.AudienceRequired && strings.TrimSpace(audience) == "" {
		return s, fmt.Errorf("%w: scope=%s", ErrAudienceRequired, scopeName)
	}
	if len(customClaims) > 0 && !allowsAnyClaim(s.Policy.AllowedClaimKeys) {
		allowed := indexClaimKeys(s.Policy.AllowedClaimKeys)
		for k := range customClaims {
			if _, ok := allowed[k]; !ok {
				return s, fmt.Errorf("%w: scope=%s key=%q",
					ErrClaimNotAllowed, scopeName, k)
			}
		}
	}
	return s, nil
}

// EffectiveTTL returns the TTL the mint should actually stamp
// into the token. Implements the "zero = max" convention so
// every consumer derives the same value.
func EffectiveTTL(s Scope, requestedTTL time.Duration) time.Duration {
	if requestedTTL <= 0 {
		return s.Policy.TTLMax
	}
	return requestedTTL
}

func allowsAnyClaim(keys []string) bool {
	for _, k := range keys {
		if k == AnyClaimKey {
			return true
		}
	}
	return false
}

func indexClaimKeys(keys []string) map[string]struct{} {
	out := make(map[string]struct{}, len(keys))
	for _, k := range keys {
		out[k] = struct{}{}
	}
	return out
}
