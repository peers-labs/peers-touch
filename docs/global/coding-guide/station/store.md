# Station 存储/数据库指南

> 源码位置: `apps/station/frame/core/store/`

## 1. 架构概览

Station 的存储层基于 GORM 封装, 采用**依赖注入 + 全局访问器**模式. 核心设计:

- `Store` 接口抽象了所有存储操作
- 通过 `InjectStore` 注入具体实现, `GetStore`/`GetRDS` 全局获取
- 支持多数据库实例 (通过 `RDSMap`)
- 驱动注册机制 (`RegisterDriver`) 解耦数据库方言
- `InitTableHooks` 钩子模式实现分布式表迁移

```
驱动注册 (SQLite/PostgreSQL)
       │
       ▼
  nativeStore.Init()
       │
       ├── 按 RDSMap 配置创建 gorm.DB 实例
       ├── InjectStore() 全局注入
       └── 执行 afterInitHooks (AutoMigrate)
       │
       ▼
  业务层通过 store.GetRDS(ctx) 获取 *gorm.DB
```

---

## 2. Store 接口

```go
// frame/core/store/store.go
type Store interface {
    Init(ctx context.Context, opts ...option.Option) error
    RDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error)
    Name() string
}
```

| 方法 | 说明 |
|------|------|
| `Init` | 初始化存储, 创建数据库连接 |
| `RDS` | 获取 GORM DB 实例, 可通过 `RDSDMLOption` 指定库名 |
| `Name` | 返回存储实现的名称 (如 `"native"`) |

---

## 3. 全局访问器

### 3.1 GetRDS - 获取数据库实例

```go
func GetRDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error)
```

这是业务代码最常用的入口:

```go
// 获取默认数据库
rds, err := store.GetRDS(ctx)

// 获取指定名称的数据库
rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))

// 获取指定 RDS 实例
rds, err := store.GetRDS(ctx, store.WithRDSName("postgres"))
```

### 3.2 GetStore - 获取 Store 实例

```go
func GetStore(ctx context.Context, opts ...GetOption) (Store, error)
```

当需要直接操作 Store 接口时使用, 通常不需要直接调用.

### 3.3 InjectStore - 注入 Store 实现

```go
func InjectStore(ctx context.Context, s Store) error
```

由框架在启动时调用, 将具体的 Store 实现注入到全局单例. 此方法只能调用一次, 重复调用返回 `ErrStoreAlreadyInjected`.

---

## 4. RDS 查询选项

```go
// frame/core/store/options.go
type RDSDMLOption func(*RDSDMLOptions)

type RDSDMLOptions struct {
    Name   string   // RDS 实例名称 (标识不同的数据库连接)
    DBName string   // 数据库名称 (同一实例下的不同库)
}
```

两个选项函数:

```go
// 选择特定 RDS 实例 (对应 YAML 中 gorm 数组的 name 字段)
store.WithRDSName("postgres")

// 选择特定数据库名 (在同一 RDS 实例下切换库)
store.WithRDSDBName("ai_chat")
```

使用场景:

```go
// 场景一: 系统只有一个默认数据库
rds, err := store.GetRDS(ctx)

// 场景二: 子服务使用独立数据库
rds, err := store.GetRDS(ctx, store.WithRDSDBName("oss"))

// 场景三: 连接不同类型的数据库实例
rds, err := store.GetRDS(ctx, store.WithRDSName("postgres"))
```

---

## 5. GORM 驱动注册

```go
// frame/core/store/gorm.go
func RegisterDriver(name string, open func(dsn string) gorm.Dialector)
func GetDialector(name string) func(name string) gorm.Dialector
```

驱动需要在 `init()` 中注册, 名称对应 YAML 配置中的 `driver` 字段:

```go
// frame/core/plugin/store/rds/sqlite/
func init() {
    store.RegisterDriver("sqlite", func(dsn string) gorm.Dialector {
        return sqlite.Open(dsn)
    })
}
```

重复注册同名驱动会 panic.

### 5.1 YAML 驱动配置

```yaml
peers:
  store:
    rds:
      gorm:
        - name: sqlite
          driver: sqlite
          default: true
          enable: true
          dsn: "file:peers.db?cache=shared&_fk=1"

        - name: postgres
          driver: postgres
          enable: false
          default: false
          dsn: "host=localhost user=peer password=peer dbname=peer_native port=5432 sslmode=disable"

        - name: oss
          driver: postgres
          enable: false
          default: false
          dsn: "host=localhost user=peers_touch password=peers_touch dbname=peers_touch port=5432 sslmode=disable"
```

