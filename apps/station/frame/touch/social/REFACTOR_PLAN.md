# 发帖系统重构方案

## 🎯 目标

从 ActivityPub 架构迁移到现代互联网应用架构，专注于单节点性能和用户体验。

## 📐 新架构设计

### 层次结构

```
┌─────────────────────────────────────┐
│  HTTP Handler (Gin)                 │  ← API 层
├─────────────────────────────────────┤
│  Service Layer                      │  ← 业务逻辑
│  ├─ PostService                     │
│  ├─ CommentService                  │
│  ├─ TimelineService                 │
│  └─ InteractionService              │
├─────────────────────────────────────┤
│  Repository Layer                   │  ← 数据访问
│  ├─ PostRepository                  │
│  ├─ CommentRepository               │
│  └─ UserRepository                  │
├─────────────────────────────────────┤
│  Database (PostgreSQL)              │  ← 持久化
└─────────────────────────────────────┘
```

### 核心原则

1. **单一职责**：每个 Service 只负责一个领域
2. **依赖注入**：通过构造函数注入依赖
3. **接口优先**：面向接口编程，便于测试
4. **事务管理**：Repository 层处理事务
5. **错误处理**：统一的错误类型和处理

## 🗂️ 目录结构

```
station/frame/touch/social/
├── service/
│   ├── post_service.go          # 帖子核心业务
│   ├── post_service_test.go     # 单元测试
│   ├── comment_service.go       # 评论业务
│   ├── comment_service_test.go
│   ├── timeline_service.go      # 时间线业务
│   ├── timeline_service_test.go
│   └── interaction_service.go   # 互动业务（点赞、转发）
│
├── repository/
│   ├── post_repository.go       # 帖子数据访问
│   ├── post_repository_test.go
│   ├── comment_repository.go
│   └── user_repository.go
│
├── handler/
│   ├── post_handler.go          # HTTP 处理器
│   ├── post_handler_test.go
│   ├── comment_handler.go
│   └── timeline_handler.go
│
├── router/
│   └── social_router.go         # 路由注册
│
├── converter/
│   └── post_converter.go        # DB ↔ Proto 转换
│
└── REFACTOR_PLAN.md             # 本文档
```

## 🔄 迁移步骤

### Phase 1: 基础设施（Week 1）

- [x] 创建 Proto 定义
  - [x] `social/post.proto`
  - [x] `social/comment.proto`
- [x] 创建数据库模型
  - [x] `model/db/post.go`
- [ ] 生成 Proto 代码
  ```bash
  cd model
  protoc --go_out=. --go_opt=paths=source_relative \
    domain/social/*.proto
  ```
- [ ] 数据库迁移脚本
- [ ] 编写测试辅助函数

### Phase 2: Repository 层（Week 1-2）

- [ ] `PostRepository` 接口和实现
  - [ ] CreatePost
  - [ ] GetPostByID
  - [ ] UpdatePost
  - [ ] DeletePost
  - [ ] ListPosts (带分页)
- [ ] `CommentRepository`
- [ ] `UserRepository`
- [ ] 单元测试（使用 testify/mock）

### Phase 3: Service 层（Week 2）

- [ ] `PostService` 实现
  - [ ] CreatePost (业务验证)
  - [ ] GetPost (权限检查)
  - [ ] UpdatePost
  - [ ] DeletePost
  - [ ] LikePost (事务处理)
  - [ ] UnlikePost
- [ ] `TimelineService` 实现
  - [ ] GetHomeTimeline (关注者帖子)
  - [ ] GetUserTimeline (用户帖子)
  - [ ] GetPublicTimeline
- [ ] `CommentService` 实现
- [ ] 单元测试（Mock Repository）

### Phase 4: Handler 层（Week 2-3）

- [ ] `PostHandler` 实现
  - [ ] POST /api/v1/posts
  - [ ] GET /api/v1/posts/:id
  - [ ] PUT /api/v1/posts/:id
  - [ ] DELETE /api/v1/posts/:id
  - [ ] POST /api/v1/posts/:id/like
  - [ ] DELETE /api/v1/posts/:id/like
- [ ] `TimelineHandler` 实现
- [ ] `CommentHandler` 实现
- [ ] 集成测试（使用 httptest）

### Phase 5: 客户端适配（Week 3）

- [ ] 移除 ActivityPub 相关 Dart 代码
- [ ] 创建新的 API Client
  ```dart
  // lib/services/api/social_api.dart
  class SocialApi {
    Future<Post> createPost(CreatePostRequest req);
    Future<List<Post>> getTimeline(TimelineType type);
    Future<void> likePost(String postId);
  }
  ```
- [ ] 更新 GetX Controllers
  ```dart
  // lib/features/post/controller/post_controller.dart
  class PostController extends GetxController {
    final SocialApi _api;
    final posts = <Post>[].obs;
    
    Future<void> createPost(String content) async {
      final post = await _api.createPost(...);
      posts.insert(0, post);
    }
  }
  ```
- [ ] UI 保持不变（只改数据层）

### Phase 6: 测试和优化（Week 3-4）

- [ ] E2E 测试
- [ ] 性能测试（压测）
- [ ] 添加缓存（Redis）
- [ ] 添加监控（Prometheus）

## 🧪 测试策略

### 单元测试示例

