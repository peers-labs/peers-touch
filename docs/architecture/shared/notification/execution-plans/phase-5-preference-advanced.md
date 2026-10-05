# Execution Plan — Phase 5: Preference & Advanced Features

> Implements user notification preferences, rate limiting, notification aggregation display, background cleanup, and system-generated notifications.

---

## 1. Objective

- Implement full preference check pipeline (enable/disable per category)
- Implement rate limiting to prevent notification floods
- Implement notification grouping/aggregation in the list view
- Implement background cleanup for expired notifications
- Add system-generated notifications (welcome, security alerts)
- Performance optimization and monitoring

---

## 2. Dependency

- Phase 1–4 completed

---

## 3. Architectural Context

This phase implements **Operational Constraints** (Architecture §9) and completes the **Production Pipeline** validation checks (Architecture §5.5, steps 2–4).

Key architectural constraints:

- **Preference model** (§9.4): Category-level control with per-type extensibility reserved. Absent preference rows default to "all enabled".
- **Rate limiting** (§9.3): Prevents notification floods. In-memory sliding window counter — not persisted business state.
- **Data retention** (§6.3): Configurable retention period, default 90 days. Only READ/ARCHIVED notifications are eligible; UNREAD are never auto-deleted.

---

## 4. Tasks

### 4.1 Preference Pipeline

The preference check is integrated into `Service.Produce()` (Architecture §5.5, step 2):

```go
func (s *Service) Produce(ctx context.Context, params domain.ProduceParams) error {
    // Step 1: Self-notification guard
    if params.ActorID == params.RecipientID {
        return nil
    }

    // Step 2: Preference check
    prefs, err := s.repo.GetPreferences(params.RecipientID)
    if err != nil {
        // Log error but don't block — default to enabled
    }
    categoryPref := findPrefByCategory(prefs, params.Category)
    if categoryPref != nil && !categoryPref.Enabled {
        return nil
    }

    // Step 2b: Determine sound eligibility
    soundEnabled := true
    if categoryPref != nil {
        soundEnabled = categoryPref.SoundEnabled
    }

    // Step 3: Rate limit check
    if s.rateLimiter.Exceeded(params.RecipientID, params.Category) {
        return nil
    }

    // Step 4: Deduplication
    exists, err := s.repo.CheckDuplicate(
        params.RecipientID, params.ActorID,
        int32(params.Type), params.TargetID,
    )
    if err == nil && exists {
        return nil
    }

    // Step 5-9: Create, persist, publish...
}
```

Default behavior when no preference row exists: **all categories enabled, sound enabled**. Preference rows are only created when a user explicitly changes a setting.

### 4.2 Rate Limiting

**New file**: `apps/station/app/subserver/notification/domain/rate_limiter.go`

Implements the rate limiting constraints from Architecture §9.3:

```go
type RateLimiter struct {
    mu       sync.Mutex
    windows  map[string]*slidingWindow
    config   RateLimitConfig
}

type RateLimitConfig struct {
    PerRecipientPerMinute int `yaml:"per_recipient_per_minute" default:"60"`
    PerCategoryPerMinute  int `yaml:"per_category_per_minute" default:"30"`
    PushPerHour           int `yaml:"push_per_hour" default:"30"`
}

func (r *RateLimiter) Exceeded(recipientID string, category NotificationCategory) bool {
    r.mu.Lock()
    defer r.mu.Unlock()

    recipientKey := "r:" + recipientID
    if r.checkAndIncrement(recipientKey, time.Minute, r.config.PerRecipientPerMinute) {
        return true
    }

    categoryKey := fmt.Sprintf("rc:%s:%d", recipientID, category)
    return r.checkAndIncrement(categoryKey, time.Minute, r.config.PerCategoryPerMinute)
}
```

Uses in-memory sliding window counters. No persistence needed — rate limits are transient safety bounds.

### 4.3 Notification Aggregation

Aggregation is implemented in the `ListGrouped` repository method:

```sql
SELECT
    group_key,
    type,
    category,
    target_type,
    target_id,
    MAX(title) AS title,
    COUNT(*) AS count,
    ARRAY_AGG(DISTINCT actor_id ORDER BY actor_id) AS actor_ids,
    MAX(created_at) AS updated_at
FROM notifications
WHERE recipient_id = ?
  AND status = 1  -- UNREAD
GROUP BY group_key, type, category, target_type, target_id
ORDER BY updated_at DESC
LIMIT ? OFFSET ?
```

The response also includes the `latest` notification (the most recent one in the group) for display purposes.

#### Client Display Rules

| Group Count | Display |
|-------------|---------|
| 1 | Show as individual notification |
| 2-3 | "Alice and Bob liked your post" |
| 4+ | "Alice, Bob and 2 others liked your post" |

### 4.4 Background Cleanup

Implemented in `SubServer.Start()`, using the configurable retention period (Architecture §6.3):

```go
func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
    s.status = server.StatusRunning

    cleanupCtx, cancel := context.WithCancel(ctx)
    s.cancel = cancel

    retentionDays := s.config.RetentionDays
    if retentionDays <= 0 {
        retentionDays = 90
    }

    go func() {
        ticker := time.NewTicker(24 * time.Hour)
        defer ticker.Stop()
        for {
            select {
            case <-cleanupCtx.Done():
                return
            case <-ticker.C:
                retention := time.Duration(retentionDays) * 24 * time.Hour
                deleted, err := s.repo.CleanupExpired(retention, []int32{
                    int32(domain.StatusRead),
                    int32(domain.StatusArchived),
                })
                if err != nil {
                    s.logger.Error(cleanupCtx, "notification cleanup failed",
                        "error", err)
                } else if deleted > 0 {
                    s.logger.Info(cleanupCtx, "notification cleanup completed",
                        "deleted", deleted)
                }
            }
        }
    }()

    return nil
}
```

