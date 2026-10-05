# Peers-Touch Notification Architecture

> Cross-platform notification system architecture for Peers-Touch. Defines the architectural identity, domain model, system structure, storage model, delivery mechanism, push gateway, client presentation boundary, and operational constraints.

---

## 1. Document Scope

This document defines:

- Notification's architectural identity and boundaries within the Peers-Touch system
- Notification domain model and type system
- Notification lifecycle and state machine
- Storage schema and database design
- Delivery architecture (SSE via EventSystem, Broker catch-up, Push Gateway)
- Mobile Push Gateway architecture (UnifiedPush, APNs, FCM); Web Push is deferred
- Station SubServer structure and API surface
- Cross-platform client presentation boundary
- Notification content rendering strategy (i18n)
- Sound notification architecture
- User preference and notification control model
- Operational constraints (deduplication, idempotency, rate limiting)
- Integration contract with existing SubServers

This document does not define:

- Full Go coding standards (see `global/coding-guide/station/`)
- Desktop or Mobile UI implementation details (see platform-layer sources)
- EventSystem internals (see `global/coding-guide/station/event-system.md`)
- SubServer standard (see `station/subserver-standard.md`)
- Cross-station federation protocol (federation delivers remote events locally; notification reacts to local events)

Continue reading:

- Event system guide: `global/coding-guide/station/event-system.md`
- SubServer standard: `station/subserver-standard.md`
- Station-Desktop scope boundary: `architecture/platform/station-desktop-boundary.md`
- Domain model rules: `global/domain-model.md`

---

## 2. Problem Statement

### 2.1 Current Gaps

The current Peers-Touch system has no unified notification mechanism. The following gaps exist:

| Gap | Description |
|-----|-------------|
| No native notification proto | No Peers-Touch native notification model exists |
| Events and notifications conflated | The EventSystem handles real-time transport but has no notion of "notification" as a persistent, user-facing entity |
| No notification classification | No type system to distinguish system alerts, social interactions, chat mentions, task updates |
| No notification state management | No read/unread tracking, no batch operations, no notification lifecycle |
| No user preferences | No ability to mute, filter, or control notification delivery per category |
| No aggregation | Repeated actions (e.g., 10 users liked the same post) are delivered as 10 separate events |

### 2.2 Design Goal

Build a notification system that:

1. Provides a unified, typed notification model (Proto-First)
2. Reuses the existing EventSystem as the real-time delivery transport
3. Persists notifications as first-class entities with lifecycle management
4. Supports cross-platform presentation (Desktop SSE, Mobile push bridge)
5. Allows user-level preference control per notification category
6. Supports notification aggregation for high-frequency social events
7. Integrates with existing SubServers (social, friend_chat, group_chat) with minimal invasion

---

## 3. Architectural Identity

### 3.1 Position in the Three-Tier Architecture

In the Peers-Touch three-tier architecture (Client → Model → Station), Notification is the only subsystem that **spans all three tiers while owning business truth in none of them**.

**Station tier**: Notification is an infrastructure service, not a business domain. Social interactions, chat messages, task states, and follow relationships are owned by their respective domain SubServers (social, friend_chat, group_chat). Notification observes these domains through a single-function integration point (`Produce()`) and generates derived records. This observer relationship establishes a hard architectural constraint: the notification subsystem must be **failure-transparent** to all business domains. If the notification SubServer is unavailable, all business operations — posting, chatting, following, task management — must continue unimpaired.

**Client tier**: Notification is the **cross-domain attention aggregation surface**. It is the only subsystem that legitimately combines signals from Social, Chat, Task, and System domains into a single user-facing stream. This cross-domain aggregation right is what makes Notification architecturally distinct from any single business domain's UI. The delivery channels — SSE, push notifications, sound alerts — are extensions of this aggregation surface across different physical endpoints and connectivity states.

**Business flow**: Notification is an **async side-effect**. Its relationship to business actions is that of echo to action — the action's success or failure does not depend on the echo's delivery. A post-like succeeds regardless of whether the notification was created, delivered, or read. This side-effect nature means notification data is eventually consistent with business state, not transactionally bound to it.

### 3.2 Architectural Boundaries

**What Notification owns:**

- Notification entity lifecycle (create → unread → read → archive → delete)
- Notification persistence and counter management
- Delivery orchestration (SSE event publishing, push dispatch)
- User preference storage for notification control
- Push device registration and channel management
- Notification aggregation and grouping

**What Notification does NOT own:**

| Concern | Owner | Notification's relation |
|---------|-------|------------------------|
| Business domain state (likes, messages, follows) | Domain SubServers (social, friend_chat, etc.) | Observer — reacts to domain actions via `Produce()` |
| Cross-station federation | Station federation layer | Consumer — federation delivers remote events locally; notification sees only local events |
| Client UI rendering | Desktop (React/TS), Mobile (Kotlin/Swift) | Contract provider — defines data shape; client owns rendering and locale |
| Push infrastructure credentials | Station owner | Configuration consumer — reads APNs/FCM delivery credentials and derives the registration-protection key |
| EventSystem transport | Events SubServer / frame layer | Reuser — publishes events through existing SSE + Broker infrastructure |

### 3.3 Design Principles

These principles are derived from Notification's architectural position and govern all technical decisions in this document.

| Principle | Rationale |
|-----------|-----------|
| **Failure transparency** | Notification is an observer, not a participant. Its unavailability must not impact any business operation. `Produce()` returns nil when the producer is uninitialized. |
| **Fire-and-forget production** | Business flow treats notification as a side-effect. `Produce()` is async, non-blocking, and error-tolerant from the caller's perspective. |
| **Station as push gateway** | Peers-Touch is decentralized — no central push relay exists. Each Station instance runs its own push delivery pipeline. |
| **Reconcile-only push payload** | Push carries only bounded notification identity, category, target hint, and timing. It carries no title, body, private content, credentials, read state, or authority truth. |
| **PTID/device-bound registration** | The authenticated PTID and verified device assertion own registration. Request bodies cannot choose actor identity or transfer provider credentials across devices. |
| **Write-only provider credentials** | APNs/FCM/UnifiedPush credentials remain native/Rust in Mobile and AES-256-GCM ciphertext in Station. They never enter Web, readback, errors, or logs. |
| **Client-side presentation ownership** | Rendering, locale-aware text generation, sound playback, and badge management are client concerns. Station provides structured data; clients decide how to present it. |
| **Privacy by default** | Provider payloads contain no notification content even when the provider transport also encrypts the envelope. Full content is always reconciled from Station. |
| **EventSystem reuse** | Notification does not build a parallel transport. SSE delivery, offline persistence, and reconnect catch-up all flow through the existing EventSystem and Broker infrastructure. |

---

## 4. Domain Model

### 4.1 Notification Type System

Notifications are organized into **categories** and **types**. Categories define the top-level grouping; types define the specific trigger.

```
NotificationCategory
├── SOCIAL          — Social interaction notifications
│   ├── notification.social.follow_requested
│   ├── notification.social.follow_accepted
│   ├── notification.social.post_liked
│   ├── notification.social.post_commented
│   ├── notification.social.post_reposted
│   └── notification.social.mentioned
├── CHAT            — Chat-related notifications
│   ├── notification.chat.friend_request
│   ├── notification.chat.friend_accepted
│   ├── notification.chat.friend_message
│   ├── notification.chat.group_invited
│   └── notification.chat.mentioned
├── SYSTEM          — System-level notifications
│   ├── notification.system.welcome
│   ├── notification.system.security_alert
│   ├── notification.system.version_update
│   └── notification.system.maintenance
└── TASK            — Task and activity notifications
    ├── notification.task.assigned
    ├── notification.task.completed
    └── notification.task.reminder
```

### 4.2 Proto Definition

Proto source of truth: `model/domain/notification/notification.proto`

