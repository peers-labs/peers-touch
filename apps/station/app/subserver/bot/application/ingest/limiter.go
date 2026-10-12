package ingest

import (
	"context"
	"sync"
	"time"
)

// ipOverflowPerMinute caps events from a single source IP regardless of how
// many webhook ids it hits. It is a coarse abuse backstop above the per-bot
// bucket.
const ipOverflowPerMinute = 600

type tokenBucket struct {
	tokens   float64
	lastSeen time.Time
}

// MemoryRateLimiter is a process-local two-tier limiter: a per-Bot token
// bucket sized by the registry rate limit and a per-IP overflow bucket.
// Station v1 runs a single authority instance; horizontal scaling would
// replace this with a shared store without touching the port.
type MemoryRateLimiter struct {
	mu   sync.Mutex
	bots map[string]*tokenBucket
	ips  map[string]*tokenBucket
	now  func() time.Time
}

// NewMemoryRateLimiter constructs the in-process limiter.
func NewMemoryRateLimiter(clock Clock) *MemoryRateLimiter {
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	return &MemoryRateLimiter{
		bots: make(map[string]*tokenBucket),
		ips:  make(map[string]*tokenBucket),
		now:  clock,
	}
}

// Allow admits when both the per-bot and per-IP buckets have capacity. The
// returned RetryAfter estimates the time until the per-bot bucket refills.
func (l *MemoryRateLimiter) Allow(
	_ context.Context,
	botPtid, ip string,
	perMinute int,
	now time.Time,
) RateDecision {
	l.mu.Lock()
	defer l.mu.Unlock()

	bucket := l.bots[botPtid]
	if bucket == nil {
		bucket = &tokenBucket{tokens: float64(perMinute), lastSeen: now}
		l.bots[botPtid] = bucket
	}
	botAllowed, botRetry := take(bucket, float64(perMinute), 1, now)

	ipBucket := l.ips[ip]
	if ipBucket == nil {
		ipBucket = &tokenBucket{tokens: float64(ipOverflowPerMinute), lastSeen: now}
		l.ips[ip] = ipBucket
	}
	ipAllowed, _ := take(ipBucket, float64(ipOverflowPerMinute), 1, now)

	if !botAllowed || !ipAllowed {
		return RateDecision{Allowed: false, RetryAfter: botRetry}
	}
	return RateDecision{Allowed: true}
}

// take refills at ratePerMinute and consumes one token.
func take(b *tokenBucket, capacity, cost float64, now time.Time) (bool, time.Duration) {
	if !b.lastSeen.IsZero() && now.After(b.lastSeen) {
		elapsedMinutes := now.Sub(b.lastSeen).Seconds() / 60
		b.tokens += elapsedMinutes * capacity
		if b.tokens > capacity {
			b.tokens = capacity
		}
	}
	if b.tokens >= cost {
		b.tokens -= cost
		b.lastSeen = now
		return true, 0
	}
	deficit := cost - b.tokens
	retrySeconds := int((deficit / capacity * 60) + 0.999)
	if retrySeconds < 1 {
		retrySeconds = 1
	}
	if retrySeconds > 60 {
		retrySeconds = 60
	}
	// Do not refill on a rejected call; lastSeen stays so the next attempt
	// computes the wait from the prior observation.
	return false, time.Duration(retrySeconds) * time.Second
}