每个 RDS 配置项:

| 字段 | 说明 |
|------|------|
| `name` | 实例标识名, 用于 `WithRDSName` 查找 |
| `driver` | 驱动名, 对应 `RegisterDriver` 注册的名称 |
| `default` | 是否为默认实例, `GetRDS(ctx)` 不带选项时使用 |
| `enable` | 是否启用, `false` 时跳过初始化 |
| `dsn` | GORM 连接字符串 |

---

## 6. Native Store 实现

`frame/core/plugin/native/store/native.go` 是框架内置的 Store 实现:

```go
type nativeStore struct {
    opts       *store.Options
    defaultRDS string            // 默认 RDS 实例名
    db         map[string]*gorm.DB  // name -> gorm.DB 实例池
}
```

初始化流程:

```go
func (n *nativeStore) Init(ctx context.Context, opts ...option.Option) error {
    // 1. 遍历 RDSMap, 为每个 enabled 的配置创建 gorm.DB
    for _, rds := range n.opts.RDSMap {
        if rds.Enable {
            dialector := store.GetDialector(rds.Driver)
            n.db[rds.Name], _ = gorm.Open(dialector(rds.DSN), gormConfig)
            if rds.Default {
                n.defaultRDS = rds.Name
            }
        }
    }

    // 2. 注入到全局 store
    store.InjectStore(ctx, n)

    // 3. 执行所有 afterInitHooks (AutoMigrate 等)
    for _, hook := range store.GetAfterInitHooks() {
        hook(ctx, n.db[n.defaultRDS])
    }
}
```

---

## 7. InitTableHooks 模式

这是 Station 中实现**分布式表自动迁移**的核心模式. 各模块通过 `init()` 注册迁移钩子, 框架在 Store 初始化完成后统一执行.

### 7.1 API

```go
// frame/core/store/rds.go
func InitTableHooks(funcs ...func(ctx context.Context, rds *gorm.DB))
func GetAfterInitHooks() []func(ctx context.Context, rds *gorm.DB)
```

### 7.2 使用方式一: 集中式迁移

在 `model/db/automigrate.go` 中集中注册所有核心表:

```go
// frame/touch/model/db/automigrate.go
func init() {
    store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
        err := rds.AutoMigrate(
            &Actor{}, &ActorTouchMeta{}, &PeerAddress{}, &ActorStatus{},
            &OAuthClient{}, &OAuthAuthCode{}, &OAuthToken{},
            &Conversation{}, &ConvMember{}, &Message{},
            &Post{}, &PostContent{}, &PostMedia{},
            &Follow{}, &PollVote{},
        )
        if err != nil {
            panic(fmt.Errorf("auto migrate failed: %v", err))
        }
    })
}
```

### 7.3 使用方式二: 模块级迁移

每个子服务在自己的 model 包中注册:

```go
// app/subserver/friend_chat_old/db/model/init.go
func init() {
    store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
        err := rds.AutoMigrate(
            &FriendChatSession{},
            &FriendChatMessage{},
            &FriendMessageAttachment{},
            &OfflineMessage{},
        )
        if err != nil {
            panic(fmt.Errorf("friend chat auto migrate failed: %v", err))
        }
    })
}
```

### 7.4 使用方式三: 插件 init 中注册

```go
// app/subserver/oss/plugin.go
func init() {
    config.RegisterOptions(&ossOptions)
    store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
        _ = rds.AutoMigrate(&ossmodel.FileMeta{})
    })
    plugin.SubserverPlugins["oss"] = &ossPlugin{}
}
```

### 7.5 使用方式四: 服务初始化中注入依赖

除了 AutoMigrate, 钩子也可用于初始化依赖:

```go
// frame/touch/social/service/post_service.go
func init() {
    store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
        gormDB = rds
        postRepo = repository.NewPostRepository(rds)
        postContentRepo = repository.NewPostContentRepository(rds)
        likeRepo = repository.NewLikeRepository(rds)
        postConverter = converter.NewPostConverter(likeRepo)
    })
}
```

---

## 8. Subserver 中的数据库使用模式