```protobuf
syntax = "proto3";

package peers_touch.model.notification.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/peers-labs/peers-touch/station/frame/touch/model/notification;notification";

// ============================================================================
// Notification Core Model
// ============================================================================

// Notification represents a single notification entity.
// title and body are Station projection text and never enter provider push
// payloads. Rich clients should render locale-aware display text from the
// structured references (type + target_type + target_id + actor_ptid).
message Notification {
  string id = 1;
  string recipient_ptid = 2;
  string actor_ptid = 3;
  NotificationType type = 4;
  NotificationCategory category = 5;
  NotificationStatus status = 6;
  string target_type = 7;
  string target_id = 8;
  string title = 9;
  string body = 10;
  map<string, string> metadata = 11;
  string group_key = 12;
  google.protobuf.Timestamp created_at = 13;
  google.protobuf.Timestamp read_at = 14;
}

// NotificationGroup represents an aggregated notification group.
message NotificationGroup {
  string group_key = 1;
  NotificationType type = 2;
  NotificationCategory category = 3;
  string target_type = 4;
  string target_id = 5;
  string title = 6;
  string body = 7;
  int32 count = 8;
  repeated string actor_ptids = 9;
  Notification latest = 10;
  google.protobuf.Timestamp updated_at = 11;
}

// ============================================================================
// Enums
// ============================================================================

enum NotificationCategory {
  NOTIFICATION_CATEGORY_UNSPECIFIED = 0;
  NOTIFICATION_CATEGORY_SOCIAL = 1;
  NOTIFICATION_CATEGORY_CHAT = 2;
  NOTIFICATION_CATEGORY_SYSTEM = 3;
  NOTIFICATION_CATEGORY_TASK = 4;
}

enum NotificationType {
  NOTIFICATION_TYPE_UNSPECIFIED = 0;

  // Social (100-199)
  NOTIFICATION_TYPE_FOLLOW_REQUESTED = 100;
  NOTIFICATION_TYPE_FOLLOW_ACCEPTED = 101;
  NOTIFICATION_TYPE_POST_LIKED = 102;
  NOTIFICATION_TYPE_POST_COMMENTED = 103;
  NOTIFICATION_TYPE_POST_REPOSTED = 104;
  NOTIFICATION_TYPE_MENTIONED = 105;

  // Chat (200-299)
  NOTIFICATION_TYPE_FRIEND_REQUEST = 200;
  NOTIFICATION_TYPE_FRIEND_ACCEPTED = 201;
  NOTIFICATION_TYPE_FRIEND_MESSAGE = 202;
  NOTIFICATION_TYPE_GROUP_INVITED = 203;
  NOTIFICATION_TYPE_CHAT_MENTIONED = 204;

  // System (300-399)
  NOTIFICATION_TYPE_WELCOME = 300;
  NOTIFICATION_TYPE_SECURITY_ALERT = 301;
  NOTIFICATION_TYPE_VERSION_UPDATE = 302;
  NOTIFICATION_TYPE_MAINTENANCE = 303;

  // Task (400-499)
  NOTIFICATION_TYPE_TASK_ASSIGNED = 400;
  NOTIFICATION_TYPE_TASK_COMPLETED = 401;
  NOTIFICATION_TYPE_TASK_REMINDER = 402;
}

enum NotificationStatus {
  NOTIFICATION_STATUS_UNSPECIFIED = 0;
  NOTIFICATION_STATUS_UNREAD = 1;
  NOTIFICATION_STATUS_READ = 2;
  NOTIFICATION_STATUS_ARCHIVED = 3;
}

// ============================================================================
// User Preference Model
// ============================================================================

// NotificationPreference controls notification behavior per category.
// The type field is reserved for future per-type control granularity.
// Current implementation operates at category level only.
message NotificationPreference {
  string actor_ptid = 1;
  NotificationCategory category = 2;
  bool enabled = 3;
  bool push_enabled = 4;
  bool sound_enabled = 5;
  google.protobuf.Timestamp updated_at = 6;
  NotificationType type = 7; // Reserved: per-type override (future)
}

message NotificationPreferencesSnapshot {
  repeated NotificationPreference preferences = 1;
  uint64 notification_preferences_revision = 2;
}

// ============================================================================
// API Messages
// ============================================================================

// --- List notifications ---
message ListNotificationsRequest {
  NotificationCategory category = 1;
  NotificationStatus status = 2;
  string cursor = 3;
  int32 limit = 4;
}

message ListNotificationsResponse {
  repeated Notification notifications = 1;
  string next_cursor = 2;
  int32 total_count = 3;
  int32 unread_count = 4;
}

// --- List grouped notifications ---
message ListGroupedNotificationsRequest {
  NotificationCategory category = 1;
  string cursor = 2;
  int32 limit = 3;
}

message ListGroupedNotificationsResponse {
  repeated NotificationGroup groups = 1;
  string next_cursor = 2;
}

// --- Mark as read ---
message MarkNotificationsReadRequest {
  repeated string notification_ids = 1;
}

message MarkNotificationsReadResponse {
  int32 updated_count = 1;
}

// --- Mark all as read ---
message MarkAllNotificationsReadRequest {
  NotificationCategory category = 1;
}

message MarkAllNotificationsReadResponse {
  int32 updated_count = 1;
}

// --- Delete notifications ---
message DeleteNotificationsRequest {
  repeated string notification_ids = 1;
}

message DeleteNotificationsResponse {
  int32 deleted_count = 1;
}

// --- Get unread counts ---
message GetUnreadCountsRequest {}

message GetUnreadCountsResponse {
  int32 total = 1;
  map<int32, int32> by_category = 2;
}

// --- Preference ---
message GetNotificationPreferencesRequest {}

message GetNotificationPreferencesResponse {
  reserved 1;
  reserved "preferences";
  NotificationPreferencesSnapshot snapshot = 2;
}

message NotificationPreferencePatch {
  NotificationCategory category = 1;
  bool enabled = 2;
  bool push_enabled = 3;
  bool sound_enabled = 4;
}

message UpdateNotificationPreferencesRequest {
  repeated NotificationPreferencePatch updates = 1;
  uint64 observed_revision = 2;
}

enum NotificationPreferencesUpdateOutcome {
  NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_UNSPECIFIED = 0;
  NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_APPLIED = 1;
  NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_UNCHANGED = 2;
  NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_CONFLICT = 3;
}

message UpdateNotificationPreferencesResponse {
  NotificationPreferencesUpdateOutcome outcome = 1;
  NotificationPreferencesSnapshot snapshot = 2;
}

// ============================================================================
// Mobile Push Registration (MS-D23A)
// ============================================================================

enum PushChannel {
  PUSH_CHANNEL_UNSPECIFIED = 0;
  PUSH_CHANNEL_APNS = 1;
  PUSH_CHANNEL_FCM = 2;
  PUSH_CHANNEL_UNIFIED_PUSH = 3;
}

enum PushEnvironment {
  PUSH_ENVIRONMENT_UNSPECIFIED = 0;
  PUSH_ENVIRONMENT_DEVELOPMENT = 1;
  PUSH_ENVIRONMENT_PRODUCTION = 2;
}

message ActorDeviceRef {
  string actor_ptid = 1;
  string device_id = 2;
}

message ApnsPushBinding {
  bytes token = 1;
  string topic = 2;
}

message FcmPushBinding {
  string token = 1;
}

message UnifiedPushBinding {
  string endpoint = 1;
  bytes p256dh_key = 2;
  bytes auth_secret = 3;
}

// Provider credentials are write-only and never appear in this projection.
message PushRegistration {
  string registration_id = 1;
  ActorDeviceRef actor_device = 2;
  PushChannel channel = 3;
  PushEnvironment environment = 4;
  bytes app_install_epoch_sha256 = 5;
  bytes provider_binding_sha256 = 6; // Station-scoped HMAC fingerprint
  google.protobuf.Timestamp created_at = 7;
  google.protobuf.Timestamp updated_at = 8;
  google.protobuf.Timestamp last_success_at = 9;
}

message RegisterPushDeviceRequest {
  string request_id = 1;
  string device_id = 2;
  uint64 lifecycle_generation = 3;
  bytes app_install_epoch_sha256 = 4;
  PushEnvironment environment = 5;
  oneof provider_binding {
    ApnsPushBinding apns = 6;
    FcmPushBinding fcm = 7;
    UnifiedPushBinding unified_push = 8;
  }
}

enum RegisterPushDeviceOutcome {
  REGISTER_PUSH_DEVICE_OUTCOME_UNSPECIFIED = 0;
  REGISTER_PUSH_DEVICE_OUTCOME_CREATED = 1;
  REGISTER_PUSH_DEVICE_OUTCOME_ROTATED = 2;
  REGISTER_PUSH_DEVICE_OUTCOME_UNCHANGED = 3;
}

message RegisterPushDeviceResponse {
  string request_id = 1;
  RegisterPushDeviceOutcome outcome = 2;
  PushRegistration registration = 3;
}

message UnregisterPushDeviceRequest {
  string request_id = 1;
  string device_id = 2;
  uint64 lifecycle_generation = 3;
  string registration_id = 4;
  bytes app_install_epoch_sha256 = 5;
}

enum UnregisterPushDeviceOutcome {
  UNREGISTER_PUSH_DEVICE_OUTCOME_UNSPECIFIED = 0;
  UNREGISTER_PUSH_DEVICE_OUTCOME_REMOVED = 1;
  UNREGISTER_PUSH_DEVICE_OUTCOME_ALREADY_ABSENT = 2;
}

message UnregisterPushDeviceResponse {
  string request_id = 1;
  UnregisterPushDeviceOutcome outcome = 2;
}

message ListPushDevicesRequest {}

message ListPushDevicesResponse {
  repeated PushRegistration registrations = 1;
}
```

### 4.3 Entity Relationships

