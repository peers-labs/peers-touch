# Launcher SubServer 集成指南

本文档详细说明如何将 Launcher SubServer 集成到 Peers-Touch Station 中。

## 快速开始

### 1. 启用 SubServer

在配置文件中启用 launcher subserver：

**config/config.yaml**
```yaml
peers:
  node:
    server:
      subserver:
        launcher:
          enabled: true           # 启用 launcher subserver
          rds-name: "station.db"  # 数据库名称（可选）
```

### 2. 导入模块

在主程序中导入 launcher 模块，框架会自动注册：

**cmd/station/main.go** 或相关入口文件：
```go
import (
    _ "github.com/peers-labs/peers-touch/station/app/subserver/launcher"
    // 其他导入...
)
```

### 3. 启动服务

启动 station 服务，launcher subserver 会自动初始化并启动：

```bash
cd station
go run cmd/station/main.go
```

查看日志确认启动成功：
```
[INFO] begin to initiate new launcher subserver
[INFO] end to initiate new launcher subserver
[INFO] launcher subserver started
```

## 配置详解

### 完整配置示例

```yaml
peers:
  node:
    server:
      # 主服务器配置
      port: 8080
      host: "0.0.0.0"
      
      # SubServer 配置
      subserver:
        launcher:
          enabled: true           # 是否启用（必需）
          rds-name: "station.db"  # 数据库名称（可选）
```

### 配置项说明

| 配置项 | 类型 | 必需 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `enabled` | bool | 是 | false | 是否启用 launcher subserver |
| `rds-name` | string | 否 | "" | 数据库名称，用于存储用户偏好和历史记录 |

## API 集成

### 端点列表

Launcher SubServer 提供以下 HTTP 端点：

1. **获取个性化信息流**
   - 路径：`GET /api/launcher/feed`
   - 参数：`user_id` (可选), `limit` (可选)

2. **搜索内容**
   - 路径：`GET /api/launcher/search`
   - 参数：`q` (必需), `limit` (可选)

### 客户端调用示例

#### Flutter/Dart 客户端

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class LauncherService {
  final String baseUrl;

  LauncherService(this.baseUrl);

  // 获取信息流
  Future<FeedResponse> getFeed({String? userId, int limit = 20}) async {
    final uri = Uri.parse('$baseUrl/api/launcher/feed').replace(
      queryParameters: {
        if (userId != null) 'user_id': userId,
        'limit': limit.toString(),
      },
    );

    final response = await http.get(uri);
    if (response.statusCode == 200) {
      return FeedResponse.fromJson(json.decode(response.body));
    } else {
      throw Exception('Failed to load feed');
    }
  }

  // 搜索内容
  Future<SearchResponse> search(String query, {int limit = 10}) async {
    final uri = Uri.parse('$baseUrl/api/launcher/search').replace(
      queryParameters: {
        'q': query,
        'limit': limit.toString(),
      },
    );

    final response = await http.get(uri);
    if (response.statusCode == 200) {
      return SearchResponse.fromJson(json.decode(response.body));
    } else {
      throw Exception('Failed to search');
    }
  }
}
```

#### JavaScript/TypeScript 客户端

```typescript
class LauncherService {
  constructor(private baseUrl: string) {}

  async getFeed(userId?: string, limit: number = 20): Promise<FeedResponse> {
    const params = new URLSearchParams({
      ...(userId && { user_id: userId }),
      limit: limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}/api/launcher/feed?${params}`);
    if (!response.ok) {
      throw new Error('Failed to load feed');
    }
    return response.json();
  }

  async search(query: string, limit: number = 10): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}/api/launcher/search?${params}`);
    if (!response.ok) {
      throw new Error('Failed to search');
    }
    return response.json();
  }
}
```

#### cURL 测试

```bash
# 获取信息流
curl "http://localhost:8080/api/launcher/feed?user_id=user123&limit=20"

# 搜索内容
curl "http://localhost:8080/api/launcher/search?q=alice&limit=10"
```

## 数据库集成

如果配置了 `rds-name`，launcher subserver 可以使用数据库存储：

### 数据模型（未来扩展）

```go
// 用户偏好
type UserPreference struct {
    UserID        string    `gorm:"primaryKey"`
    FeedSettings  string    `gorm:"type:text"`
    SearchHistory string    `gorm:"type:text"`
    CreatedAt     time.Time
    UpdatedAt     time.Time
}

// 搜索历史
type SearchHistory struct {
    ID        uint      `gorm:"primaryKey"`
    UserID    string    `gorm:"index"`
    Query     string
    Timestamp time.Time `gorm:"index"`
}
```

### 数据库迁移

在 `plugin.go` 中添加数据库迁移：

```go
func init() {
    config.RegisterOptions(&launcherPluginOptions)
    
    // 注册数据库表迁移
    store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
        _ = rds.AutoMigrate(&model.UserPreference{})
        _ = rds.AutoMigrate(&model.SearchHistory{})
    })
    
    plugin.SubserverPlugins["launcher"] = &launcherPlugin{}
}
```

## 扩展开发

### 添加新的 API 端点

1. 在 `handler.go` 中添加处理函数：

```go
func (s *launcherSubServer) handleNewEndpoint(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    // 实现逻辑
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(response)
}
```

2. 在 `Handlers()` 方法中注册路由：

```go
func (s *launcherSubServer) Handlers() []server.Handler {
    return []server.Handler{
        // 现有路由...
        server.NewHandler(
            launcherURL{name: "launcher-new", path: "/api/launcher/new"},
            http.HandlerFunc(s.handleNewEndpoint),
            server.WithMethod(server.POST),
        ),
    }
}
```

### 添加认证中间件

```go
import (
    "github.com/peers-labs/peers-touch/station/frame/core/auth"
    authhttp "github.com/peers-labs/peers-touch/station/frame/core/auth/http"
)

