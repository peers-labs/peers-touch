package federation

import (
	"context"
	"errors"
	"sync"
	"time"
)

// DefaultKeyCacheRecheckTTL is the canonical recheck interval
// the cache uses to detect a dashboard-driven rotation. 30s is
// well inside the documented 24h dual-sign grace window so a
// rotation is visible to outbound mints long before the prev
// row would be finalised.
const DefaultKeyCacheRecheckTTL = 30 * time.Second

// KeyCache is the in-process wrapper every Mint call goes
// through. It owns three responsibilities the bare KeyStore does
// not:
//
//  1. Lazy auto-generate on first boot. A freshly-bootstrapped
//     station has no row in `auth_local_keys.current`; the cache
//     calls MintLocalKey + KeyStore.PutCurrent once, transparent
//     to the caller. Concurrent first-callers race only on the
//     once.Do gate.
//
//  2. Sticky-error semantics on the load path. A KV outage at
//     boot must NOT silently retry on every mint — failure
//     surfaces as the cached error until ResetForTest is called.
//
//  3. Bounded staleness vs. the persisted current-kid. After
//     `recheckTTL` has elapsed since the last successful peek,
//     the cache reads just the current-kid (one indexed lookup),
//     compares it to the cached kid, and reloads the full key
//     iff it differs. A reload failure leaves the cache as-is —
//     the caller keeps minting against the previous-but-still-
//     valid key until the next successful peek.
type KeyCache struct {
	store      KeyStore
	recheckTTL time.Duration
	clock      func() time.Time

	once sync.Once
	mu   sync.RWMutex
	key  *LocalKey
	err  error

	lastCheckedAt time.Time
}

// KeyCacheOption is the functional-options shape used by
// NewKeyCache. The defaults are: recheckTTL =
// DefaultKeyCacheRecheckTTL, clock = time.Now.
type KeyCacheOption func(*KeyCache)

// WithRecheckTTL overrides the default recheckTTL. Passing 0
// disables periodic rechecks entirely (the cache only loads
// once); useful for tests that want strict determinism.
func WithRecheckTTL(d time.Duration) KeyCacheOption {
	return func(c *KeyCache) { c.recheckTTL = d }
}

// WithClock overrides time.Now. Test-only seam.
func WithClock(fn func() time.Time) KeyCacheOption {
	return func(c *KeyCache) { c.clock = fn }
}