```
┌─────────────────────────────────────────────────────┐
│                    Notification                     │
│                                                     │
│  id ─────────────── Primary key (Snowflake)        │
│  recipient_ptid ─── Who receives this notification  │
│  actor_ptid ─────── Who triggered this notification │
│  type ───────────── Specific notification type      │
│  category ───────── Category grouping              │
│  status ─────────── unread / read / archived       │
│  target_type ────── Entity type (post, user, etc.) │
│  target_id ──────── Entity ID                      │
│  group_key ──────── Aggregation key                │
│  created_at ─────── When it was created            │
│  read_at ────────── When it was read               │
└─────────────────────────────────────────────────────┘
         │ N:1                          │ N:1
         ▼                              ▼
┌─────────────────┐          ┌──────────────────────┐
│  Actor (sender)  │          │  Actor (recipient)    │
└─────────────────┘          │                      │
                             │  1:N                  │
                             ▼                      │
                   ┌──────────────────────┐         │
                   │ NotificationPreference│◄────────┘
                   │                      │
                   │  category ── enabled │
                   │  push_enabled       │
                   │  sound_enabled      │
                   └──────────────────────┘
```

### 4.4 Aggregation Model

High-frequency notifications (e.g., post likes) are aggregated by `group_key`.

Group key generation rule:

```
group_key = "{notification_type}:{target_type}:{target_id}"
```

Examples:

| Scenario | group_key |
|----------|-----------|
| Multiple users liked post #123 | `post_liked:post:123` |
| Multiple users commented on post #456 | `post_commented:post:456` |
| Multiple users followed actor #789 | `follow_requested:actor:789` |

Aggregation behavior:

- Each individual notification is still persisted with its own `id`
- Listing with `grouped=true` collapses by `group_key`, returning count + latest actor list
- The latest notification in a group determines the group's display content

### 4.5 Notification Lifecycle

```
                    ┌───────────┐
    trigger event──►│  CREATED   │
                    └─────┬─────┘
                          │
                 preference check
                          │
                    ┌─────▼─────┐
                    │  UNREAD    │◄─── persisted to DB
                    └─────┬─────┘     + pushed via EventSystem
                          │
                   user reads
                          │
                    ┌─────▼─────┐
                    │   READ     │
                    └─────┬─────┘
                          │
                   user archives
                          │
                    ┌─────▼─────┐
                    │ ARCHIVED   │
                    └─────┬─────┘
                          │
                   TTL expires or
                   user deletes
                          │
                    ┌─────▼─────┐
                    │  DELETED   │ (hard delete)
                    └───────────┘
```

### 4.6 Content Strategy

Notification content follows a **structured reference + fallback text** model driven by the client-side presentation ownership principle (§3.3).

**Structured references** (always present): `type`, `category`,
`actor_ptid`, `target_type`, `target_id` — these carry the semantic meaning of
the notification. Rich clients use these to render locale-aware, navigable
display text (e.g., "Alice liked your post" in the user's language, with
"Alice" and "your post" as tappable links).

**Fallback text** (`title`, `body`): server-generated English-language
projection text. Used for:

- Non-rich clients or degraded rendering modes
- Notification list preview before full hydration

Fallback text never enters APNs, FCM, or UnifiedPush payloads. A native client
may display generic OS text such as "New activity" while locked or backgrounded
and renders canonical content only after Station reconciliation.

Content ownership boundary:

| Concern | Owner | Mechanism |
|---------|-------|-----------|
| Structured references | Station (via `Produce()` caller) | Stored in notification entity fields |
| Fallback text | Station (via `Produce()` caller) | `title` + `body` fields |
| Locale-aware display text | Client (Desktop/Mobile) | Client maps `type` + `actor_ptid` + `target` to localized template |
| Provider push envelope | Station Push Gateway | Content-free identity/category/hint/timing envelope |

---

## 5. System Architecture

### 5.1 SubServer Identity

| Attribute | Value |
|-----------|-------|
| Name | `notification` |
| Path | `apps/station/app/subserver/notification/` |
| Type | `SubserverTypeHTTP` |
| Registration | Direct mode — `server.WithSubServer("notification", ...)` in `app/main.go` |
| Database | Default RDS via `store.GetRDS(ctx)` |

### 5.2 Directory Structure

```
apps/station/app/subserver/notification/
├── subserver.go              # SubServer lifecycle (Init/Start/Stop)
├── handler.go                # HTTP route registration + handler methods
├── application/
│   └── service.go            # Business orchestration: produce, list, read, delete, count
├── domain/
│   ├── types.go              # Domain objects: Notification, Counter, Preference
│   ├── producer.go           # NotificationProducer: global convenience for producing notifications
│   └── converter.go          # Proto ⟷ Domain ⟷ Model conversion
├── infrastructure/
│   ├── repo.go               # Notification/preference/push registration persistence
│   └── push_crypto.go        # AES-GCM credential protection + HMAC fingerprint
└── push/                     # Provider dispatch adapters; later delivery slice
    ├── gateway.go            # PushGateway orchestration
    ├── channel.go            # PushChannel interface
    ├── channel_unifiedpush.go
    ├── channel_apns.go
    └── channel_fcm.go
```

### 5.3 Lifecycle

```go
func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
    // 1. Initialize JWT wrapper
    // 2. Get database: store.GetRDS(ctx)
    // 3. AutoMigrate notification tables (notifications, notification_counters,
    //    notification_preferences, notification_push_registrations,
    //    notification_push_mutation_receipts)
    // 4. Create infrastructure.GormRepo
    // 5. Create application.Service
    // 6. Initialize PushGateway with configured channels
    // 7. Register NotificationProducer as global singleton
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
    // 1. Set status to Running
    // 2. Start background cleanup goroutine (daily, purge expired notifications)
}

func (s *subServer) Stop(ctx context.Context) error {
    // 1. Cancel background goroutine
    // 2. Set status to Stopped
}
```

### 5.4 NotificationProducer

The `NotificationProducer` is a global singleton that other SubServers use to create notifications. This follows the same pattern as `event.PublishChatMessage` — a global convenience function that requires no direct dependency on the notification SubServer.

```go
// domain/producer.go

type ProduceParams struct {
    RecipientID string
    ActorID     string
    Type        NotificationType
    Category    NotificationCategory
    TargetType  string
    TargetID    string
    Title       string
    Body        string
    Metadata    map[string]string
}

type Producer interface {
    Produce(ctx context.Context, params ProduceParams) error
}

var globalProducer Producer

func SetGlobalProducer(p Producer)  { globalProducer = p }
func GetGlobalProducer() Producer   { return globalProducer }

// Produce is the global convenience function for creating notifications.
// Returns nil when the producer is uninitialized (notification SubServer not started),
// ensuring failure transparency for all callers.
func Produce(ctx context.Context, params ProduceParams) error {
    p := GetGlobalProducer()
    if p == nil {
        return nil
    }
    return p.Produce(ctx, params)
}
```

### 5.5 Production Pipeline

The production pipeline is the core system behavior — the path from a business action to a delivered notification.

```
Source SubServer action (e.g., social.handleLikePost)
    │
    ▼
notification.Produce(ctx, ProduceParams{...})
    │
    ├─ 1. Self-notification guard (actorPTID == recipientPTID → skip)
    ├─ 2. Preference check (category enabled? → skip if disabled)
    ├─ 3. Rate limit check (recipient rate exceeded? → skip)
    ├─ 4. Deduplication check (same actor+type+target within 1h? → skip)
    ├─ 5. Generate notification entity (ID, group_key, timestamps)
    │
    ├─ 6. Persist to DB + increment counter (SINGLE TRANSACTION)
    │
    ├─ 7. Publish "notification.created" SSE event (via EventSystem)
    ├─ 8. Publish "notification.count.updated" SSE event
    │
    └─ 9. Push Gateway dispatch (async goroutine, non-blocking)
         └─ Check per-device online status → send push to offline devices
```

Steps 1–5 are validation and preparation. Step 6 is the single write transaction — notification insert and counter update are atomic. Steps 7–9 are delivery and are fire-and-forget relative to the production pipeline.

### 5.6 Integration Contract

Source SubServers import only the `domain/producer.go` package — a **thin dependency** on `ProduceParams` and `Produce()` only. No dependency on the notification SubServer's service, repo, or handler.

```go
import notification "github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
```

Integration points:

```go
// social/application/relationship_service.go — after accepting a follow request
notification.Produce(ctx, notification.ProduceParams{
    RecipientID: targetActorID,
    ActorID:     followerActorID,
    Type:        notification.NOTIFICATION_TYPE_FOLLOW_ACCEPTED,
    Category:    notification.NOTIFICATION_CATEGORY_SOCIAL,
    TargetType:  "actor",
    TargetID:    followerActorID,
})

// social/application/post_service.go — after a post is liked
notification.Produce(ctx, notification.ProduceParams{
    RecipientID: postAuthorID,
    ActorID:     likerActorID,
    Type:        notification.NOTIFICATION_TYPE_POST_LIKED,
    Category:    notification.NOTIFICATION_CATEGORY_SOCIAL,
    TargetType:  "post",
    TargetID:    postID,
})

// friend_chat/application/service.go — after a friend request is sent
notification.Produce(ctx, notification.ProduceParams{
    RecipientID: targetDID,
    ActorID:     senderDID,
    Type:        notification.NOTIFICATION_TYPE_FRIEND_REQUEST,
    Category:    notification.NOTIFICATION_CATEGORY_CHAT,
    TargetType:  "actor",
    TargetID:    senderDID,
})
```

