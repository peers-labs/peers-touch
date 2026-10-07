# Execution Plan — Phase 2: Storage & SubServer Skeleton

> Implements the persistence layer (GORM models, repository, migrations) and the SubServer skeleton (lifecycle, handler registration, dependency wiring).

---

## 1. Objective

- Create GORM models for `notifications`, `notification_counters`, `notification_preferences` tables
- Implement the GormRepo with CRUD, counter operations, aggregation queries
- Create the SubServer skeleton (Init / Start / Stop lifecycle)
- Wire all dependencies (repo → service → handler → SubServer)
- Register the SubServer in `app/main.go`

---

## 2. Dependency

- Phase 1 completed (Proto file exists, domain types defined)

---

## 3. Architectural Context

This phase implements the **Storage Architecture** (Architecture §6) and **System Architecture** skeleton (Architecture §5).

Key architectural constraints from §3.3 and §6:

- **Transactional guarantee**: Notification insert and counter update MUST execute in the same database transaction (§6.1). This prevents counter drift on partial failures.
- **Configurable retention**: Data retention period defaults to 90 days but is configurable per Station instance (§6.3).
- **SubServer registration**: Uses `server.WithSubServer("notification", ...)` in `main.go`, matching the `friend_chat` and `social` registration pattern (not the `plugin.SubserverPlugins` pattern from the SubServer standard doc).

---

## 4. Tasks

### 4.1 Create GORM Models

**File**: `apps/station/app/subserver/notification/infrastructure/repo.go`

Three GORM model structs as specified in Architecture §6.1–§6.2:

#### NotificationModel

```go
type NotificationModel struct {
    ID          uint64    `gorm:"primaryKey;autoIncrement:false"`
    RecipientID string    `gorm:"size:255;not null;index:idx_notif_recipient_status;index:idx_notif_recipient_cat;index:idx_notif_dedup"`
    ActorID     string    `gorm:"size:255;not null;index:idx_notif_dedup"`
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

func (n *NotificationModel) BeforeCreate(tx *gorm.DB) error {
    if n.ID == 0 {
        n.ID = id.NextID()
    }
    return nil
}
```

#### NotificationCounterModel

```go
type NotificationCounterModel struct {
    ID           uint64 `gorm:"primaryKey;autoIncrement:false"`
    ActorID      string `gorm:"size:255;not null;uniqueIndex:idx_notif_counter_actor"`
    TotalUnread  int32  `gorm:"not null;default:0"`
    SocialUnread int32  `gorm:"not null;default:0"`
    ChatUnread   int32  `gorm:"not null;default:0"`
    SystemUnread int32  `gorm:"not null;default:0"`
    TaskUnread   int32  `gorm:"not null;default:0"`
    UpdatedAt    time.Time
}

func (*NotificationCounterModel) TableName() string { return "notification_counters" }
```

#### NotificationPreferenceModel

```go
type NotificationPreferenceModel struct {
    ID           uint64 `gorm:"primaryKey;autoIncrement:false"`
    ActorID      string `gorm:"size:255;not null;uniqueIndex:idx_notif_pref_actor_cat"`
    Category     int32  `gorm:"not null;uniqueIndex:idx_notif_pref_actor_cat"`
    Enabled      bool   `gorm:"not null;default:true"`
    PushEnabled  bool   `gorm:"not null;default:true"`
    SoundEnabled bool   `gorm:"not null;default:true"`
    UpdatedAt    time.Time
}

func (*NotificationPreferenceModel) TableName() string { return "notification_preferences" }
```

### 4.2 Implement GormRepo

**File**: `apps/station/app/subserver/notification/infrastructure/repo.go`

Repository methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `AutoMigrate` | `() error` | GORM AutoMigrate for all 3 tables |
| `Create` | `(n *domain.Notification) error` | Insert notification + increment counter (**single transaction**) |
| `List` | `(recipientID string, opts ListOpts) ([]domain.Notification, string, error)` | Paginated listing with cursor, category filter, status filter |
| `ListGrouped` | `(recipientID string, opts ListOpts) ([]domain.NotificationGroup, string, error)` | GROUP BY group_key aggregation |
| `MarkRead` | `(recipientID string, ids []string) (int32, error)` | Update status + decrement counter (**single transaction**) |
| `MarkAllRead` | `(recipientID string, category *int32) (int32, error)` | Batch mark read by category (**single transaction**) |
| `Delete` | `(recipientID string, ids []string) (int32, error)` | Hard delete + adjust counter (**single transaction**) |
| `GetCounter` | `(actorID string) (*domain.NotificationCounter, error)` | Read counter row (or return zero) |
| `IncrementCounter` | `(actorID string, category int32) error` | Atomic increment |
| `DecrementCounter` | `(actorID string, category int32, count int32) error` | Atomic decrement with floor at 0 |
| `CheckDuplicate` | `(recipientID, actorID string, notifType int32, targetID string) (bool, error)` | Dedup check within 1 hour |
| `GetPreferences` | `(actorID string) ([]domain.NotificationPreference, error)` | List all preferences |
| `UpsertPreference` | `(pref *domain.NotificationPreference) error` | Create or update preference |
| `CleanupExpired` | `(olderThan time.Duration, statuses []int32) (int64, error)` | Delete expired notifications |

#### Transactional Create Pattern

The `Create` method MUST wrap notification insert + counter increment in a single transaction (Architecture §6.1):

```go
func (r *GormRepo) Create(n *domain.Notification) error {
    return r.db.Transaction(func(tx *gorm.DB) error {
        model := domain.ToModel(n)
        if err := tx.Create(model).Error; err != nil {
            return err
        }
        return r.incrementCounterInTx(tx, n.RecipientID, int32(n.Category))
    })
}
```

