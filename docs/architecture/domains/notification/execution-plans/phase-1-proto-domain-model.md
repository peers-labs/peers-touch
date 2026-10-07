# Execution Plan — Phase 1: Proto Definition & Domain Model

> Defines the notification proto source of truth and Go domain model types. This is the foundation for all subsequent phases.

---

## 1. Objective

- Create `model/domain/notification/notification.proto` as the Proto-First source of truth
- Run proto generation to produce Go bindings
- Create Go domain types in the notification SubServer's `domain/` package
- Create converter functions between Proto ⟷ Domain ⟷ GORM Model

---

## 2. Dependency

- None (this is the first phase)

---

## 3. Architectural Context

This phase implements the **Domain Model** layer defined in Architecture §4. All data types created here derive from the architectural identity established in §3:

- Notification is an observer of business domains — domain types model the **derived record**, not the business entity itself
- Proto-First is mandatory per project Iron Laws (AGENTS.md §5)
- Content strategy (§4.6): `title`/`body` are server-generated fallback text; structured references (`type`, `actor_id`, `target_type`, `target_id`) are the primary semantic content

---

## 4. Tasks

### 4.1 Create Proto File

**File**: `model/domain/notification/notification.proto`

Full proto definition as specified in Architecture §4.2. Key decisions:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package | `peers_touch.model.notification.v1` | Follows `peers_touch.model.<domain>.v1` convention |
| go_package | `github.com/peers-labs/peers-touch/station/frame/touch/model/notification;notification` | Separate Go package (like `chat`) for namespace isolation |
| Enum numbering | Category-based ranges (100s, 200s, 300s, 400s) | Allows future type additions without renumbering |
| ID type | `string` | Consistent with all existing protos |
| Timestamp | `google.protobuf.Timestamp` | Project-wide convention |
| Pagination | cursor-based (`cursor` + `limit` + `next_cursor`) | Follows `social/relationship.proto` pattern |
| Preference `type` field | `NotificationType type = 7` (reserved) | Per-type override extensibility (Architecture §9.4) |

The proto includes:

- Core model: `Notification`, `NotificationGroup`
- Enums: `NotificationCategory`, `NotificationType`, `NotificationStatus`
- Preference: `NotificationPreference` (with reserved `type` field for future per-type control)
- API messages: List, Grouped, MarkRead, MarkAllRead, Delete, UnreadCounts, Preferences
- Push: `PushChannelType`, `PushDevice`, Register/Unregister/List device messages

### 4.2 Run Proto Generation

```bash
./model/build.sh
```

Verify:
- Generated Go files appear in `apps/station/frame/touch/model/notification/`
- No compilation errors: `cd apps/station && go build ./...`

### 4.3 Create Domain Types

**File**: `apps/station/app/subserver/notification/domain/types.go`

```go
package domain

import "time"

type NotificationType int32
type NotificationCategory int32
type NotificationStatus int32

const (
    CategoryUnspecified NotificationCategory = 0
    CategorySocial     NotificationCategory = 1
    CategoryChat       NotificationCategory = 2
    CategorySystem     NotificationCategory = 3
    CategoryTask       NotificationCategory = 4
)

const (
    StatusUnspecified NotificationStatus = 0
    StatusUnread      NotificationStatus = 1
    StatusRead        NotificationStatus = 2
    StatusArchived    NotificationStatus = 3
)

type Notification struct {
    ID          uint64
    RecipientID string
    ActorID     string
    Type        NotificationType
    Category    NotificationCategory
    Status      NotificationStatus
    TargetType  string
    TargetID    string
    Title       string
    Body        string
    Metadata    map[string]string
    GroupKey    string
    ReadAt      *time.Time
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

type NotificationGroup struct {
    GroupKey   string
    Type      NotificationType
    Category  NotificationCategory
    TargetType string
    TargetID   string
    Title     string
    Body      string
    Count     int32
    ActorIDs  []string
    Latest    *Notification
    UpdatedAt time.Time
}

type NotificationCounter struct {
    ID           uint64
    ActorID      string
    TotalUnread  int32
    SocialUnread int32
    ChatUnread   int32
    SystemUnread int32
    TaskUnread   int32
    UpdatedAt    time.Time
}

type NotificationPreference struct {
    ID           uint64
    ActorID      string
    Category     NotificationCategory
    Enabled      bool
    PushEnabled  bool
    SoundEnabled bool
    UpdatedAt    time.Time
}
```

### 4.4 Create Producer Interface

**File**: `apps/station/app/subserver/notification/domain/producer.go`

Global producer singleton as specified in Architecture §5.4.

Key design:

- `Producer` interface with single `Produce(ctx, params)` method
- `ProduceParams` struct with all required fields
- `SetGlobalProducer` / `GetGlobalProducer` for singleton management
- `Produce()` convenience function that silently returns nil when producer is not initialized — this is the **failure transparency** guarantee (Architecture §3.3)

### 4.5 Create Converter Functions

**File**: `apps/station/app/subserver/notification/domain/converter.go`

Conversion functions:

| Function | From | To |
|----------|------|-----|
| `ToProto(n *Notification)` | Domain Notification | Proto Notification |
| `FromProto(pb *proto.Notification)` | Proto Notification | Domain Notification |
| `ToModel(n *Notification)` | Domain Notification | GORM NotificationModel |
| `FromModel(m *NotificationModel)` | GORM NotificationModel | Domain Notification |
| `CounterToProto(c *NotificationCounter)` | Domain Counter | Proto GetUnreadCountsResponse |
| `PreferenceToProto(p *NotificationPreference)` | Domain Preference | Proto NotificationPreference |

---

## 5. Verification

```bash
# Proto generation
./model/build.sh

# Go compilation
cd apps/station && go build ./...

# Go style
./tooling/scripts/check-go-style.sh
```

---

## 6. Deliverables

| Deliverable | Path |
|-------------|------|
| Proto file | `model/domain/notification/notification.proto` |
| Generated Go | `apps/station/frame/touch/model/notification/*.pb.go` |
| Domain types | `apps/station/app/subserver/notification/domain/types.go` |
| Producer | `apps/station/app/subserver/notification/domain/producer.go` |
| Converter | `apps/station/app/subserver/notification/domain/converter.go` |

---

## 7. Next Phase

Phase 2: Storage & SubServer Skeleton