Chat message notifications follow a conditional production rule — only produced when the recipient is offline, since online recipients already receive `chat.message.appended` events via SSE:

```go
// friend_chat — after message persistence
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

Notifications that are **always produced** regardless of online status: friend request, friend accepted, group invitation, @mention in group chat.

### 5.7 API Surface

| Name | Method | Path | Auth | Description |
|------|--------|------|------|-------------|
| `notif-list` | GET | `/notification/list` | JWT | List notifications (paginated, filterable) |
| `notif-grouped` | GET | `/notification/grouped` | JWT | List grouped/aggregated notifications |
| `notif-read` | POST | `/notification/read` | JWT | Mark specific notifications as read |
| `notif-read-all` | POST | `/notification/read-all` | JWT | Mark all (or by category) as read |
| `notif-delete` | POST | `/notification/delete` | JWT | Delete specific notifications |
| `notif-unread-counts` | GET | `/notification/unread-counts` | JWT | Get unread counts (total + by category) |
| `notif-preferences` | GET | `/notification/preferences` | JWT | Get notification preferences |
| `notif-preferences-update` | POST | `/notification/preferences` | JWT | Update notification preferences |
| `push-register` | POST | `/notification/push/register` | JWT + device assertion | Idempotently register or rotate one APNs/FCM/UnifiedPush binding |
| `push-unregister` | POST | `/notification/push/unregister` | JWT + device assertion | Idempotently remove the exact actor/device/install registration |
| `push-devices` | GET | `/notification/push/devices` | JWT | List redacted registrations for the authenticated PTID |

Web Push/VAPID is not part of the MS-D23A contract or W7. It requires a
separate Desktop product and architecture decision before adding a provider
binding or public endpoint.

---

## 6. Storage Architecture

### 6.1 Database Tables

The notification SubServer uses its own database accessed via `store.GetRDS(ctx)`. Tables are migrated via GORM `AutoMigrate` in `SubServer.Init()`.

#### Table: `notifications`

| Column | Type | Constraint | Description |
|--------|------|-----------|-------------|
| `id` | `uint64` | PK, Snowflake | Notification unique ID |
| `recipient_ptid` | `varchar(255)` | INDEX, NOT NULL | Target actor PTID |
| `actor_ptid` | `varchar(255)` | NOT NULL | Trigger actor PTID |
| `type` | `int32` | NOT NULL | NotificationType enum value |
| `category` | `int32` | NOT NULL | NotificationCategory enum value |
| `status` | `int32` | NOT NULL, DEFAULT 1 | NotificationStatus (1=UNREAD) |
| `target_type` | `varchar(64)` | | Related entity type |
| `target_id` | `varchar(255)` | | Related entity ID |
| `title` | `varchar(512)` | | Notification title (fallback text) |
| `body` | `text` | | Notification body (fallback text) |
| `metadata` | `jsonb` | | Extra key-value data |
| `group_key` | `varchar(512)` | INDEX | Aggregation key |
| `read_at` | `timestamp` | | When marked as read |
| `created_at` | `timestamp` | INDEX, NOT NULL | Creation time |
| `updated_at` | `timestamp` | | Last update time |

Indexes:

```
idx_notifications_recipient_status  (recipient_ptid, status)        — List unread
idx_notifications_recipient_cat     (recipient_ptid, category)      — Filter by category
idx_notifications_group_key         (group_key)                   — Aggregation queries
idx_notifications_created_at        (created_at DESC)             — Cursor pagination
idx_notifications_dedup             (recipient_ptid, actor_ptid, type, target_id)  — Deduplication
```

#### Table: `notification_counters`

| Column | Type | Constraint | Description |
|--------|------|-----------|-------------|
| `id` | `uint64` | PK, Snowflake | Counter ID |
| `actor_ptid` | `varchar(255)` | UNIQUE INDEX, NOT NULL | User actor PTID |
| `total_unread` | `int32` | NOT NULL, DEFAULT 0 | Total unread count |
| `social_unread` | `int32` | NOT NULL, DEFAULT 0 | Social category unread |
| `chat_unread` | `int32` | NOT NULL, DEFAULT 0 | Chat category unread |
| `system_unread` | `int32` | NOT NULL, DEFAULT 0 | System category unread |
| `task_unread` | `int32` | NOT NULL, DEFAULT 0 | Task category unread |
| `updated_at` | `timestamp` | | Last update time |

Rationale for separate counter table: Avoids `COUNT(*)` queries on the main notification table for every unread badge render. Counter is updated atomically via `UPDATE ... SET total_unread = total_unread + 1`.

**Transactional guarantee**: Notification insert and counter increment MUST execute in the same database transaction. This prevents counter drift caused by partial failures. The same guarantee applies to mark-read (counter decrement) and delete (counter adjustment).

#### Table: `notification_preferences`

| Column | Type | Constraint | Description |
|--------|------|-----------|-------------|
| `id` | `uint64` | PK, Snowflake | Preference ID |
| `actor_ptid` | `varchar(255)` | NOT NULL | User actor PTID |
| `category` | `int32` | NOT NULL | NotificationCategory enum value |
| `enabled` | `bool` | NOT NULL, DEFAULT true | Whether this category is enabled |
| `push_enabled` | `bool` | NOT NULL, DEFAULT true | Whether push notification is enabled |
| `sound_enabled` | `bool` | NOT NULL, DEFAULT true | Whether sound is enabled |
| `updated_at` | `timestamp` | | Last update time |

Indexes:

```
idx_notification_prefs_actor  (actor_ptid, category)  — UNIQUE
```

#### Table: `notification_preference_revisions`

| Column | Type | Constraint | Description |
|---|---|---|---|
| `actor_ptid` | `varchar(255)` | PRIMARY KEY | Preference aggregate owner |
| `revision` | `uint64` | NOT NULL, DEFAULT 1 | Monotonic aggregate preference revision |
| `updated_at` | `timestamp` | NOT NULL | Last successful value-changing batch |

Preference reads return all supported categories with effective defaults and
one aggregate revision. A batch update validates every patch, locks the actor's
revision row, compares `observed_revision`, applies every changed category, and
increments the revision once in the same transaction. A stale revision returns
typed `CONFLICT` plus the canonical snapshot without writing. An equal-value
batch returns `UNCHANGED` without incrementing. Missing/zero revision, empty
batch, unspecified category, or duplicate category is invalid.

#### Table: `notification_push_registrations`

| Column | Type | Constraint | Description |
|--------|------|-----------|-------------|
| `registration_id` | `varchar(64)` | PRIMARY KEY | Public redacted registration identity |
| `actor_ptid` | `varchar(255)` | INDEX, NOT NULL | Authenticated actor PTID |
| `device_id` | `varchar(128)` | NOT NULL | Authenticated Actor Device |
| `channel` | `int32` | NOT NULL | APNs, FCM, or UnifiedPush |
| `environment` | `int32` | NOT NULL | Development or production |
| `app_install_epoch_sha256` | `bytea` | NOT NULL | Native install-epoch commitment |
| `provider_binding_hmac` | `bytea` | UNIQUE, NOT NULL | Station-scoped provider fingerprint |
| `provider_binding_ciphertext` | `bytea` | NOT NULL | AES-256-GCM ciphertext |
| `provider_binding_nonce` | `bytea` | NOT NULL | Unique GCM nonce |
| `credential_key_version` | `int32` | NOT NULL | Versioned Notification key |
| `created_at` | `timestamp` | NOT NULL | Registration time |
| `updated_at` | `timestamp` | NOT NULL | Last create/rotation time |
| `last_success_at` | `timestamp` | | Last successful provider delivery |

Indexes:

```
uidx_push_registration_owner  (actor_ptid, device_id, channel, environment)
uidx_push_registration_binding (provider_binding_hmac)
idx_push_registration_actor    (actor_ptid)
```

Provider credentials never have plaintext columns. Associated data binds the
registration owner tuple, install epoch, and provider fingerprint. A
deployment-root key change invalidates these rows and requires native
re-registration; there is no plaintext or old-key fallback.

#### Table: `notification_push_mutation_receipts`

| Column | Type | Constraint | Description |
|---|---|---|---|
| `actor_ptid` | `varchar(255)` | PRIMARY KEY part | Authenticated actor PTID |
| `device_id` | `varchar(128)` | PRIMARY KEY part | Authenticated device |
| `request_id` | `varchar(64)` | PRIMARY KEY part | Stable mutation ULID |
| `request_sha256` | `bytea` | NOT NULL | Canonical request commitment |
| `response_bytes` | `bytea` | NOT NULL | Redacted deterministic response |
| `expires_at` | `timestamp` | NOT NULL | Bounded replay retention |
| `created_at` | `timestamp` | NOT NULL | Receipt creation time |

### 6.2 GORM Model Mapping

```go
type NotificationModel struct {
    ID            uint64    `gorm:"primaryKey;autoIncrement:false"`
    RecipientPTID string    `gorm:"column:recipient_ptid;size:255;not null;index:idx_notif_recipient_status;index:idx_notif_recipient_cat;index:idx_notif_dedup"`
    ActorPTID     string    `gorm:"column:actor_ptid;size:255;not null;index:idx_notif_dedup"`
    Type        int32     `gorm:"not null;index:idx_notif_dedup"`
    Category    int32     `gorm:"not null;index:idx_notif_recipient_cat"`
    Status      int32     `gorm:"not null;default:1;index:idx_notif_recipient_status"`
    TargetType  string    `gorm:"size:64"`
    TargetID    string    `gorm:"size:255;index:idx_notif_dedup"`
    Title       string    `gorm:"size:512"`
    Body        string    `gorm:"type:text"`
    Metadata    string    `gorm:"type:jsonb"`
    GroupKey    string    `gorm:"size:512;index:idx_notif_group_key"`
    ReadAt      *time.Time
    CreatedAt   time.Time `gorm:"not null;index:idx_notif_created_at"`
    UpdatedAt   time.Time
}

