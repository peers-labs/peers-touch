# Launcher SubServer

## 概述

Launcher SubServer 为 Peers-Touch 提供启动器功能，包括个性化信息流和全局搜索能力。它作为用户进入应用的入口，提供快速访问和内容发现功能。

## 功能特性

### 1. 个性化信息流
- 推荐内容展示
- 插件内容聚合
- 最近活动跟踪
- 按类型分组展示

### 2. 全局搜索
- 好友搜索
- 帖子搜索
- 小程序搜索
- 实时搜索建议

### 3. 快捷操作
- 常用功能快速访问
- 可配置的操作面板
- 键盘快捷键支持

## 架构设计

```
launcher/
├── README.md              # 本文档
├── INTEGRATION.md         # 集成指南
├── plugin.go              # 插件注册
├── options.go             # 配置选项
├── launcher.go            # SubServer 实现
├── handler.go             # HTTP 处理器
├── model/                 # 数据模型
│   ├── feed.go           # 信息流模型
│   └── search.go         # 搜索模型
└── service/               # 业务逻辑
    ├── feed_service.go   # 信息流服务
    └── search_service.go # 搜索服务
```

## API 端点

### 1. 获取个性化信息流
```
GET /api/launcher/feed?user_id={user_id}&limit={limit}
```

**参数：**
- `user_id` (可选): 用户 ID，默认为 "default_user"
- `limit` (可选): 返回数量限制，默认为 20

**响应：**
```json
{
  "items": [
    {
      "id": "feed_1",
      "type": "recommendation",
      "title": "Welcome to Peers-Touch",
      "subtitle": "Get started with your decentralized social network",
      "timestamp": "2024-01-04T10:00:00Z",
      "source": "station_feed",
      "icon_url": "",
      "action_url": ""
    }
  ]
}
```

### 2. 搜索内容
```
GET /api/launcher/search?q={query}&limit={limit}
```

**参数：**
- `q` (必需): 搜索关键词
- `limit` (可选): 返回数量限制，默认为 10

**响应：**
```json
{
  "results": [
    {
      "id": "user_1",
      "type": "friend",
      "title": "Alice",
      "subtitle": "@alice@peers.com",
      "icon_url": "",
      "action_url": ""
    }
  ],
  "total": 1
}
```

## 配置说明

### 配置文件 (config.yaml)
```yaml
peers:
  node:
    server:
      subserver:
        launcher:
          enabled: true           # 是否启用 launcher subserver
          rds-name: "station.db"  # 数据库名称（可选）
```

### 配置选项

- `enabled`: 是否启用此 subserver（默认：false）
- `rds-name`: 数据库名称，用于存储用户偏好和历史记录（可选）

## 使用方式

### 1. 启用 SubServer

在配置文件中启用：
```yaml
peers:
  node:
    server:
      subserver:
        launcher:
          enabled: true
```

### 2. 导入模块

在主程序中导入：
```go
import _ "github.com/peers-labs/peers-touch/station/app/subserver/launcher"
```

框架会自动注册并启动 launcher subserver。

### 3. 客户端集成

Flutter 客户端通过 HTTP 调用 API：
```dart
// 获取信息流
final response = await http.get(
  Uri.parse('http://localhost:8080/api/launcher/feed?user_id=user123&limit=20'),
);

// 搜索内容
final searchResponse = await http.get(
  Uri.parse('http://localhost:8080/api/launcher/search?q=alice&limit=10'),
);
```

## 数据模型

### FeedItem（信息流项）
```go
type FeedItem struct {
    ID        string       `json:"id"`
    Type      FeedItemType `json:"type"`
    Title     string       `json:"title"`
    Subtitle  string       `json:"subtitle"`
    Timestamp time.Time    `json:"timestamp"`
    Source    ContentSource `json:"source"`
    IconURL   string       `json:"icon_url,omitempty"`
    ActionURL string       `json:"action_url,omitempty"`
}
```

### SearchResult（搜索结果）
```go
type SearchResult struct {
    ID        string           `json:"id"`
    Type      SearchResultType `json:"type"`
    Title     string           `json:"title"`
    Subtitle  string           `json:"subtitle"`
    IconURL   string           `json:"icon_url,omitempty"`
    ActionURL string           `json:"action_url,omitempty"`
}
```

## 扩展开发

### 添加新的信息流类型

1. 在 `model/feed.go` 中定义新类型：
```go
const FeedItemTypeCustom FeedItemType = "custom"
```

2. 在 `service/feed_service.go` 中实现逻辑：
```go
func GetCustomFeed(ctx context.Context, userID string) ([]model.FeedItem, error) {
    // 实现自定义信息流逻辑
}
```

### 添加新的搜索类型

1. 在 `model/search.go` 中定义新类型：
```go
const SearchResultTypeCustom SearchResultType = "custom"
```

2. 在 `service/search_service.go` 中实现搜索逻辑：
```go
func SearchCustomContent(ctx context.Context, query string) ([]model.SearchResult, error) {
    // 实现自定义搜索逻辑
}
```

## 性能优化

### 缓存策略
- 信息流可以使用 Redis 缓存，减少数据库查询
- 搜索结果可以使用短期缓存（1-5分钟）

### 分页支持
- 使用 `limit` 和 `offset` 参数实现分页
- 建议单页不超过 50 条记录

### 异步处理
- 信息流生成可以异步预计算
- 搜索索引可以使用专门的搜索引擎（如 Elasticsearch）

## 监控与日志

### 关键日志
- 信息流请求：记录用户 ID、请求时间、返回数量
- 搜索请求：记录查询关键词、结果数量、响应时间
- 错误日志：记录详细的错误信息和堆栈

### 性能指标
- API 响应时间
- 信息流生成耗时
- 搜索查询耗时
- 缓存命中率

## 安全考虑

### 访问控制
- 信息流应该根据用户权限过滤内容
- 搜索结果应该遵循隐私设置

### 输入验证
- 搜索关键词长度限制
- 特殊字符过滤
- SQL 注入防护

### 速率限制
- 建议对 API 进行速率限制
- 防止恶意搜索和爬虫

## 故障排查

### 常见问题

1. **SubServer 未启动**
   - 检查配置文件中 `enabled: true`
   - 检查日志中是否有错误信息
   - 确认模块已正确导入

2. **API 返回 404**
   - 确认路由路径正确
   - 检查 SubServer 是否成功注册
   - 查看主服务器日志

3. **搜索无结果**
   - 检查搜索逻辑是否正确
   - 确认数据源是否有数据
   - 查看服务日志

## 未来规划

- [ ] 集成机器学习推荐算法
- [ ] 支持多语言搜索
- [ ] 添加语音搜索支持
- [ ] 实现搜索历史记录
- [ ] 添加搜索热词统计
- [ ] 支持高级搜索过滤器

## 参考文档

- [SubServer 开发规范](../../frame/core/server/SUBSERVER_README.zh.md)
- [集成指南](./INTEGRATION.md)
- [API 文档](./API.md)（待补充）

## 贡献指南

欢迎提交 Issue 和 Pull Request！

在提交代码前，请确保：
1. 代码通过 `go build` 编译
2. 代码通过 `gofmt` 格式化
3. 添加了必要的测试
4. 更新了相关文档