func (s *launcherSubServer) Handlers() []server.Handler {
    // 需要认证的处理器
    protectedHandler := http.Handler(http.HandlerFunc(s.handleProtected))
    if s.authProvider != nil {
        protectedHandler = authhttp.RequireJWT(s.authProvider)(protectedHandler)
    }

    return []server.Handler{
        server.NewHandler(
            launcherURL{name: "launcher-protected", path: "/api/launcher/protected"},
            protectedHandler,
            server.WithMethod(server.GET),
        ),
    }
}
```

### 集成第三方服务

在 `service/` 目录下创建新的服务文件：

```go
// service/recommendation_service.go
package service

import (
    "context"
    "github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
)

type RecommendationService struct {
    // 第三方服务客户端
}

func NewRecommendationService() *RecommendationService {
    return &RecommendationService{}
}

func (s *RecommendationService) GetRecommendations(ctx context.Context, userID string) ([]model.FeedItem, error) {
    // 调用第三方推荐服务
    return nil, nil
}
```

## 测试

### 单元测试

```go
// launcher_test.go
package launcher

import (
    "context"
    "testing"
)

func TestLauncherSubServer(t *testing.T) {
    s := New()
    
    ctx := context.Background()
    if err := s.Init(ctx); err != nil {
        t.Fatalf("Init failed: %v", err)
    }
    
    if err := s.Start(ctx); err != nil {
        t.Fatalf("Start failed: %v", err)
    }
    
    if s.Status() != server.StatusRunning {
        t.Errorf("Expected status running, got %v", s.Status())
    }
    
    if err := s.Stop(ctx); err != nil {
        t.Fatalf("Stop failed: %v", err)
    }
}
```

### 集成测试

```bash
# 启动服务
go run cmd/station/main.go &

# 等待服务启动
sleep 2

# 测试 API
curl -f "http://localhost:8080/api/launcher/feed" || exit 1
curl -f "http://localhost:8080/api/launcher/search?q=test" || exit 1

# 停止服务
pkill -f station
```

## 监控与日志

### 日志级别

Launcher SubServer 使用以下日志级别：

- `INFO`: 启动、停止、正常请求
- `WARN`: 非致命错误、降级服务
- `ERROR`: 严重错误、服务异常

### 关键日志

```
[INFO] begin to initiate new launcher subserver
[INFO] end to initiate new launcher subserver
[INFO] launcher subserver started
[INFO] fetching personalized feed for user: user123, limit: 20
[INFO] searching content with query: alice, limit: 10
[ERROR] failed to get personalized feed: database connection error
```

### 性能监控

建议监控以下指标：

- API 响应时间（P50, P95, P99）
- 请求成功率
- 错误率
- 并发请求数

## 故障排查

### 常见问题

#### 1. SubServer 未启动

**症状：** 日志中没有 launcher 相关信息

**解决方案：**
- 检查配置文件中 `enabled: true`
- 确认模块已导入：`import _ "github.com/peers-labs/peers-touch/station/app/subserver/launcher"`
- 检查是否有编译错误

#### 2. API 返回 404

**症状：** 访问 `/api/launcher/feed` 返回 404

**解决方案：**
- 确认 SubServer 已成功启动
- 检查路由注册是否正确
- 查看主服务器日志

#### 3. 数据库连接失败

**症状：** 日志中出现数据库错误

**解决方案：**
- 检查 `rds-name` 配置是否正确
- 确认数据库文件路径可访问
- 检查数据库权限

## 性能优化

### 缓存策略

```go
// 使用 Redis 缓存信息流
import "github.com/peers-labs/peers-touch/station/frame/core/cache"

func (s *launcherSubServer) getCachedFeed(ctx context.Context, userID string) (*model.FeedResponse, error) {
    cacheKey := fmt.Sprintf("feed:%s", userID)
    
    // 尝试从缓存获取
    var feed model.FeedResponse
    if err := cache.Get(ctx, cacheKey, &feed); err == nil {
        return &feed, nil
    }
    
    // 缓存未命中，生成新的信息流
    feed, err := service.GetPersonalizedFeed(ctx, userID, 20)
    if err != nil {
        return nil, err
    }
    
    // 写入缓存（5分钟过期）
    _ = cache.Set(ctx, cacheKey, feed, 5*time.Minute)
    
    return feed, nil
}
```

### 并发控制

```go
import "golang.org/x/sync/semaphore"

var searchSemaphore = semaphore.NewWeighted(100) // 最多100个并发搜索

func (s *launcherSubServer) handleSearch(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    
    // 获取信号量
    if err := searchSemaphore.Acquire(ctx, 1); err != nil {
        http.Error(w, "Too many requests", http.StatusTooManyRequests)
        return
    }
    defer searchSemaphore.Release(1)
    
    // 处理搜索请求
    // ...
}
```

## 安全建议

1. **输入验证**
   - 限制搜索关键词长度（建议 1-100 字符）
   - 过滤特殊字符和 SQL 注入
   - 验证 user_id 格式

2. **速率限制**
   - 每个用户每分钟最多 60 次请求
   - 使用 IP 限流防止滥用

3. **访问控制**
   - 信息流应该根据用户权限过滤
   - 搜索结果遵循隐私设置

## 下一步

- [ ] 实现用户偏好存储
- [ ] 添加搜索历史记录
- [ ] 集成推荐算法
- [ ] 添加性能监控
- [ ] 编写更多测试用例

## 参考资料

- [SubServer 开发规范](../../frame/core/server/SUBSERVER_README.zh.md)
- [README](./README.md)
- [Peers-Touch 架构文档](../../docs/architecture.md)