func (*NotificationModel) TableName() string { return "notifications" }
```

### 6.3 Data Retention

- Notifications in `ARCHIVED` or `READ` status older than a configurable retention period (default: **90 days**) are eligible for cleanup
- A background goroutine runs daily to purge expired notifications
- `UNREAD` notifications are never auto-deleted
- Retention period is configurable per Station instance via config:

```yaml
notification:
  retention_days: 90  # default; Station owner can adjust
```

---

## 7. Delivery Architecture

### 7.1 Delivery as a Unified Concern

Notification delivery is a single architectural concern that spans multiple connectivity states and platforms. The delivery system must solve:

```
                    Connectivity State
                    ─────────────────
                    Online (SSE)    Offline         Suspended
                    ──────────      ────────        ─────────
Desktop             SSE event       Broker catch-up Pull on open
Android             SSE event       Broker catch-up UnifiedPush / FCM
Android (degoogled) SSE event       Broker catch-up UnifiedPush
iOS                 SSE event       Broker catch-up APNs
iOS (no APNs)       SSE event       Broker catch-up Background fetch
```

Three delivery mechanisms address these states, each building on the previous:

1. **EventSystem SSE** — real-time push to online clients
2. **Broker catch-up** — persistent queue for offline-to-online transition
3. **Push Gateway** — wake-up signal for suspended/killed apps

### 7.2 Online Delivery: EventSystem

Notification events are published through the existing EventSystem, reusing the `DeliveryRouter`, `ConnectionHub`, and SSE infrastructure.

#### Event Types

Added to `frame/core/event/types.go`:

```go
EventNotificationCreated      EventType = "notification.created"
EventNotificationRead         EventType = "notification.read"
EventNotificationDeleted      EventType = "notification.deleted"
EventNotificationCountUpdated EventType = "notification.count.updated"
```

#### Event Payloads

```go
type NotificationCreatedPayload struct {
    NotificationID string `json:"notificationId"`
    Type           int32  `json:"type"`
    Category       int32  `json:"category"`
    ActorPTID      string `json:"actorPtid"`
    TargetType     string `json:"targetType,omitempty"`
    TargetID       string `json:"targetId,omitempty"`
    Title          string `json:"title"`
    Body           string `json:"body,omitempty"`
    GroupKey       string `json:"groupKey,omitempty"`
    SoundEnabled   bool   `json:"soundEnabled"`
}

type NotificationCountPayload struct {
    TotalUnread  int32            `json:"totalUnread"`
    ByCategory   map[int32]int32  `json:"byCategory"`
}
```

#### Global Convenience Functions

Following the existing `PublishChatMessage` pattern:

```go
func PublishNotificationCreated(recipientPTID string, payload NotificationCreatedPayload) error {
    es := GetGlobalEventSystem()
    if es == nil {
        return nil
    }
    return es.Router.PublishEvent(
        context.Background(),
        EventNotificationCreated,
        payload.ActorPTID,
        recipientPTID,
        payload.NotificationID,
        ScopeActor,
        payload,
    )
}

func PublishNotificationCountUpdated(actorPTID string, payload NotificationCountPayload) error {
    es := GetGlobalEventSystem()
    if es == nil {
        return nil
    }
    return es.Router.PublishEvent(
        context.Background(),
        EventNotificationCountUpdated,
        actorPTID,
        actorPTID,
        "",
        ScopeActor,
        payload,
    )
}
```

#### Delivery Flow

```
Source SubServer                    Notification SubServer           EventSystem
     │                                     │                            │
     │  notification.Produce(params)       │                            │
     │────────────────────────────────────►│                            │
     │                                     │                            │
     │                              check preference                   │
     │                              persist to DB                      │
     │                              update counter                     │
     │                                     │                            │
     │                                     │  PublishNotificationCreated│
     │                                     │───────────────────────────►│
     │                                     │                            │
     │                                     │  PublishNotifCountUpdated  │
     │                                     │───────────────────────────►│
     │                                     │                            │
     │                                     │                     DeliveryRouter
     │                                     │                     .Route()
     │                                     │                            │
     │                                     │                     SSE push to
     │                                     │                     all devices
```

### 7.3 Offline Catch-up: Broker

Notification events are delivered through the existing EventSystem, which **guarantees offline message persistence and catch-up** via the Broker layer. No additional offline handling is needed in the notification module.

`DeliveryRouter.Route()` always persists every event to the Broker, regardless of whether the target is online:

```go
// delivery_router.go — inside Route(), after online/offline branch
if r.broker != nil {
    topic := "events:" + targetID
    data, _ := event.ToJSON()
    r.broker.Publish(ctx, topic, event.ID, nil, data, broker.PublishOptions{})
}
```

This means `notification.created` and `notification.count.updated` events are always persisted in `events:<recipientPTID>` topic.

Two catch-up paths:

| Path | Mechanism | When |
|------|-----------|------|
| **SSE auto-catch-up** | Client passes `Last-Event-ID` header on SSE reconnect → `sendMissedEventsToHertz()` replays missed events from Broker | SSE reconnect (browser auto-reconnect) |
| **Explicit pull** | Client calls `POST /events/pull` with `since_ts` → returns missed events | App foreground resume, manual refresh |

#### Notification vs. Chat Offline Distinction

The notification system uses EventSystem exclusively, so offline delivery is fully covered by the Broker catch-up. The existing friend_chat maintains its own `pending` map — notification supplements it as a **user-facing alert**, not a replacement for chat payload delivery.

### 7.4 Push Gateway Architecture

#### The Problem

SSE-based delivery requires the client to maintain an active HTTP connection to Station. This fails when:

| Scenario | SSE status | User expectation |
|----------|------------|------------------|
| Mobile app killed by OS / user | No connection | Still receive important notifications |
| Mobile app suspended (background) | Connection dropped (iOS ~15s, Android varies) | Still receive important notifications |
| Desktop app closed | No connection | Receive notification on next open (acceptable) |

#### Self-Hosted Push Gateway Principle

Peers-Touch is decentralized — each user runs their own Station. This means:

1. **No centralized push infrastructure** — there is no "Peers-Touch Inc." operating a push server for all users
2. **Station IS the push gateway** — each Station instance runs its own push delivery pipeline
3. **Multi-channel with fallback** — support multiple push channels with graceful degradation
4. **Privacy by default** — push payloads carry minimal data; actual content is fetched from Station after wake-up

```
Architecture: Station as Self-Hosted Push Gateway

┌─────────────────────────────────────────────────────────────┐
│                    Station (your server)                     │
│                                                             │
│  ┌──────────────────┐    ┌────────────────────────────────┐ │
│  │ Notification      │    │        Push Gateway            │ │
│  │ SubServer         │───►│                                │ │
│  │                   │    │  ┌─────────┐ ┌──────────────┐ │ │
│  │ Produce() ───────►│───►│  │ Channel │ │ Channel      │ │ │
│  │                   │    │  │ Router  │ │ Registry     │ │ │
│  └──────────────────┘    │  └────┬────┘ └──────────────┘ │ │
│                          │       │                        │ │
│                          │  ┌────▼────────────────────┐   │ │
│                          │  │    Push Channels         │   │ │
│                          │  │                          │   │ │
│                          │  │  ┌─────────────────────┐ │   │ │
│                          │  │  │ Web Push (VAPID)    │ │   │ │
│                          │  │  │ RFC 8030/8291/8292  │ │   │ │
│                          │  │  └─────────────────────┘ │   │ │
│                          │  │  ┌─────────────────────┐ │   │ │
│                          │  │  │ UnifiedPush         │ │   │ │
│                          │  │  │ (WebPush-compat)    │ │   │ │
│                          │  │  └─────────────────────┘ │   │ │
│                          │  │  ┌─────────────────────┐ │   │ │
│                          │  │  │ APNs (optional)     │ │   │ │
│                          │  │  │ requires cert       │ │   │ │
│                          │  │  └─────────────────────┘ │   │ │
│                          │  │  ┌─────────────────────┐ │   │ │
│                          │  │  │ FCM (optional)      │ │   │ │
│                          │  │  │ requires key         │ │   │ │
│                          │  │  └─────────────────────┘ │   │ │
│                          │  └──────────────────────────┘   │ │
│                          └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                    │                │
    Broker catch-up       UnifiedPush       APNs/FCM
    (Desktop)             (Android)         (optional)
         │                    │                │
         ▼                    ▼                ▼
    ┌─────────┐       ┌────────────┐    ┌──────────┐
    │ Browser  │       │ ntfy/dist  │    │ Apple /  │
    │ Push     │       │ app on     │    │ Google   │
    │ Service  │       │ device     │    │ servers  │
    └─────────┘       └────────────┘    └──────────┘
