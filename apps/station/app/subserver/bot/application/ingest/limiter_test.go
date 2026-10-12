package ingest

import (
	"context"
	"testing"
	"time"
)

func TestMemoryRateLimiterAdmitsWithinPerBotQuota(t *testing.T) {
	base := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	limiter := NewMemoryRateLimiter(func() time.Time { return base })

	for i := 0; i < 3; i++ {
		decision := limiter.Allow(context.Background(), "ptid:bot", "1.1.1.1", 3, base)
		if !decision.Allowed {
			t.Fatalf("request %d denied within quota", i+1)
		}
	}
	decision := limiter.Allow(context.Background(), "ptid:bot", "1.1.1.1", 3, base)
	if decision.Allowed || decision.RetryAfter <= 0 {
		t.Fatalf("4th request = %+v, want denial with retry-after", decision)
	}
}

func TestMemoryRateLimiterRefillsAcrossTime(t *testing.T) {
	base := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	now := base
	limiter := NewMemoryRateLimiter(func() time.Time { return now })

	limiter.Allow(context.Background(), "ptid:bot", "ip", 60, base)
	now = base.Add(time.Minute)
	if decision := limiter.Allow(context.Background(), "ptid:bot", "ip", 60, now); !decision.Allowed {
		t.Fatal("refilled bucket should admit after one minute")
	}
}

func TestMemoryRateLimiterIPOverflowBucket(t *testing.T) {
	base := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	limiter := NewMemoryRateLimiter(func() time.Time { return base })

	allowed := 0
	for i := 0; i < ipOverflowPerMinute; i++ {
		decision := limiter.Allow(context.Background(), "ptid:bot-a", "2.2.2.2", 100000, base)
		if decision.Allowed {
			allowed++
		}
	}
	if allowed != ipOverflowPerMinute {
		t.Fatalf("allowed = %d, want %d", allowed, ipOverflowPerMinute)
	}
	decision := limiter.Allow(context.Background(), "ptid:bot-b", "2.2.2.2", 100000, base)
	if decision.Allowed {
		t.Fatal("per-IP overflow bucket must cap requests across webhook ids")
	}
}