#### Counter Increment Pattern (atomic)

```go
func (r *GormRepo) incrementCounterInTx(tx *gorm.DB, actorID string, category int32) error {
    categoryColumn := categoryToColumn(category)
    result := tx.Model(&NotificationCounterModel{}).
        Where("actor_id = ?", actorID).
        Updates(map[string]interface{}{
            "total_unread":  gorm.Expr("total_unread + 1"),
            categoryColumn:  gorm.Expr(categoryColumn + " + 1"),
        })
    if result.RowsAffected == 0 {
        counter := &NotificationCounterModel{
            ActorID:     actorID,
            TotalUnread: 1,
        }
        setCategoryField(counter, category, 1)
        return tx.Create(counter).Error
    }
    return result.Error
}
```

### 4.3 Create Application Service

**File**: `apps/station/app/subserver/notification/application/service.go`

```go
type Repository interface {
    Create(n *domain.Notification) error
    List(recipientID string, opts ListOpts) ([]domain.Notification, string, error)
    ListGrouped(recipientID string, opts ListOpts) ([]domain.NotificationGroup, string, error)
    MarkRead(recipientID string, ids []string) (int32, error)
    MarkAllRead(recipientID string, category *int32) (int32, error)
    Delete(recipientID string, ids []string) (int32, error)
    GetCounter(actorID string) (*domain.NotificationCounter, error)
    CheckDuplicate(recipientID, actorID string, notifType int32, targetID string) (bool, error)
    GetPreferences(actorID string) ([]domain.NotificationPreference, error)
    UpsertPreference(pref *domain.NotificationPreference) error
}

type Service struct {
    repo Repository
}

func NewService(repo Repository) *Service
```

Service methods:

| Method | Description |
|--------|-------------|
| `Produce(ctx, params)` | Core production pipeline (Architecture §5.5): self-guard → preference → rate limit → dedup → create → publish event |
| `List(ctx, actorID, opts)` | Delegate to repo with cursor pagination |
| `ListGrouped(ctx, actorID, opts)` | Delegate to repo for aggregated view |
| `MarkRead(ctx, actorID, ids)` | Mark read → decrement counter → publish count update event |
| `MarkAllRead(ctx, actorID, category)` | Mark all read → reset counter → publish count update event |
| `Delete(ctx, actorID, ids)` | Delete → adjust counter → publish count update event |
| `GetUnreadCounts(ctx, actorID)` | Read counter table |
| `GetPreferences(ctx, actorID)` | Read preferences |
| `UpdatePreference(ctx, actorID, pref)` | Upsert preference |

### 4.4 Create SubServer Skeleton

**File**: `apps/station/app/subserver/notification/subserver.go`

```go
type subServer struct {
    mu         sync.RWMutex
    status     server.Status
    jwtWrapper server.Wrapper
    service    *application.Service
    repo       *infrastructure.GormRepo
    cancel     context.CancelFunc
    config     Config
}

type Config struct {
    RetentionDays int `yaml:"retention_days" default:"90"`
}

func NewNotificationSubServer(opts ...option.Option) server.Subserver {
    return &subServer{status: server.StatusStopped}
}

func (s *subServer) Name() string               { return "notification" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
```

### 4.5 Create Handler Registration

**File**: `apps/station/app/subserver/notification/handler.go`

8 core handlers + push device handlers as defined in Architecture §5.7:

```go
func (s *subServer) Handlers() []server.Handler {
    logIDWrapper := serverwrapper.LogID()
    return []server.Handler{
        server.NewTypedHandler("notif-list", "/notification/list", server.GET,
            s.handleList, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("notif-grouped", "/notification/grouped", server.GET,
            s.handleListGrouped, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("notif-read", "/notification/read", server.POST,
            s.handleMarkRead, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("notif-read-all", "/notification/read-all", server.POST,
            s.handleMarkAllRead, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("notif-delete", "/notification/delete", server.POST,
            s.handleDelete, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("notif-unread-counts", "/notification/unread-counts", server.GET,
            s.handleGetUnreadCounts, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("notif-preferences", "/notification/preferences", server.GET,
            s.handleGetPreferences, logIDWrapper, s.jwtWrapper),
        server.NewTypedHandler("notif-preferences-update", "/notification/preferences", server.POST,
            s.handleUpdatePreference, logIDWrapper, s.jwtWrapper),
    }
}
```

### 4.6 Register SubServer

**File**: `apps/station/app/main.go`

Add notification SubServer using `server.WithSubServer("notification", notification.NewNotificationSubServer)`, following the existing `friend_chat` and `social` registration pattern.

---

## 5. Verification

```bash
# Go compilation
cd apps/station && go build ./...

# Go tests
cd apps/station && go test ./app/subserver/notification/...

# Go style
./tooling/scripts/check-go-style.sh

# Start Station and verify:
# 1. Tables created in PostgreSQL (notifications, notification_counters, notification_preferences)
# 2. SubServer status = Running
# 3. All 8 endpoints respond (even if with empty results)
```

---

## 6. Deliverables

| Deliverable | Path |
|-------------|------|
| GORM models + repo | `apps/station/app/subserver/notification/infrastructure/repo.go` |
| Application service | `apps/station/app/subserver/notification/application/service.go` |
| SubServer lifecycle | `apps/station/app/subserver/notification/subserver.go` |
| HTTP handlers | `apps/station/app/subserver/notification/handler.go` |
| Registration | Modified `app/main.go` |

---

## 7. Next Phase

Phase 3: Delivery & Real-time Push