Cleanup rules:

| Status | Retention Period | Action |
|--------|-----------------|--------|
| UNREAD | Unlimited | Never auto-deleted |
| READ | Configurable (default 90 days) | Hard delete after TTL |
| ARCHIVED | Configurable (default 90 days) | Hard delete after TTL |

### 4.5 System Notifications

System notifications are produced by the Station framework, not by user actions:

#### Welcome Notification

Triggered in the actor registration flow:

```go
notification.Produce(ctx, notification.ProduceParams{
    RecipientID: newActorID,
    ActorID:     "system",
    Type:        notification.NOTIFICATION_TYPE_WELCOME,
    Category:    notification.NOTIFICATION_CATEGORY_SYSTEM,
    Title:       "Welcome to Peers-Touch",
    Body:        "Your account has been created successfully.",
})
```

#### Security Alert

Triggered on suspicious activity:

```go
notification.Produce(ctx, notification.ProduceParams{
    RecipientID: actorID,
    ActorID:     "system",
    Type:        notification.NOTIFICATION_TYPE_SECURITY_ALERT,
    Category:    notification.NOTIFICATION_CATEGORY_SYSTEM,
    Title:       "New login detected",
    Body:        "A new login was detected from ...",
    Metadata:    map[string]string{"device": deviceInfo, "ip": ipAddr},
})
```

### 4.6 Performance Monitoring

Add observability to the notification SubServer:

| Metric | Type | Description |
|--------|------|-------------|
| `notification.produced.total` | Counter | Total notifications produced |
| `notification.produced.by_category` | Counter (labeled) | Produced count per category |
| `notification.dedup.skipped` | Counter | Deduplicated (skipped) count |
| `notification.preference.blocked` | Counter | Blocked by preference count |
| `notification.rate_limit.blocked` | Counter | Blocked by rate limit count |
| `notification.cleanup.deleted` | Counter | Cleanup deleted count |
| `notification.delivery.latency_ms` | Histogram | Time from Produce() to SSE push |
| `notification.api.latency_ms` | Histogram | API endpoint response times |

These metrics are logged via `frame/core/logger` with structured fields.

### 4.7 Desktop Preference UI

**Component**: `NotificationSettings`

```
┌─────────────────────────────────────────────────┐
│  Notification Settings                          │
├─────────────────────────────────────────────────┤
│                                                 │
│  Social Notifications                           │
│  ┌─────────────────────────────────┐            │
│  │ Enabled           [✓]          │            │
│  │ Push Notification  [✓]          │            │
│  │ Sound             [✓]          │            │
│  └─────────────────────────────────┘            │
│                                                 │
│  Chat Notifications                             │
│  ┌─────────────────────────────────┐            │
│  │ Enabled           [✓]          │            │
│  │ Push Notification  [✓]          │            │
│  │ Sound             [✓]          │            │
│  └─────────────────────────────────┘            │
│                                                 │
│  System Notifications                           │
│  ┌─────────────────────────────────┐            │
│  │ Enabled           [✓]          │            │
│  │ Push Notification  [ ]          │            │
│  │ Sound             [ ]          │            │
│  └─────────────────────────────────┘            │
│                                                 │
│  Task Notifications                             │
│  ┌─────────────────────────────────┐            │
│  │ Enabled           [✓]          │            │
│  │ Push Notification  [✓]          │            │
│  │ Sound             [✓]          │            │
│  └─────────────────────────────────┘            │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 5. Verification

### Preference

1. Disable "Social" category via API
2. Trigger a post like → no notification created
3. Re-enable "Social" category
4. Trigger a post like → notification created normally

### Sound Preference

1. Disable `sound_enabled` for "Chat" category via `POST /notification/preferences`
2. Trigger a chat friend request → notification created, but `soundEnabled: false` in SSE payload
3. Desktop: verify no sound plays for that notification
4. Re-enable `sound_enabled` for "Chat" → verify sound plays on next notification

### Rate Limiting

1. Send 70 notifications to the same recipient within 1 minute
2. Verify first 60 are created, remaining 10 are silently dropped
3. Verify rate limit counter resets after the minute window

### Aggregation

1. Have 5 different users like the same post
2. Call `GET /notification/grouped`
3. Verify single group with `count=5` and `actor_ids` containing all 5 actors

### Cleanup

1. Create test notifications with old `created_at` timestamps
2. Mark them as READ
3. Trigger cleanup (or wait for the timer)
4. Verify they are deleted from the database

### System Notifications

1. Register a new actor
2. Verify a "Welcome" notification exists for that actor

---

## 6. Deliverables

| Deliverable | Description |
|-------------|-------------|
| Preference pipeline | Integrated into `Service.Produce()` with `sound_enabled` check |
| Rate limiter | In-memory sliding window rate limiter in `domain/rate_limiter.go` |
| Aggregation query | `repo.ListGrouped()` with GROUP BY |
| Background cleanup | goroutine in `SubServer.Start()` with configurable retention |
| System notification hooks | Welcome, security alert integration points |
| Monitoring metrics | Structured logging for all key operations |
| Desktop preference UI | NotificationSettings component with sound toggle per category |

---

## 7. Next Phase

Phase 6: Push Gateway