// NewKeyCache builds a KeyCache around the supplied KeyStore.
// The first Get() call lazily loads (or generates) the keypair.
func NewKeyCache(store KeyStore, opts ...KeyCacheOption) *KeyCache {
	c := &KeyCache{
		store:      store,
		recheckTTL: DefaultKeyCacheRecheckTTL,
		clock:      time.Now,
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Get returns the currently-active LocalKey. The hot path is
// lock-free reads of the cached pointer; the slow path is
// limited to a single indexed kid-probe per recheckTTL window.
//
// Errors from the initial load are sticky: a sticky error is
// returned on every call until ResetForTest restores the cache.
// This is deliberate — a corrupt PEM at boot is an operator
// problem, not something to silently retry on every mint.
func (c *KeyCache) Get(ctx context.Context) (*LocalKey, error) {
	c.once.Do(func() {
		k, err := c.loadOrGenerate(ctx)
		c.mu.Lock()
		c.key, c.err = k, err
		c.lastCheckedAt = c.clock()
		c.mu.Unlock()
	})

	c.mu.RLock()
	cached, cachedErr, lastChecked, ttl := c.key, c.err, c.lastCheckedAt, c.recheckTTL
	c.mu.RUnlock()

	if cachedErr != nil {
		return cached, cachedErr
	}
	if ttl <= 0 || c.clock().Sub(lastChecked) < ttl {
		return cached, nil
	}

	currentKid, err := c.store.LoadCurrentKid(ctx)
	now := c.clock()
	if err != nil || currentKid == "" || cached == nil || currentKid == cached.Kid {
		c.mu.Lock()
		c.lastCheckedAt = now
		c.mu.Unlock()
		return cached, nil
	}

	fresh, err := c.store.Load(ctx, SlotCurrent)
	if err != nil || fresh == nil {
		c.mu.Lock()
		c.lastCheckedAt = now
		c.mu.Unlock()
		return cached, nil
	}
	c.mu.Lock()
	c.key = fresh
	c.lastCheckedAt = now
	c.mu.Unlock()
	return fresh, nil
}

// loadOrGenerate is the once-Do body. Strict: a corrupt persisted
// row aborts (rather than silently regenerating, which would
// invalidate every previously-minted token still in flight); a
// missing row triggers MintLocalKey + PutCurrent.
func (c *KeyCache) loadOrGenerate(ctx context.Context) (*LocalKey, error) {
	k, err := c.store.Load(ctx, SlotCurrent)
	if err == nil {
		return k, nil
	}
	if !errors.Is(err, ErrNoLocalKey) {
		return nil, err
	}

	fresh, err := MintLocalKey(c.clock())
	if err != nil {
		return nil, err
	}
	if err := c.store.PutCurrent(ctx, fresh); err != nil {
		return nil, err
	}
	return fresh, nil
}

// Store returns the underlying KeyStore. Exposed so background
// workers (rotation finalizer, audit / dashboard surfaces) can
// reach the persistence boundary without each caller re-wiring a
// second store handle.
func (c *KeyCache) Store() KeyStore {
	return c.store
}

// ResetForTest clears the cache's once-state so a subsequent
// Get() reruns load-or-generate. Production code MUST NOT call
// this; the ugly name is intentional. Tests use it between
// scenarios.
func (c *KeyCache) ResetForTest() {
	c.mu.Lock()
	c.once = sync.Once{}
	c.key = nil
	c.err = nil
	c.lastCheckedAt = time.Time{}
	c.mu.Unlock()
}

// ─── node-level singleton ────────────────────────────────────────────
//
// A station hosts exactly one federation persona — there is only one
// `auth_local_keys.current` row, only one rotation timeline, and only
// one set of remotes that need to observe a kid flip in bounded time.
// Constructing a fresh KeyCache per consumer (oss subserver, locator
// publisher, profile builder) therefore creates needless fan-out:
//
//   • Each instance holds its own `recheckTTL` ticker, so a rotation
//     becomes visible to consumers at staggered times (drift up to
//     30s × N caches), widening the window in which two stations can
//     mint with different kids for the same logical "current".
//   • Each instance independently runs the `loadOrGenerate` once-Do
//     gate; a freshly-bootstrapped station can race three concurrent
//     MintLocalKey + PutCurrent calls if all three consumers Init()
//     in parallel. The KeyStore implementation handles the conflict
//     (last-writer-wins on `current_kid`), but it leaves orphaned
//     LocalKey rows in the audit-history table.
//
// Singleton() collapses these to one cache + one rotation fan-out.
// All production callers MUST go through the accessor; tests that
// need isolation build a fresh KeyCache directly via NewKeyCache.

var (
	singletonMu       sync.Mutex
	singletonInstance *KeyCache
	singletonStore    KeyStore
)

// SetSingletonStore overrides the KeyStore the singleton wraps. Must
// be called before the first Singleton() invocation; after that, the
// store is locked into the constructed cache and re-setting has no
// effect on the live instance (use ResetSingletonForTest first).
//
// Production code does not call this — the default
// (NewKeyStoreGORM("")) is correct for every deployment shape we
// ship: federation keys live on the default RDS, not on a
// subserver-bound RDS. The hook exists so test code that already
// owns a *gorm.DB or an in-memory KeyStore can inject it without
// touching every consumer.
func SetSingletonStore(store KeyStore) {
	singletonMu.Lock()
	defer singletonMu.Unlock()
	singletonStore = store
}

// Singleton returns the process-wide federation KeyCache. Lazily
// constructed on first call.
//
// Concurrency: serialised on `singletonMu`; the lock is held only
// for the construction window, not for subsequent reads of the
// returned pointer. Callers cache the *KeyCache locally — the
// pointer is stable for the lifetime of the process.
func Singleton() *KeyCache {
	singletonMu.Lock()
	defer singletonMu.Unlock()
	if singletonInstance != nil {
		return singletonInstance
	}
	store := singletonStore
	if store == nil {
		// Empty dbName resolves to the default RDS via store.GetRDS,
		// which is where `auth_local_keys` lives. Subserver-bound RDS
		// names are intentionally NOT honoured here — the federation
		// key is a node-level identity, not subserver state.
		store = NewKeyStoreGORM("")
	}
	singletonInstance = NewKeyCache(store)
	return singletonInstance
}

// ResetSingletonForTest tears down the singleton so the next
// Singleton() call rebuilds it (using the currently-set store, or
// the default if none was injected). Production code MUST NOT call
// this; the ugly name is intentional and matches KeyCache.ResetForTest.
func ResetSingletonForTest() {
	singletonMu.Lock()
	defer singletonMu.Unlock()
	singletonInstance = nil
	singletonStore = nil
}