```go
// service/post_service_test.go
func TestPostService_CreatePost(t *testing.T) {
    mockRepo := new(MockPostRepository)
    service := NewPostService(mockRepo, nil)
    
    req := &model.CreatePostRequest{
        Content: "Hello World",
        Visibility: model.PostVisibility_PUBLIC,
    }
    
    mockRepo.On("Create", mock.Anything).Return(&db.Post{
        ID: 123,
        Content: "Hello World",
    }, nil)
    
    post, err := service.CreatePost(context.Background(), req, 1)
    
    assert.NoError(t, err)
    assert.Equal(t, "Hello World", post.Content)
    mockRepo.AssertExpectations(t)
}
```

### 集成测试示例

```go
// handler/post_handler_test.go
func TestPostHandler_CreatePost(t *testing.T) {
    router := setupTestRouter()
    
    body := `{"content":"Test post","visibility":"PUBLIC"}`
    req := httptest.NewRequest("POST", "/api/v1/posts", strings.NewReader(body))
    req.Header.Set("Authorization", "Bearer test-token")
    req.Header.Set("Content-Type", "application/json")
    
    w := httptest.NewRecorder()
    router.ServeHTTP(w, req)
    
    assert.Equal(t, 200, w.Code)
    
    var resp model.CreatePostResponse
    json.Unmarshal(w.Body.Bytes(), &resp)
    assert.Equal(t, "Test post", resp.Post.Content)
}
```

## 🔌 API 设计

### RESTful 端点

```
POST   /api/v1/posts                    # 创建帖子
GET    /api/v1/posts/:id                # 获取帖子
PUT    /api/v1/posts/:id                # 更新帖子
DELETE /api/v1/posts/:id                # 删除帖子

POST   /api/v1/posts/:id/like           # 点赞
DELETE /api/v1/posts/:id/like           # 取消点赞
GET    /api/v1/posts/:id/likers         # 点赞列表

POST   /api/v1/posts/:id/repost         # 转发
GET    /api/v1/posts/:id/comments       # 评论列表
POST   /api/v1/posts/:id/comments       # 创建评论

GET    /api/v1/timelines/home           # 首页时间线
GET    /api/v1/timelines/user/:id       # 用户时间线
GET    /api/v1/timelines/public         # 公共时间线
```

### 请求示例

```bash
# 创建帖子
curl -X POST http://localhost:8080/api/v1/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello, Peers-Touch!",
    "visibility": "PUBLIC"
  }'

# 获取首页时间线
curl http://localhost:8080/api/v1/timelines/home?limit=20 \
  -H "Authorization: Bearer $TOKEN"

# 点赞帖子
curl -X POST http://localhost:8080/api/v1/posts/123/like \
  -H "Authorization: Bearer $TOKEN"
```

## 📊 性能优化

### 数据库索引

```sql
-- 时间线查询优化
CREATE INDEX idx_posts_author_created ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts(created_at DESC) WHERE deleted_at IS NULL;

-- 点赞查询优化
CREATE INDEX idx_post_likes_post_created ON post_likes(post_id, created_at DESC);
CREATE INDEX idx_post_likes_user_post ON post_likes(user_id, post_id);

-- 关注关系查询
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
```

### 缓存策略

```go
// 热门帖子缓存（Redis）
func (s *PostService) GetPost(ctx context.Context, postID string) (*model.Post, error) {
    // 1. 尝试从缓存读取
    cached, err := s.cache.Get(ctx, "post:"+postID)
    if err == nil {
        return cached, nil
    }
    
    // 2. 从数据库读取
    post, err := s.repo.GetByID(ctx, postID)
    if err != nil {
        return nil, err
    }
    
    // 3. 写入缓存（TTL 5分钟）
    s.cache.Set(ctx, "post:"+postID, post, 5*time.Minute)
    
    return post, nil
}
```

### 分页优化

使用游标分页而非 offset：

```go
// 基于时间戳 + ID 的游标
type Cursor struct {
    CreatedAt time.Time
    ID        uint64
}

func (s *TimelineService) GetHomeTimeline(ctx context.Context, userID uint64, cursor string, limit int) (*model.GetTimelineResponse, error) {
    var c Cursor
    if cursor != "" {
        c = decodeCursor(cursor)
    }
    
    // WHERE (created_at, id) < (cursor.CreatedAt, cursor.ID)
    // ORDER BY created_at DESC, id DESC
    // LIMIT limit
    
    posts, err := s.repo.ListPostsByCursor(ctx, userID, c, limit)
    // ...
}
```

## 🚀 部署计划

### 灰度发布

1. **双写阶段**：新旧系统同时写入
2. **读切换**：逐步切换读流量到新系统
3. **验证阶段**：监控错误率和性能
4. **完全切换**：停止旧系统写入
5. **清理阶段**：移除旧代码和表

### 回滚方案

- 保留旧 API 端点 2 周
- 数据库表保留 1 个月
- 客户端支持降级到旧 API

## ✅ 验收标准

### 功能完整性

- [ ] 所有 API 端点正常工作
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试通过
- [ ] E2E 测试通过

### 性能指标

- [ ] 创建帖子 < 100ms (p99)
- [ ] 获取时间线 < 200ms (p99)
- [ ] 点赞操作 < 50ms (p99)
- [ ] 支持 1000 QPS

### 用户体验

- [ ] 客户端 UI 无变化
- [ ] 功能无缺失
- [ ] 无数据丢失

## 📚 参考资料

- [Twitter's Timeline Architecture](https://blog.twitter.com/engineering/en_us/topics/infrastructure/2017/the-infrastructure-behind-twitter-scale)
- [Instagram's Feed Architecture](https://instagram-engineering.com/what-powers-instagram-hundreds-of-instances-dozens-of-technologies-adf2e22da2ad)
- [Clean Architecture in Go](https://github.com/bxcodec/go-clean-arch)