```

### 7.5 Multi-Device Delivery Strategy

A user may be online on one device (e.g., Desktop with active SSE) while their phone is in their pocket. The delivery system must address this multi-device reality.

Push dispatch is registration-scoped, not actor-global. An online Desktop SSE
connection cannot suppress delivery to a disconnected Mobile registration.
The gateway evaluates the authenticated actor/device registration, channel
availability, category preference, expiry, and device-specific online state.
When device-specific online state is unavailable, it must prefer delivery or
bounded pull reconciliation rather than infer that every device is online.

Provider invalid/unregistered responses deactivate the exact registration.
Transient failures retain it for bounded retry. One device's provider failure
or online state never removes or suppresses another device's registration.

### 7.6 Push Channel Strategy

#### Channel Priority by Platform

| Platform | Primary Channel | Fallback | Notes |
|----------|----------------|----------|-------|
| **Desktop** | SSE (active connection) | Broker catch-up | Web Push is outside MS-D23A/W7 |
| **Android** | UnifiedPush | FCM (optional) | UnifiedPush is decentralized; FCM for mainstream users |
| **Android (degoogled)** | UnifiedPush | Polling | No Google Services; UnifiedPush via ntfy/NextPush |
| **iOS** | APNs (via self-hosted relay) | Polling (background fetch) | APNs is the only reliable iOS push; Station owner provides own APNs cert |

#### UnifiedPush: The Decentralized Default

UnifiedPush is an open-source push notification protocol (RFC 8030 compatible) that lets users choose their own push provider. It is the **primary push channel** for Android.

```
1. User installs a UnifiedPush distributor (e.g., ntfy app) on their phone
2. PeersTouch mobile app registers with the distributor → gets an endpoint URL
3. Mobile app sends this endpoint URL to its Station (device registration API)
4. When Station needs to push:
   Station ──HTTP POST──► endpoint URL ──► distributor app ──► PeersTouch app wakes up
```

Key design decisions:

- **Station sends to the endpoint URL directly** — no centralized relay needed
- **Payload is encrypted** (RFC 8291) — the distributor/push server cannot read the content
- **User controls the distributor** — can self-host ntfy, use a public instance, or use any compatible distributor
- **Station does not need to know which distributor the user chose** — it only stores the endpoint URL

#### APNs: Required for iOS, Self-Hosted

iOS fundamentally requires APNs — there is no alternative for App Store applications. Each Station owner manages their own APNs credential — fully decentralized. If no APNs configured, iOS falls back to background fetch polling.

#### Web Push (VAPID): Deferred

Web Push requires a separate Desktop contract. The Mobile registration API
does not accept Web Push, does not expose a VAPID endpoint, and must not be
extended with an unreviewed compatibility variant.

### 7.7 Push Payload Strategy

Mobile push carries a **content-free reconcile envelope** capped at 1024
encoded bytes:

```
┌──────────────────────────────────────────────────────────┐
│  Push Payload (encrypted via RFC 8291 or platform TLS)   │
│                                                          │
│  {                                                       │
│    "v": 1,                          // envelope version   │
│    "kind": "notification_wakeup",   // reconcile only     │
│    "notification_id": "01HWXYZ...", // notification ID   │
│    "category": 2,                   // category (CHAT)    │
│    "target_hint": "conversation",   // advisory hint      │
│    "issued_at_ms": 1713000000000,   // timing             │
│    "expires_at_ms": 1713000300000   // bounded validity   │
│  }                                                       │
└──────────────────────────────────────────────────────────┘
```

The payload deliberately omits title, body, actor profile, message/Moment
content, credentials, decryption material, read state, and authorization
truth. Provider transport encryption remains defense in depth; privacy does
not depend on it.

Unknown versions/kinds, malformed identity, invalid category/hint, expired
timing, or oversized payloads are discarded before Web delivery.

Client flow after receiving a push:

```
Push arrives → native/Rust generation + sequence validation
           → mark Notification/domain projection stale
           → reconcile current Station/PTID/device scope
           → render canonical content
           → on tap, authorize reconciled target and then navigate
```

### 7.8 Push Delivery Pipeline

Push dispatch integrates into the production pipeline (§5.5, step 9):

```
notification.Produce(ctx, params)
    │
    ├──► Persist to DB (unchanged)
    ├──► Update counter (unchanged)
    ├──► Publish SSE event (unchanged, for online devices)
    │
    └──► Push Gateway dispatch (async, non-blocking)
         │
         │  ┌─────────────────────────────────────────────┐
         │  │ 1. Check category push preference            │
         │  │    → disabled: skip                          │
         │  │                                              │
         │  │ 2. Query active registrations for PTID       │
         │  │                                              │
         │  │ 3. For each actor/device registration:       │
         │  │    a. Skip only this device if known online   │
         │  │    b. Decrypt binding in channel adapter      │
         │  │    c. Send content-free reconcile envelope    │
         │  │    d. Zero plaintext provider binding         │
         │  │    e. Handle response:                        │
         │  │       - success: update last_success_at        │
         │  │       - invalid/unregistered: deactivate row   │
         │  │       - throttled/transient: bounded backoff   │
         │  └─────────────────────────────────────────────┘
```

#### PushChannel Interface

```go
type PushChannel interface {
    Type() PushChannel
    Send(
        ctx context.Context,
        registration PushRegistration,
        binding DecryptedProviderBinding,
        payload PushPayload,
    ) PushDeliveryResult
    Available() bool
}
```

#### PushGateway

```go
type PushGateway struct {
    channels      map[PushChannel]PushChannel
    registrations PushRegistrationRepository
    protector     ProviderBindingProtector
    presence      DevicePresence
}

func (g *PushGateway) Dispatch(
    ctx context.Context,
    recipientPTID string,
    payload PushPayload,
) error {
    registrations, err := g.registrations.ListActive(ctx, recipientPTID)
    if err != nil {
        return err
    }
    for _, registration := range registrations {
        if g.presence.IsDeviceOnline(recipientPTID, registration.DeviceID) {
            continue
        }
        ch, ok := g.channels[registration.Channel]
        if !ok || !ch.Available() {
            continue
        }
        binding, err := g.protector.Open(registration)
        if err != nil {
            continue
        }
        result := ch.Send(ctx, registration, binding, payload)
        binding.Zeroize()
        if result.InvalidRegistration {
            _ = g.registrations.Deactivate(ctx, registration.RegistrationID)
        }
    }
    return nil
}
```

### 7.9 Station Configuration

Push channels are configured via Station config file or environment variables:

```yaml
push:
  # Derived with HKDF-SHA256 into the versioned Notification credential key.
  # Rotation invalidates registrations and requires native re-registration.
  credential_root_secret: ""
  credential_key_version: 1

  # APNs — optional, required for iOS push
  apns:
    enabled: false
    key_file: ""
    key_id: ""
    team_id: ""
    bundle_id: ""
    production: false

  # FCM — optional, for Android users preferring FCM
  fcm:
    enabled: false
    credentials_file: ""
```

Auto-generation behavior:

- **Credential root**: Required before accepting provider registrations.
  Missing or invalid configuration returns push unavailable and never stores
  plaintext.
- **APNs/FCM**: Strictly opt-in. Station works without them. If not configured, those channels are simply unavailable.

### 7.10 Degradation Matrix

When a push channel is unavailable, the system degrades gracefully:

```
                       Primary         Fallback 1        Fallback 2
                       ─────────       ──────────        ──────────
