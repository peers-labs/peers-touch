# Execution Plan — Phase 3: Delivery & Real-time

> Integrates the notification module with the existing EventSystem for real-time delivery, and wires the production pipeline from source SubServers.

---

## 1. Objective

- Add `notification.*` event types to EventSystem
- Implement event publishing in the notification production pipeline
- Wire `notification.Produce()` calls into source SubServers (social, friend_chat, group_chat)
- Verify end-to-end: source action → notification created → SSE event pushed

---

## 2. Dependency

- Phase 1 completed (Proto + domain model)
- Phase 2 completed (Storage + SubServer skeleton)

---

## 3. Architectural Context

This phase implements **Online Delivery** (Architecture §7.2) and wires the **Integration Contract** (Architecture §5.6).

Key architectural constraints:

- **EventSystem reuse** (§3.3): Notification does not build a parallel transport. SSE delivery flows through the existing `DeliveryRouter` → `ConnectionHub` → SSE infrastructure.
- **Fire-and-forget production** (§3.3): `notification.Produce()` never returns an error to the calling SubServer. Notification failure must not block business operations.
- **Offline catch-up** (§7.3): No additional offline handling needed — `DeliveryRouter.Route()` always persists to Broker, so `notification.created` events are automatically available via SSE catch-up and `POST /events/pull`.

---

## 4. Tasks

### 4.1 Add Event Type Constants

**File**: `apps/station/frame/core/event/types.go`

Add to the existing constants block:

```go
EventNotificationCreated      EventType = "notification.created"
EventNotificationRead         EventType = "notification.read"
EventNotificationDeleted      EventType = "notification.deleted"
EventNotificationCountUpdated EventType = "notification.count.updated"
```

### 4.2 Add Event Payload Types

**File**: `apps/station/frame/core/event/types.go`

```go
type NotificationCreatedPayload struct {
    NotificationID string `json:"notificationId"`
    Type           int32  `json:"type"`
    Category       int32  `json:"category"`
    ActorID        string `json:"actorId"`
    TargetType     string `json:"targetType,omitempty"`
    TargetID       string `json:"targetId,omitempty"`
    Title          string `json:"title"`
    Body           string `json:"body,omitempty"`
    GroupKey       string `json:"groupKey,omitempty"`
    SoundEnabled   bool   `json:"soundEnabled"`
}

type NotificationCountPayload struct {
    TotalUnread int32           `json:"totalUnread"`
    ByCategory  map[int32]int32 `json:"byCategory"`
}
```

The `SoundEnabled` field in `NotificationCreatedPayload` is set by `Service.Produce()` from the recipient's preference check, enabling clients to decide sound playback without a separate preference lookup (Architecture §8.5).

### 4.3 Add Global Convenience Functions

**File**: `apps/station/frame/core/event/event.go`

```go
func PublishNotificationCreated(recipientID string, payload NotificationCreatedPayload) error {
    es := GetGlobalEventSystem()
    if es == nil {
        return nil
    }
    return es.Router.PublishEvent(
        context.Background(),
        EventNotificationCreated,
        payload.ActorID,
        recipientID,
        payload.NotificationID,
        ScopeActor,
        payload,
    )
}

func PublishNotificationCountUpdated(actorID string, payload NotificationCountPayload) error {
    es := GetGlobalEventSystem()
    if es == nil {
        return nil
    }
    return es.Router.PublishEvent(
        context.Background(),
        EventNotificationCountUpdated,
        actorID,
        actorID,
        "",
        ScopeActor,
        payload,
    )
}
```

### 4.4 Implement Production Pipeline Event Publishing

In `application/service.go`, the `Produce` method publishes events after persistence. This implements the full production pipeline (Architecture §5.5):

```go
func (s *Service) Produce(ctx context.Context, params domain.ProduceParams) error {
    // 1. Self-notification guard
    if params.ActorID == params.RecipientID {
        return nil
    }

    // 2. Check preference
    prefs, err := s.repo.GetPreferences(params.RecipientID)
    soundEnabled := true
    if err == nil {
        categoryPref := findPrefByCategory(prefs, params.Category)
        if categoryPref != nil {
            if !categoryPref.Enabled {
                return nil
            }
            soundEnabled = categoryPref.SoundEnabled
        }
    }

    // 3. Rate limit check (see Phase 5 for implementation)

    // 4. Deduplication
    exists, err := s.repo.CheckDuplicate(
        params.RecipientID, params.ActorID,
        int32(params.Type), params.TargetID,
    )
    if err == nil && exists {
        return nil
    }

    // 5. Generate notification entity
    notification := buildNotification(params)

    // 6. Persist to DB + increment counter (single transaction)
    if err := s.repo.Create(notification); err != nil {
        return err
    }

    // 7. Publish notification.created event
    event.PublishNotificationCreated(params.RecipientID, event.NotificationCreatedPayload{
        NotificationID: notification.ID,
        Type:           int32(params.Type),
        Category:       int32(params.Category),
        ActorID:        params.ActorID,
        TargetType:     params.TargetType,
        TargetID:       params.TargetID,
        Title:          params.Title,
        Body:           params.Body,
        GroupKey:       notification.GroupKey,
        SoundEnabled:   soundEnabled,
    })

    // 8. Publish notification.count.updated event
    counter, _ := s.repo.GetCounter(params.RecipientID)
    event.PublishNotificationCountUpdated(params.RecipientID, event.NotificationCountPayload{
        TotalUnread: counter.TotalUnread,
        ByCategory:  counterToMap(counter),
    })

    return nil
}
```

Similarly, `MarkRead`, `MarkAllRead`, and `Delete` publish count update events after their operations.