### 8.1 在 Init 中获取 RDS 并迁移

这是 subserver 中最常见的模式:

```go
func (s *aiChatSubServer) Init(ctx context.Context, opts ...option.Option) error {
    // 获取指定名称的数据库
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.opts.DBName))
    if err != nil {
        return err
    }

    // 自动迁移表结构
    if err = rds.AutoMigrate(
        &models.User{},
        &models.Provider{},
        &models.Session{},
        &models.Topic{},
        &models.Message{},
    ); err != nil {
        return err
    }

    return nil
}
```

### 8.2 在服务层获取 RDS

服务层方法中按需获取:

```go
type memberService struct {
    dbName string
}

func (s *memberService) getDB(ctx context.Context) (*gorm.DB, error) {
    return store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
}

func (s *memberService) AddMember(ctx context.Context, groupULID, actorDID string) error {
    rds, err := s.getDB(ctx)
    if err != nil {
        return err
    }
    return rds.Create(&model.GroupMember{
        GroupULID: groupULID,
        ActorDID:  actorDID,
    }).Error
}
```

### 8.3 DDD 架构中的 Repository 模式

friend_chat 子服务展示了更标准的 DDD 用法:

```go
// infrastructure 层
func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
    rds, err := store.GetRDS(ctx)
    if err != nil {
        return err
    }

    // 创建 Repository
    repo := infrastructure.NewGormRepo(rds)
    if err := repo.AutoMigrate(); err != nil {
        return err
    }

    // 注入到应用服务
    s.service = application.NewService(repo)
    return nil
}
```

---

## 9. 事务使用模式

GORM 事务在 Station 中的标准写法:

```go
func (s *service) TransferFunds(ctx context.Context, from, to string, amount int) error {
    rds, err := store.GetRDS(ctx)
    if err != nil {
        return err
    }

    return rds.Transaction(func(tx *gorm.DB) error {
        if err := tx.Model(&Account{}).
            Where("id = ?", from).
            Update("balance", gorm.Expr("balance - ?", amount)).Error; err != nil {
            return err
        }

        if err := tx.Model(&Account{}).
            Where("id = ?", to).
            Update("balance", gorm.Expr("balance + ?", amount)).Error; err != nil {
            return err
        }

        return nil
    })
}
```

---

## 10. Model 定义规范

Station 中 GORM Model 的典型写法:

```go
type GroupMember struct {
    GroupULID string `gorm:"primaryKey"`
    ActorDID  string `gorm:"primaryKey"`
    Role      int
    InvitedBy string
    CreatedAt time.Time
    UpdatedAt time.Time
}

type SessionRecord struct {
    SessionID    string     `gorm:"primaryKey;size:64"`
    UserID       string     `gorm:"index;size:64"`
    Email        string     `gorm:"size:256"`
    DeviceType   DeviceType `gorm:"size:32;default:'desktop'"`
    IPAddress    string     `gorm:"size:45"`
    UserAgent    string     `gorm:"size:512"`
    CreatedAt    time.Time
    ExpiresAt    time.Time  `gorm:"index"`
    LastActiveAt time.Time
    Revoked      bool       `gorm:"default:false"`
}
```

---

## 11. 错误处理

Store 包定义了标准错误:

```go
var ErrDBNotFound = errors.New("database not found")
var ErrStoreNotDefined = errors.New("store not defined")
var ErrStoreInitFailed = func(name string) error {
    return fmt.Errorf("store[%s] init failed", name)
}
var ErrStoreAlreadyInjected = errors.New("store already injected")
```

业务代码中应正确处理:

```go
rds, err := store.GetRDS(ctx)
if err != nil {
    if errors.Is(err, store.ErrStoreNotDefined) {
        // Store 尚未初始化
    }
    return err
}
```

---

## 12. 测试中的 Mock Store

单元测试中使用内存 SQLite:

```go
type MockStore struct {
    db *gorm.DB
}

func (m *MockStore) Init(ctx context.Context, opts ...option.Option) error { return nil }

func (m *MockStore) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*gorm.DB, error) {
    return m.db, nil
}

func (m *MockStore) Name() string { return "mock-store" }

func setupMockStore() error {
    db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
    if err != nil {
        return err
    }
    return store.InjectStore(context.Background(), &MockStore{db: db})
}
```