Desktop:               SSE (live)  →   Broker catch-up → Pull on open
Android:               SSE (live)  →   UnifiedPush   →   FCM (opt-in)  →  Poll
Android (degoogled):   SSE (live)  →   UnifiedPush   →   Poll
iOS:                   SSE (live)  →   APNs          →   Background fetch  →  Pull on open
iOS (no APNs config):  SSE (live)  →   Background fetch  →  Pull on open
```

Polling fallback (when no push channel available):

- **iOS Background App Refresh**: `BGAppRefreshTask` scheduled every ~15min (OS controlled, unreliable)
- **Android WorkManager**: Periodic sync every ~15min with flex window
- **Both**: Full sync on app foreground via `POST /events/pull`

---

## 8. Client Presentation Boundary

### 8.1 Cross-Platform Responsibility

| Responsibility | Station | Desktop | Mobile |
|----------------|---------|---------|--------|
| Notification creation | Owner | — | — |
| Notification persistence | Owner | — | — |
| Notification preference storage | Owner | — | — |
| Real-time delivery (SSE) | Owner | Consumer | — |
| Real-time delivery (push) | Producer | — | Consumer |
| Notification content rendering | Fallback text only | Owner (locale-aware) | Owner (locale-aware) |
| Notification UI rendering | — | Owner | Owner |
| Notification permission | — | — | Owner |
| Unread badge display | — | Owner | Owner |
| Sound playback | — | Owner | Owner |
| Push subscription management | API provider | Owner (Web Push) | Owner (UnifiedPush/APNs) |

### 8.2 Content Rendering

Rich clients render notification display text from structured references rather than using the server-generated `title`/`body` directly. This enables locale-aware, navigable notification text.

Client rendering flow:

```
SSE event arrives with:
  { type: 102, category: 1, actorId: "alice-did", targetType: "post", targetId: "post-123" }

Client looks up:
  - Actor display name: "Alice" (from local cache or API)
  - Type template: "notification.social.post_liked" → "{actor} liked your post"
  - Target: resolve post title or excerpt

Client renders (locale=zh):
  "Alice 赞了你的帖子"

Client renders (locale=en):
  "Alice liked your post"
```

### 8.3 Desktop (Tauri + React/TS)

#### SSE Event Handling

The Desktop client already connects to `/events/stream` via SSE. New `notification.*` event types are handled by adding listeners:

```typescript
// kernel/events/catalog.ts
NOTIFICATION_CREATED = "notification.created"
NOTIFICATION_READ = "notification.read"
NOTIFICATION_COUNT_UPDATED = "notification.count.updated"
```

#### GlobalContext Integration

The existing `NotificationSlice` in Desktop's GlobalContext is extended:

```typescript
interface NotificationSlice {
  notifications: NotificationItem[];
  unreadCounts: {
    total: number;
    byCategory: Record<NotificationCategory, number>;
  };
  pushNotification: (item: NotificationItem) => void;
  markAsRead: (ids: string[]) => void;
  updateUnreadCounts: (counts: UnreadCounts) => void;
}
```

#### UI Components

- Notification bell icon in header with unread badge (total count)
- Notification panel/drawer with category tabs
- Notification list with grouped display
- Notification preference settings page

#### Desktop Push Integration

Desktop uses SSE plus Broker catch-up in the current contract. Web Push is
deferred and cannot reuse the Mobile API without a reviewed provider-binding,
service-worker lifecycle, device-identity, and credential-protection contract.

### 8.4 Mobile

Mobile notification delivery follows the Tauri Mobile mainline:

```text
APNs / FCM / UnifiedPush
  -> native notification plugin
  -> mobile-rust capability kernel
  -> notificationRuntime projection
  -> mobile-web UI / badge / route
```

#### iOS Native Plugin (Swift)

The mobile notification plugin is extended:

- System notification permission request
- Rich notification display (image, action buttons)
- Badge count update via `UNUserNotificationCenter`
- Category-based notification channels
- APNs device token registration

#### Android Native Plugin (Kotlin)

The mobile notification plugin is extended:

- Notification channels per category (Social, Chat, System, Task)
- Rich notification with `BigTextStyle` / `MessagingStyle`
- Badge count via `ShortcutBadger` or native API
- Notification grouping via `NotificationCompat.Group`
- UnifiedPush receiver for push delivery

#### Mobile Push Integration

**Android — UnifiedPush**:

```kotlin
class PushReceiver : MessagingReceiver() {
    override fun onNewEndpoint(context: Context, endpoint: String, instance: String) {
        rustBridge.emitPushToken(
            NativePushTokenCallback(
                sequence = nextSequence(),
                lifecycleGeneration = armedGeneration,
                environment = currentEnvironment,
                unifiedPush = UnifiedPushBinding(endpoint)
            )
        )
    }

    override fun onMessage(context: Context, message: ByteArray, instance: String) {
        rustBridge.emitPushWakeup(
            validateBoundedWakeup(message, armedGeneration, nextSequence())
        )
    }
}
```

**iOS — APNs**:

```swift
func application(_ application: UIApplication,
                 didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    rustBridge.emitPushToken(
        NativePushTokenCallback(
            sequence: nextSequence(),
            lifecycleGeneration: armedGeneration,
            environment: currentEnvironment,
            apns: ApnsPushBinding(token: deviceToken, topic: bundleTopic)
        )
    )
}
```

Native code never chooses Station/PTID, attaches credentials, calls the
Notification API, or forwards provider credentials to Web. Rust resolves the
active authenticated scope, enforces generation/sequence fencing, derives the
install-epoch digest, and executes the typed Station operation.

### 8.5 Sound Architecture

Sound notification is a **client-side concern** — this follows from the client-side presentation ownership principle (§3.3). Station carries the `sound_enabled` preference flag per category; actual audio playback is handled entirely by each platform using its native API.

#### Sound Mapping by Category

| Category | Sound Asset | Behavior |
|----------|-------------|----------|
| SOCIAL | `notification_social.wav` | Short, soft chime |
| CHAT | `notification_chat.wav` | Distinctive message tone |
| SYSTEM | `notification_system.wav` | Neutral alert |
| TASK | `notification_task.wav` | Brief task bell |

Audio file specification:

- Format: WAV (PCM 16-bit) for maximum cross-platform compatibility
- Duration: ≤ 1.5 seconds
- Sample rate: 44100 Hz
- Size: ≤ 100 KB each

Asset location per platform:

| Platform | Path |
|----------|------|
| Desktop | `apps/desktop/public/sounds/` (bundled as Tauri resource) |
| iOS | `apps/mobile/ios/PeersTouch/Resources/Sounds/` (bundle resource) |
| Android | `apps/mobile/android/app/src/main/res/raw/` (resource directory) |

#### Desktop — Web Audio API

```typescript
type SoundCategory = "social" | "chat" | "system" | "task";

const SOUND_MAP: Record<SoundCategory, string> = {
  social: "/sounds/notification_social.wav",
  chat: "/sounds/notification_chat.wav",
  system: "/sounds/notification_system.wav",
  task: "/sounds/notification_task.wav",
};

const audioCache = new Map<string, HTMLAudioElement>();

function preloadSounds(): void {
  for (const src of Object.values(SOUND_MAP)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audioCache.set(src, audio);
  }
}