### 4.5 Wire Source SubServers

#### Social SubServer

**File**: `apps/station/app/subserver/social/application/post_service.go`

Integration points:

| Action | Where | Notification Type |
|--------|-------|-------------------|
| Post liked | After `likeRepo.Create()` | `NOTIFICATION_TYPE_POST_LIKED` |
| Post commented | After `commentRepo.Create()` | `NOTIFICATION_TYPE_POST_COMMENTED` |
| Post reposted | After repost logic | `NOTIFICATION_TYPE_POST_REPOSTED` |
| User mentioned in post | During post creation | `NOTIFICATION_TYPE_MENTIONED` |

**File**: `apps/station/app/subserver/social/application/relationship_service.go`

| Action | Where | Notification Type |
|--------|-------|-------------------|
| Follow requested | After follow creation | `NOTIFICATION_TYPE_FOLLOW_REQUESTED` |
| Follow accepted | After accept logic | `NOTIFICATION_TYPE_FOLLOW_ACCEPTED` |

Each integration is a single `notification.Produce()` call:

```go
if likerActorID != postAuthorID {
    notification.Produce(ctx, notification.ProduceParams{
        RecipientID: postAuthorID,
        ActorID:     likerActorID,
        Type:        notification.NOTIFICATION_TYPE_POST_LIKED,
        Category:    notification.NOTIFICATION_CATEGORY_SOCIAL,
        TargetType:  "post",
        TargetID:    postID,
    })
}
```

**Self-notification guard**: Always check `actorID != recipientID` before producing. This check is also implemented centrally in `Service.Produce()` (step 1), providing defense in depth.

#### Friend Chat SubServer

**File**: `apps/station/app/subserver/friend_chat/handler.go`

friend_chat uses its own `s.online` map for presence tracking. For chat message notifications, we use EventSystem's `ConnectionHub.IsActorOnline()` — this is the **single source of truth** for whether a user has an active SSE connection.

| Action | When to Notify | Notification Type |
|--------|---------------|-------------------|
| Message sent, recipient offline | `!hub.IsActorOnline(receiverDID)` | `NOTIFICATION_TYPE_FRIEND_MESSAGE` |
| Friend request sent | Always | `NOTIFICATION_TYPE_FRIEND_REQUEST` |
| Friend request accepted | Always | `NOTIFICATION_TYPE_FRIEND_ACCEPTED` |

Integration in `handleSendMessage`:

```go
es := event.GetGlobalEventSystem()
if es != nil && !es.Hub.IsActorOnline(req.ReceiverDid) && subject.ID != req.ReceiverDid {
    notification.Produce(ctx, notification.ProduceParams{
        RecipientID: req.ReceiverDid,
        ActorID:     subject.ID,
        Type:        notification.NOTIFICATION_TYPE_FRIEND_MESSAGE,
        Category:    notification.NOTIFICATION_CATEGORY_CHAT,
        TargetType:  "chat_session",
        TargetID:    req.SessionUlid,
        Title:       "New message",
        Body:        truncateForPreview(req.Content, 100),
    })
}
```

Why only when offline:
- If the recipient has an active SSE connection, `chat.message.appended` events are already delivered in real-time
- The notification persists in DB and will appear in their notification list on next login
- The notification also goes through EventSystem → Broker → SSE catch-up on reconnect

> **Note on friend_chat's own pending system**: The existing `s.pending` map is an independent offline relay mechanism for encrypted chat payloads. The notification system supplements it as a **user-facing alert**, not a replacement for chat payload delivery.

#### Group Chat SubServer

**File**: `apps/station/app/subserver/group_chat/` (relevant service file)

| Action | Where | Notification Type |
|--------|-------|-------------------|
| Group invitation | After invitation creation | `NOTIFICATION_TYPE_GROUP_INVITED` |
| Mentioned in group | During message processing | `NOTIFICATION_TYPE_CHAT_MENTIONED` |

### 4.6 Import Path Management

The source SubServers import only the `domain/producer.go` package:

```go
import notification "github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
```

This is a **thin dependency** — only on the `ProduceParams` struct and `Produce()` function. No dependency on the notification SubServer's internal service, repo, or handler.

---

## 5. Error Handling

Notification production is **fire-and-forget** from the source SubServer's perspective (Architecture §3.3):

- `notification.Produce()` never returns an error to the caller (it logs internally)
- Notification failure must not block the source action
- Errors are logged with context via `frame/core/logger`

---

## 6. Verification

```bash
cd apps/station && go build ./...
cd apps/station && go test ./...
./tooling/scripts/check-go-style.sh
```

End-to-end verification:

1. Start Station
2. Connect an SSE client to `/events/stream` with a valid JWT
3. Perform a "like post" action via the social API
4. Verify:
   - A notification row exists in the `notifications` table
   - The `notification_counters` row for the post author is incremented
   - An SSE event of type `notification.created` is received by the client
   - An SSE event of type `notification.count.updated` is received by the client
5. Verify counter transactional integrity:
   - Kill Station during notification creation → counter must not drift

---

## 7. Deliverables

| Deliverable | Path |
|-------------|------|
| Event type constants | Modified `frame/core/event/types.go` |
| Event convenience functions | Modified `frame/core/event/event.go` |
| Production pipeline with events | `notification/application/service.go` |
| Social integration | Modified `social/application/post_service.go`, `relationship_service.go` |
| Friend chat integration | Modified `friend_chat/application/service.go` |
| Group chat integration | Modified `group_chat/` relevant service |

---

## 8. Next Phase

Phase 4: Client Presentation