function playNotificationSound(category: SoundCategory): void {
  const src = SOUND_MAP[category];
  const audio = audioCache.get(src) ?? new Audio(src);
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
```

#### iOS — UNNotificationSound

```swift
private func soundForCategory(_ category: String) -> UNNotificationSound {
    switch category {
    case "social":
        return UNNotificationSound(named: UNNotificationSoundName("notification_social.wav"))
    case "chat":
        return UNNotificationSound(named: UNNotificationSoundName("notification_chat.wav"))
    case "system":
        return UNNotificationSound(named: UNNotificationSoundName("notification_system.wav"))
    case "task":
        return UNNotificationSound(named: UNNotificationSoundName("notification_task.wav"))
    default:
        return .default
    }
}
```

#### Android — NotificationChannel Sound

```kotlin
private fun createCategoryChannels() {
    val soundMap = mapOf(
        "social" to "notification_social",
        "chat" to "notification_chat",
        "system" to "notification_system",
        "task" to "notification_task",
    )

    for ((key, soundName) in soundMap) {
        val soundUri = Uri.parse(
            "android.resource://${context.packageName}/raw/$soundName"
        )
        val channel = NotificationChannel(
            "peers_$key",
            key.replaceFirstChar { it.uppercase() },
            if (key == "chat") NotificationManager.IMPORTANCE_HIGH
            else NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            setSound(soundUri, AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
        }
        notificationManager.createNotificationChannel(channel)
    }
}
```

#### Preference → Sound Pipeline

The `sound_enabled` field in `NotificationPreference` controls sound on the **client side**:

```
Station                          Client
   │                               │
   │  NotificationPreference       │
   │  { sound_enabled: true }      │
   │──────────────────────────────►│  Cache locally
   │                               │
   │  notification.created event   │
   │  { soundEnabled: true }       │
   │──────────────────────────────►│  Check event's soundEnabled hint
   │                               │
   │                               │  soundEnabled == true
   │                               │  → play category sound
   │                               │
   │                               │  soundEnabled == false
   │                               │  → silent
```

- Desktop: `shouldPlaySound()` reads the `soundEnabled` field from the SSE event payload
- iOS: The `sound` parameter in bridge call is set based on cached preference
- Android: Preference controls whether to use the sound-enabled channel or a silent channel

---

## 9. Operational Constraints

### 9.1 Deduplication

Before creating a notification, the producer checks for duplicates:

```sql
SELECT id FROM notifications
WHERE recipient_ptid = ? AND actor_ptid = ? AND type = ? AND target_id = ?
  AND created_at > NOW() - INTERVAL '1 hour'
LIMIT 1
```

If a match is found, the notification is not created again. This prevents scenarios like:

- User likes → unlikes → likes the same post generating duplicate notifications
- Retry logic in source SubServers producing duplicate produce calls

### 9.2 Idempotency

All mutating API endpoints use idempotent operations:

- `mark_read`: Updates `status = READ` WHERE `status = UNREAD` — re-reads are no-ops
- `delete`: Soft-deletes by filtering existing records — re-deletes are no-ops
- Counter updates use atomic SQL (`SET unread = unread - N WHERE unread >= N`) with floor at 0

### 9.3 Rate Limiting

To prevent notification floods from buggy or malicious source SubServers:

| Limit | Scope | Default | Behavior when exceeded |
|-------|-------|---------|----------------------|
| Production rate | Per recipient, per minute | 60 notifications/min | Silently drop; log warning |
| Production rate | Per recipient, per category, per minute | 30 notifications/min | Silently drop; log warning |
| Push dispatch rate | Per recipient, per hour | 30 pushes/hour | Queue for next window |

Rate limits are checked in the production pipeline (§5.5, step 3) before deduplication. Implementation uses an in-memory sliding window counter — persistence is not needed since rate limits are transient safety bounds, not business state.

Rate limit values are configurable per Station instance:

```yaml
notification:
  rate_limits:
    per_recipient_per_minute: 60
    per_category_per_minute: 30
    push_per_hour: 30
```

### 9.4 Preference Model

User preferences control notification behavior at the category level.
Preferences are only created when a user explicitly changes a setting; absent
rows resolve to "all enabled" in the canonical complete snapshot.

The write contract is one aggregate CAS batch across category-level
`enabled`, `push_enabled`, and `sound_enabled` values. Desktop and Mobile use
the same generated request/response contract; the former single-category
mutation is removed rather than retained as an optional-revision path.

Future extensibility: the `NotificationType type` field in `NotificationPreference` proto (§4.2) is reserved for per-type overrides (e.g., disable `post_liked` while keeping other social notifications enabled). When implemented, per-type preferences override category-level preferences.

### 9.5 Performance Considerations

| Query | Expected Frequency | Strategy |
|-------|--------------------|----------|
| List unread for user | Very High | Composite index: `(recipient_ptid, status)` |
| Get unread counts | Very High | Separate counter table — O(1) read |
| List by category | Medium | Composite index: `(recipient_ptid, category)` |
| Aggregation by group_key | Medium | Index: `(group_key)` |
| Deduplication check | Per notification creation | Composite index: `(recipient_ptid, actor_ptid, type, target_id)` |

Scalability notes:

- Counter table avoids `COUNT(*)` on main table — O(1) unread count reads
- Group aggregation is computed at query time with `GROUP BY group_key` — no separate materialized view needed at current scale
- Background cleanup prevents unbounded table growth
- SSE delivery reuses existing connection infrastructure — no additional connection overhead

---

## 10. Impact Surface

### 10.1 Files Modified (Existing)

| File | Change |
|------|--------|
| `frame/core/event/types.go` | Add 4 `notification.*` event type constants + payload structs |
| `frame/core/event/event.go` | Add `PublishNotificationCreated`, `PublishNotificationCountUpdated` convenience functions |
| `app/main.go` | Register notification SubServer |
| `social/application/post_service.go` | Add `notification.Produce()` calls at like, comment, repost, mention points |
| `social/application/relationship_service.go` | Add `notification.Produce()` calls at follow accepted point |
| `friend_chat/application/service.go` | Add `notification.Produce()` calls at friend request, friend accepted points |
| `group_chat/` (relevant service) | Add `notification.Produce()` calls at group invite point |

### 10.2 Files Created (New)

| File | Purpose |
|------|---------|
| `model/domain/notification/notification.proto` | Proto definition (source of truth) |
| `apps/station/app/subserver/notification/subserver.go` | SubServer lifecycle |
| `apps/station/app/subserver/notification/handler.go` | HTTP handlers |
| `apps/station/app/subserver/notification/application/service.go` | Business logic |
| `apps/station/app/subserver/notification/domain/types.go` | Domain objects |
| `apps/station/app/subserver/notification/domain/producer.go` | Global producer |
| `apps/station/app/subserver/notification/domain/converter.go` | Model converters |
| `apps/station/app/subserver/notification/infrastructure/repo.go` | GORM repository |
| `apps/station/app/subserver/notification/infrastructure/push_crypto.go` | Provider credential encryption and Station-scoped fingerprinting |
| Future `apps/station/app/subserver/notification/push/` | Provider delivery adapters; not part of W7 source closure |

### 10.3 Desktop Changes

| File | Change |
|------|--------|
| `kernel/events/catalog.ts` | Add notification event types |
| `kernel/global-context/types.ts` | Extend NotificationSlice |
| `kernel/global-context/store.ts` | Add notification state handlers |
| New: notification panel component | UI for notification list |
| New: notification settings component | UI for preferences |
| New: `kernel/notification/sound.ts` | Sound playback module with category mapping + audio cache |
| New: `public/sounds/*.wav` | 4 notification sound assets (social, chat, system, task) |
| Future Web Push files | Deferred pending a separate Desktop architecture decision |

### 10.4 Mobile Changes

| File | Change |
|------|--------|
| platform-permissions Swift/Kotlin plugin | Provider callback queue, scheduled reconcile, picker terminal owner |
| Rust `push_bridge.rs` | Active scope, registration transport, generation/sequence fencing, reconcile intent |
| Rust `media_picker.rs` | Native result verification, app-owned staging, opaque handles |
| Rust Station transport | Native-only authenticated registration/unregister operations |

---

## 11. Verification Criteria

1. **Proto compiles**: `tooling/scripts/proto-gen-notification.sh` completes without errors
2. **Station builds**: `cd apps/station && go build ./...` succeeds
3. **Station tests**: `cd apps/station && go test ./...` passes
4. **Go style**: `./tooling/scripts/check-go-style.sh` passes
5. **SubServer starts**: Notification SubServer initializes, tables are migrated, status is `Running`
6. **Produce works**: Calling `notification.Produce()` from social SubServer creates a DB record and pushes an SSE event
7. **List API**: `GET /notification/list` returns paginated notifications for the authenticated user
8. **Unread count**: `GET /notification/unread-counts` returns correct counts from counter table
9. **Mark read**: `POST /notification/read` updates status and decrements counter atomically
10. **Preferences**: Atomic aggregate CAS prevents partial category commits;
    stale writes return the latest snapshot; disabling a category prevents new
    notifications from being created
11. **Deduplication**: Same actor+type+target within 1 hour does not create duplicate
12. **Rate limiting**: Exceeding per-recipient rate limit silently drops notifications
13. **Desktop SSE**: Desktop receives `notification.created` event and updates UI
14. **Desktop badge**: Unread count badge updates in real-time when notification is created/read
15. **Desktop sound plays**: Receiving `notification.created` triggers category-mapped sound via Web Audio API
16. **Desktop sound respects preference**: Disabling `sound_enabled` for a category silences that category
17. **Push registration source**: authenticated PTID/device registration,
    exact replay, rotation, cross-device conflict, unregister, and redacted
    readback pass focused Model/Station/Rust tests
18. **Credential protection**: repository rows contain ciphertext and
    Station-scoped HMAC only; provider credentials are absent from responses
19. **Native callback source**: iOS Swift and Android Kotlin compile with
    generation/sequence-fenced token, receipt, and tap ingress
20. **Scheduled source**: both platforms use the two versioned identifiers and
    exactly-once completion owner
21. **Picker source**: both platforms return one bounded terminal result and
    Rust verifies/moves content to opaque app-owned staging
22. **Physical provider proof**: APNs/FCM/UnifiedPush delivery, invalid-token
    cleanup, scheduler timing/expiration, and picker interaction remain
    `UNPROVEN` until W7-PROOF
23. **Content rendering**: Client renders locale-aware notification text from structured references

---

## 12. Continue Reading

- Execution plans: `architecture/shared/notification/execution-plans/`
  - Phase 1: Proto + domain model
  - Phase 2: Storage + SubServer
  - Phase 3: Delivery + real-time
  - Phase 4: Client presentation
  - Phase 5: Preference + advanced
  - Phase 6: Push Gateway
- Event system guide: `global/coding-guide/station/event-system.md`
- SubServer standard: `station/subserver-standard.md`
- Desktop kernel events: `global/coding-guide/desktop/kernel-events.md`
- Domain model rules: `global/domain-model.md`
