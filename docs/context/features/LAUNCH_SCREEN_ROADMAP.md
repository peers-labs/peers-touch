# Launch Screen 功能路线图 v2.0

> Historical roadmap. This document preserves a prior Launch Screen planning track with phased delivery and old stack assumptions. It is not a current architecture or platform source of truth.
> Current sources should be located from `docs/README.md`.

> **版本**: 2.0  
> **更新日期**: 2025-01-05  
> **变更**: 移除联邦化集成,聚焦本地数据和实用功能

本文档规划 Launch Screen 从 MVP 到完整功能的开发路线。

---

## 📍 当前状态 (Phase 1 - MVP) ✅

### 已完成
- ✅ 基础 UI 框架（Spotlight 风格）
- ✅ Mock 数据服务
- ✅ 搜索功能（本地过滤）
- ✅ 快捷操作网格
- ✅ 信息流展示
- ✅ SubServer 架构
- ✅ API 端点（feed, search）

### 技术栈
- **客户端**: Flutter + GetX
- **服务端**: Go + SubServer 架构
- **数据**: Mock 数据

---

## 🎯 Phase 2: 本地数据集成

**目标**: 替换 Mock 数据，接入真实本地数据源

**预计时间**: 2-3 周

### 2.1 数据库设计

#### 核心数据表

```go
// station/app/subserver/launcher/db/model/

// 好友关系
type Friend struct {
    ID        uint      `gorm:"primaryKey"`
    UserID    string    `gorm:"index"`
    FriendID  string    `gorm:"index"`
    Nickname  string
    Avatar    string
    Status    string    // active, blocked, pending
    CreatedAt time.Time
    UpdatedAt time.Time
}

// 最近对话
type RecentChat struct {
    ID           uint      `gorm:"primaryKey"`
    UserID       string    `gorm:"index"`
    ChatID       string    `gorm:"index"`
    ChatType     string    // direct, group
    LastMessage  string
    LastMsgTime  time.Time `gorm:"index"`
    UnreadCount  int
    Participants string    // JSON array
}

// 用户活动（本地）
type UserActivity struct {
    ID          uint      `gorm:"primaryKey"`
    UserID      string    `gorm:"index"`
    ActivityType string   `gorm:"index"` // post, like, comment, share
    TargetID    string
    TargetType  string    // post, user, group
    Content     string
    Timestamp   time.Time `gorm:"index"`
}

// 搜索历史
type SearchHistory struct {
    ID        uint      `gorm:"primaryKey"`
    UserID    string    `gorm:"index"`
    Query     string
    ResultType string   // friend, post, applet
    ClickedID string
    Timestamp time.Time `gorm:"index"`
}

// 用户偏好
type UserPreference struct {
    UserID          string    `gorm:"primaryKey"`
    FeedSettings    string    `gorm:"type:json"` // JSON
    SearchSettings  string    `gorm:"type:json"` // JSON
    QuickActions    string    `gorm:"type:json"` // JSON array
    UpdatedAt       time.Time
}

// 应用/小程序索引
type AppIndex struct {
    ID          uint      `gorm:"primaryKey"`
    AppID       string    `gorm:"uniqueIndex"`
    Name        string    `gorm:"index"`
    Description string
    Icon        string
    Category    string    `gorm:"index"`
    Keywords    string    // 空格分隔的关键词
    LaunchURL   string
    InstallCount int
    Rating      float64
}
```

### 2.2 Repository 层实现

#### Friend Repository

```go
// station/app/subserver/launcher/db/repo/friend_repo.go

package repo

import (
    "context"
    "github.com/peers-labs/peers-touch/station/app/subserver/launcher/db/model"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
    "github.com/peers-labs/peers-touch/station/frame/core/store"
)

type FriendRepository struct {
    dbName string
}

func NewFriendRepository(dbName string) *FriendRepository {
    return &FriendRepository{dbName: dbName}
}

func (r *FriendRepository) GetFriends(ctx context.Context, userID string) ([]model.Friend, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        logger.Errorf(ctx, "failed to get RDS: %v", err)
        return nil, err
    }
    
    var friends []model.Friend
    err = rds.Where("user_id = ? AND status = ?", userID, "active").
        Order("updated_at DESC").
        Find(&friends).Error
    
    return friends, err
}

func (r *FriendRepository) SearchFriends(ctx context.Context, userID, query string) ([]model.Friend, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return nil, err
    }
    
    var friends []model.Friend
    err = rds.Where("user_id = ? AND status = ? AND nickname LIKE ?", 
        userID, "active", "%"+query+"%").
        Limit(10).
        Find(&friends).Error
    
    return friends, err
}
```

#### Chat Repository

```go
// station/app/subserver/launcher/db/repo/chat_repo.go

package repo

type ChatRepository struct {
    dbName string
}

func NewChatRepository(dbName string) *ChatRepository {
    return &ChatRepository{dbName: dbName}
}

func (r *ChatRepository) GetRecentChats(ctx context.Context, userID string, limit int) ([]model.RecentChat, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return nil, err
    }
    
    var chats []model.RecentChat
    err = rds.Where("user_id = ?", userID).
        Order("last_msg_time DESC").
        Limit(limit).
        Find(&chats).Error
    
    return chats, err
}

func (r *ChatRepository) SearchChats(ctx context.Context, userID, query string) ([]model.RecentChat, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return nil, err
    }
    
    var chats []model.RecentChat
    err = rds.Where("user_id = ? AND last_message LIKE ?", 
        userID, "%"+query+"%").
        Order("last_msg_time DESC").
        Limit(10).
        Find(&chats).Error
    
    return chats, err
}
```

#### App Repository

```go
// station/app/subserver/launcher/db/repo/app_repo.go

package repo

type AppRepository struct {
    dbName string
}

func NewAppRepository(dbName string) *AppRepository {
    return &AppRepository{dbName: dbName}
}

func (r *AppRepository) SearchApps(ctx context.Context, query string, limit int) ([]model.AppIndex, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return nil, err
    }
    
    var apps []model.AppIndex
    err = rds.Where("name LIKE ? OR keywords LIKE ?", 
        "%"+query+"%", "%"+query+"%").
        Order("install_count DESC, rating DESC").
        Limit(limit).
        Find(&apps).Error
    
    return apps, err
}

func (r *AppRepository) GetPopularApps(ctx context.Context, category string, limit int) ([]model.AppIndex, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return nil, err
    }
    
    query := rds
    if category != "" {
        query = query.Where("category = ?", category)
    }
    
    var apps []model.AppIndex
    err = query.Order("install_count DESC, rating DESC").
        Limit(limit).
        Find(&apps).Error
    
    return apps, err
}
```

### 2.3 Service 层更新

#### Feed Service (真实数据)

```go
// station/app/subserver/launcher/service/feed_service.go

package service

import (
    "context"
    "github.com/peers-labs/peers-touch/station/app/subserver/launcher/db/repo"
    "github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type FeedService struct {
    friendRepo   *repo.FriendRepository
    chatRepo     *repo.ChatRepository
    activityRepo *repo.ActivityRepository
    appRepo      *repo.AppRepository
}

func NewFeedService(dbName string) *FeedService {
    return &FeedService{
        friendRepo:   repo.NewFriendRepository(dbName),
        chatRepo:     repo.NewChatRepository(dbName),
        activityRepo: repo.NewActivityRepository(dbName),
        appRepo:      repo.NewAppRepository(dbName),
    }
}

func (s *FeedService) GetPersonalizedFeed(ctx context.Context, userID string, limit int) (*model.FeedResponse, error) {
    logger.Infof(ctx, "fetching personalized feed for user: %s, limit: %d", userID, limit)
    
    var items []model.FeedItem
    
    // 1. 最近对话 (3条)
    recentChats, err := s.chatRepo.GetRecentChats(ctx, userID, 3)
    if err != nil {
        logger.Warnf(ctx, "failed to get recent chats: %v", err)
    } else {
        for _, chat := range recentChats {
            items = append(items, s.convertChatToFeedItem(chat))
        }
    }
    
    // 2. 好友动态 (5条)
    activities, err := s.activityRepo.GetFriendActivities(ctx, userID, 5)
    if err != nil {
        logger.Warnf(ctx, "failed to get activities: %v", err)
    } else {
        for _, activity := range activities {
            items = append(items, s.convertActivityToFeedItem(activity))
        }
    }
    
    // 3. 推荐应用 (2条)
    popularApps, err := s.appRepo.GetPopularApps(ctx, "", 2)
    if err != nil {
        logger.Warnf(ctx, "failed to get popular apps: %v", err)
    } else {
        for _, app := range popularApps {
            items = append(items, s.convertAppToFeedItem(app))
        }
    }
    
    // 4. 排序和限制
    s.sortFeedItems(items)
    if limit > 0 && len(items) > limit {
        items = items[:limit]
    }
    
    return &model.FeedResponse{Items: items}, nil
}

func (s *FeedService) convertChatToFeedItem(chat model.RecentChat) model.FeedItem {
    return model.FeedItem{
        ID:          chat.ChatID,
        Type:        "chat",
        Title:       "最近对话",
        Description: chat.LastMessage,
        Icon:        "💬",
        Timestamp:   chat.LastMsgTime.Format("15:04"),
        ActionURL:   "/chat/" + chat.ChatID,
    }
}

func (s *FeedService) convertActivityToFeedItem(activity model.UserActivity) model.FeedItem {
    return model.FeedItem{
        ID:          activity.TargetID,
        Type:        activity.ActivityType,
        Title:       s.getActivityTitle(activity.ActivityType),
        Description: activity.Content,
        Icon:        s.getActivityIcon(activity.ActivityType),
        Timestamp:   activity.Timestamp.Format("15:04"),
        ActionURL:   "/" + activity.TargetType + "/" + activity.TargetID,
    }
}

func (s *FeedService) convertAppToFeedItem(app model.AppIndex) model.FeedItem {
    return model.FeedItem{
        ID:          app.AppID,
        Type:        "app",
        Title:       app.Name,
        Description: app.Description,
        Icon:        app.Icon,
        Timestamp:   "",
        ActionURL:   app.LaunchURL,
    }
}
```

#### Search Service (真实数据)

```go
// station/app/subserver/launcher/service/search_service.go

package service

type SearchService struct {
    friendRepo  *repo.FriendRepository
    chatRepo    *repo.ChatRepository
    appRepo     *repo.AppRepository
    historyRepo *repo.SearchHistoryRepository
}

func NewSearchService(dbName string) *SearchService {
    return &SearchService{
        friendRepo:  repo.NewFriendRepository(dbName),
        chatRepo:    repo.NewChatRepository(dbName),
        appRepo:     repo.NewAppRepository(dbName),
        historyRepo: repo.NewSearchHistoryRepository(dbName),
    }
}

func (s *SearchService) Search(ctx context.Context, userID, query string) (*model.SearchResponse, error) {
    logger.Infof(ctx, "searching for user: %s, query: %s", userID, query)
    
    var results []model.SearchResult
    
    // 1. 搜索好友
    friends, err := s.friendRepo.SearchFriends(ctx, userID, query)
    if err != nil {
        logger.Warnf(ctx, "failed to search friends: %v", err)
    } else {
        for _, friend := range friends {
            results = append(results, model.SearchResult{
                ID:          friend.FriendID,
                Type:        "friend",
                Title:       friend.Nickname,
                Description: "好友",
                Icon:        friend.Avatar,
                ActionURL:   "/profile/" + friend.FriendID,
            })
        }
    }
    
    // 2. 搜索对话
    chats, err := s.chatRepo.SearchChats(ctx, userID, query)
    if err != nil {
        logger.Warnf(ctx, "failed to search chats: %v", err)
    } else {
        for _, chat := range chats {
            results = append(results, model.SearchResult{
                ID:          chat.ChatID,
                Type:        "chat",
                Title:       "对话",
                Description: chat.LastMessage,
                Icon:        "💬",
                ActionURL:   "/chat/" + chat.ChatID,
            })
        }
    }
    
    // 3. 搜索应用
    apps, err := s.appRepo.SearchApps(ctx, query, 5)
    if err != nil {
        logger.Warnf(ctx, "failed to search apps: %v", err)
    } else {
        for _, app := range apps {
            results = append(results, model.SearchResult{
                ID:          app.AppID,
                Type:        "app",
                Title:       app.Name,
                Description: app.Description,
                Icon:        app.Icon,
                ActionURL:   app.LaunchURL,
            })
        }
    }
    
    // 4. 记录搜索历史
    if len(results) > 0 {
        _ = s.historyRepo.AddSearchHistory(ctx, userID, query, results[0].Type, results[0].ID)
    }
    
    return &model.SearchResponse{Results: results}, nil
}

func (s *SearchService) GetSearchSuggestions(ctx context.Context, userID string) ([]string, error) {
    history, err := s.historyRepo.GetRecentSearches(ctx, userID, 5)
    if err != nil {
        return nil, err
    }
    
    suggestions := make([]string, 0, len(history))
    for _, h := range history {
        suggestions = append(suggestions, h.Query)
    }
    
    return suggestions, nil
}
```

### 2.4 数据库迁移

```go
// station/app/subserver/launcher/db/migration.go

package db

import (
    "context"
    "github.com/peers-labs/peers-touch/station/app/subserver/launcher/db/model"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
    "github.com/peers-labs/peers-touch/station/frame/core/store"
)

func RunMigrations(ctx context.Context, dbName string) error {
    logger.Info(ctx, "running launcher database migrations")
    
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(dbName))
    if err != nil {
        return err
    }
    
    // 自动迁移所有表
    err = rds.AutoMigrate(
        &model.Friend{},
        &model.RecentChat{},
        &model.UserActivity{},
        &model.SearchHistory{},
        &model.UserPreference{},
        &model.AppIndex{},
    )
    
    if err != nil {
        logger.Errorf(ctx, "failed to run migrations: %v", err)
        return err
    }
    
    logger.Info(ctx, "launcher database migrations completed")
    return nil
}
```

### 2.5 测试任务

- [ ] 单元测试（Repository 层）
- [ ] 集成测试（Service 层）
- [ ] API 端点测试
- [ ] 性能测试（查询优化）

---

## 🚀 Phase 3: 高级功能

**目标**: 提升用户体验和性能

**预计时间**: 2-3 周

### 3.1 搜索结果缓存

#### 任务列表
- [ ] 集成 Redis 缓存
- [ ] 实现缓存策略（TTL, LRU）
- [ ] 添加缓存预热
- [ ] 监控缓存命中率

#### 缓存实现

```go
// station/app/subserver/launcher/service/cache_service.go

package service

import (
    "context"
    "encoding/json"
    "fmt"
    "time"
    "github.com/go-redis/redis/v8"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type CacheService struct {
    redis *redis.Client
}

func NewCacheService() *CacheService {
    return &CacheService{
        redis: redis.NewClient(&redis.Options{
            Addr: "localhost:6379",
        }),
    }
}

func (s *CacheService) GetSearchResults(ctx context.Context, query string) (*model.SearchResponse, error) {
    key := fmt.Sprintf("launcher:search:%s", query)
    
    data, err := s.redis.Get(ctx, key).Result()
    if err == redis.Nil {
        return nil, nil
    }
    if err != nil {
        logger.Warnf(ctx, "redis get error: %v", err)
        return nil, err
    }
    
    var results model.SearchResponse
    err = json.Unmarshal([]byte(data), &results)
    return &results, err
}

func (s *CacheService) SetSearchResults(ctx context.Context, query string, results *model.SearchResponse) error {
    key := fmt.Sprintf("launcher:search:%s", query)
    
    data, err := json.Marshal(results)
    if err != nil {
        return err
    }
    
    return s.redis.Set(ctx, key, data, 5*time.Minute).Err()
}

func (s *CacheService) GetFeed(ctx context.Context, userID string) (*model.FeedResponse, error) {
    key := fmt.Sprintf("launcher:feed:%s", userID)
    
    data, err := s.redis.Get(ctx, key).Result()
    if err == redis.Nil {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }
    
    var feed model.FeedResponse
    err = json.Unmarshal([]byte(data), &feed)
    return &feed, err
}

func (s *CacheService) SetFeed(ctx context.Context, userID string, feed *model.FeedResponse) error {
    key := fmt.Sprintf("launcher:feed:%s", userID)
    
    data, err := json.Marshal(feed)
    if err != nil {
        return err
    }
    
    return s.redis.Set(ctx, key, data, 10*time.Minute).Err()
}

func (s *CacheService) InvalidateFeed(ctx context.Context, userID string) error {
    key := fmt.Sprintf("launcher:feed:%s", userID)
    return s.redis.Del(ctx, key).Err()
}
```

#### Service 层集成缓存

```go
// 更新 search_service.go

func (s *SearchService) Search(ctx context.Context, userID, query string) (*model.SearchResponse, error) {
    // 1. 尝试从缓存获取
    if s.cacheService != nil {
        cached, err := s.cacheService.GetSearchResults(ctx, query)
        if err == nil && cached != nil {
            logger.Infof(ctx, "cache hit for query: %s", query)
            return cached, nil
        }
    }
    
    // 2. 缓存未命中,执行搜索
    results, err := s.performSearch(ctx, userID, query)
    if err != nil {
        return nil, err
    }
    
    // 3. 写入缓存
    if s.cacheService != nil {
        _ = s.cacheService.SetSearchResults(ctx, query, results)
    }
    
    return results, nil
}
```

### 3.2 搜索历史与建议

#### 任务列表
- [ ] 记录搜索历史
- [ ] 显示历史建议
- [ ] 历史管理（删除、清空）
- [ ] 隐私保护选项

#### Repository 实现

```go
// station/app/subserver/launcher/db/repo/search_history_repo.go

package repo

type SearchHistoryRepository struct {
    dbName string
}

func NewSearchHistoryRepository(dbName string) *SearchHistoryRepository {
    return &SearchHistoryRepository{dbName: dbName}
}

func (r *SearchHistoryRepository) AddSearchHistory(ctx context.Context, userID, query, resultType, clickedID string) error {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return err
    }
    
    history := model.SearchHistory{
        UserID:     userID,
        Query:      query,
        ResultType: resultType,
        ClickedID:  clickedID,
        Timestamp:  time.Now(),
    }
    
    return rds.Create(&history).Error
}

func (r *SearchHistoryRepository) GetRecentSearches(ctx context.Context, userID string, limit int) ([]model.SearchHistory, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return nil, err
    }
    
    var history []model.SearchHistory
    err = rds.Where("user_id = ?", userID).
        Order("timestamp DESC").
        Limit(limit).
        Find(&history).Error
    
    return history, err
}

func (r *SearchHistoryRepository) ClearHistory(ctx context.Context, userID string) error {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
    if err != nil {
        return err
    }
    
    return rds.Where("user_id = ?", userID).Delete(&model.SearchHistory{}).Error
}
```

#### 客户端集成

```dart
// client/desktop/lib/features/launch/controller/launch_controller.dart

class LaunchController extends GetxController {
  final searchHistory = <String>[].obs;
  
  @override
  void onInit() {
    super.onInit();
    _loadSearchHistory();
  }
  
  Future<void> _loadSearchHistory() async {
    try {
      final response = await _httpService.get('/launcher/search/history');
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        searchHistory.value = List<String>.from(data['queries'] ?? []);
      }
    } catch (e) {
      LoggingService.error('Failed to load search history: $e');
    }
  }
  
  Future<void> clearSearchHistory() async {
    try {
      await _httpService.delete('/launcher/search/history');
      searchHistory.clear();
    } catch (e) {
      LoggingService.error('Failed to clear search history: $e');
    }
  }
}
```

### 3.3 用户偏好设置

#### 任务列表
- [ ] 设计偏好设置 UI
- [ ] 实现偏好存储
- [ ] 应用偏好到推荐
- [ ] 偏好导入/导出

#### 偏好模型

```go
// station/app/subserver/launcher/model/preference.go

package model

type FeedPreference struct {
    ShowRecentChats   bool     `json:"show_recent_chats"`
    ShowFriendUpdates bool     `json:"show_friend_updates"`
    ShowPopularApps   bool     `json:"show_popular_apps"`
    FeedLimit         int      `json:"feed_limit"`
    Categories        []string `json:"categories"`
}

type SearchPreference struct {
    SaveHistory       bool `json:"save_history"`
    ShowSuggestions   bool `json:"show_suggestions"`
    MaxResults        int  `json:"max_results"`
}

type QuickAction struct {
    ID    string `json:"id"`
    Title string `json:"title"`
    Icon  string `json:"icon"`
    URL   string `json:"url"`
    Order int    `json:"order"`
}
```

#### 客户端设置界面

```dart
// client/desktop/lib/features/launch/widgets/settings_dialog.dart

class LaunchSettingsDialog extends StatelessWidget {
  final LaunchController controller = Get.find();
  
  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: Container(
        width: 600,
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Launch Screen 设置',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 24),
            
            _buildFeedSettings(),
            SizedBox(height: 16),
            _buildSearchSettings(),
            SizedBox(height: 16),
            _buildQuickActions(),
            
            SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Get.back(),
                  child: Text('取消'),
                ),
                SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () => controller.saveSettings(),
                  child: Text('保存'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildFeedSettings() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('信息流设置', style: TextStyle(fontWeight: FontWeight.bold)),
        SizedBox(height: 8),
        Obx(() => SwitchListTile(
          title: Text('显示最近对话'),
          value: controller.showRecentChats.value,
          onChanged: (v) => controller.showRecentChats.value = v,
        )),
        Obx(() => SwitchListTile(
          title: Text('显示好友动态'),
          value: controller.showFriendUpdates.value,
          onChanged: (v) => controller.showFriendUpdates.value = v,
        )),
        Obx(() => SwitchListTile(
          title: Text('显示推荐应用'),
          value: controller.showPopularApps.value,
          onChanged: (v) => controller.showPopularApps.value = v,
        )),
      ],
    );
  }
  
  Widget _buildSearchSettings() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('搜索设置', style: TextStyle(fontWeight: FontWeight.bold)),
        SizedBox(height: 8),
        Obx(() => SwitchListTile(
          title: Text('保存搜索历史'),
          value: controller.saveSearchHistory.value,
          onChanged: (v) => controller.saveSearchHistory.value = v,
        )),
        Obx(() => SwitchListTile(
          title: Text('显示搜索建议'),
          value: controller.showSearchSuggestions.value,
          onChanged: (v) => controller.showSearchSuggestions.value = v,
        )),
      ],
    );
  }
  
  Widget _buildQuickActions() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('快捷操作', style: TextStyle(fontWeight: FontWeight.bold)),
        SizedBox(height: 8),
        Text('拖拽调整顺序', style: TextStyle(color: Colors.grey)),
        SizedBox(height: 8),
        Obx(() => ReorderableListView(
          shrinkWrap: true,
          onReorder: controller.reorderQuickActions,
          children: controller.quickActions.map((action) {
            return ListTile(
              key: ValueKey(action.id),
              leading: Text(action.icon),
              title: Text(action.title),
              trailing: IconButton(
                icon: Icon(Icons.delete),
                onPressed: () => controller.removeQuickAction(action.id),
              ),
            );
          }).toList(),
        )),
      ],
    );
  }
}
```

### 3.4 性能优化

#### 任务列表
- [ ] 数据库索引优化
- [ ] 查询性能分析
- [ ] 批量查询优化
- [ ] 分页加载

---

## 🔌 Phase 4: 插件系统

**目标**: 可扩展的内容聚合平台

**预计时间**: 3-4 周

### 4.1 插件架构设计

#### 插件接口

```go
// station/app/subserver/launcher/plugin/interface.go

package plugin

import (
    "context"
    "time"
)

type ContentProvider interface {
    Name() string
    Version() string
    Init(ctx context.Context, config map[string]interface{}) error
    GetContent(ctx context.Context, params ContentParams) ([]Content, error)
    Search(ctx context.Context, query string) ([]Content, error)
    Refresh(ctx context.Context) error
}

type ContentParams struct {
    UserID string
    Limit  int
    Offset int
    Tags   []string
}

type Content struct {
    ID          string
    Type        string
    Title       string
    Description string
    URL         string
    ImageURL    string
    Author      string
    PublishedAt time.Time
    Tags        []string
    Metadata    map[string]interface{}
}
```

### 4.2 RSS 聚合插件

#### 实现示例

```go
// station/app/subserver/launcher/plugin/rss/rss_plugin.go

package rss

import (
    "context"
    "sort"
    "strings"
    "time"
    "github.com/mmcdole/gofeed"
    "github.com/peers-labs/peers-touch/station/app/subserver/launcher/plugin"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type RSSPlugin struct {
    parser *gofeed.Parser
    feeds  map[string]*FeedConfig
}

type FeedConfig struct {
    URL         string
    Category    string
    RefreshRate time.Duration
}

func NewRSSPlugin() *RSSPlugin {
    return &RSSPlugin{
        parser: gofeed.NewParser(),
        feeds:  make(map[string]*FeedConfig),
    }
}

func (p *RSSPlugin) Name() string {
    return "rss-aggregator"
}

func (p *RSSPlugin) Version() string {
    return "1.0.0"
}

func (p *RSSPlugin) Init(ctx context.Context, config map[string]interface{}) error {
    logger.Info(ctx, "initializing RSS plugin")
    
    feedsConfig, ok := config["feeds"].([]interface{})
    if !ok {
        return fmt.Errorf("invalid feeds config")
    }
    
    for _, f := range feedsConfig {
        feedMap := f.(map[string]interface{})
        p.feeds[feedMap["url"].(string)] = &FeedConfig{
            URL:         feedMap["url"].(string),
            Category:    feedMap["category"].(string),
            RefreshRate: time.Duration(feedMap["refresh_rate"].(float64)) * time.Minute,
        }
    }
    
    return nil
}

func (p *RSSPlugin) GetContent(ctx context.Context, params plugin.ContentParams) ([]plugin.Content, error) {
    var allContent []plugin.Content
    
    for _, feedConfig := range p.feeds {
        feed, err := p.parser.ParseURL(feedConfig.URL)
        if err != nil {
            logger.Warnf(ctx, "failed to parse RSS feed %s: %v", feedConfig.URL, err)
            continue
        }
        
        for _, item := range feed.Items {
            content := plugin.Content{
                ID:          item.GUID,
                Type:        "rss",
                Title:       item.Title,
                Description: item.Description,
                URL:         item.Link,
                Author:      item.Author.Name,
                PublishedAt: *item.PublishedParsed,
                Tags:        []string{feedConfig.Category},
                Metadata: map[string]interface{}{
                    "feed_title": feed.Title,
                    "feed_url":   feedConfig.URL,
                },
            }
            
            if len(item.Enclosures) > 0 {
                content.ImageURL = item.Enclosures[0].URL
            }
            
            allContent = append(allContent, content)
        }
    }
    
    sort.Slice(allContent, func(i, j int) bool {
        return allContent[i].PublishedAt.After(allContent[j].PublishedAt)
    })
    
    if params.Limit > 0 && len(allContent) > params.Limit {
        allContent = allContent[:params.Limit]
    }
    
    return allContent, nil
}

func (p *RSSPlugin) Search(ctx context.Context, query string) ([]plugin.Content, error) {
    content, err := p.GetContent(ctx, plugin.ContentParams{Limit: 100})
    if err != nil {
        return nil, err
    }
    
    var results []plugin.Content
    queryLower := strings.ToLower(query)
    
    for _, item := range content {
        if strings.Contains(strings.ToLower(item.Title), queryLower) ||
           strings.Contains(strings.ToLower(item.Description), queryLower) {
            results = append(results, item)
        }
    }
    
    return results, nil
}

func (p *RSSPlugin) Refresh(ctx context.Context) error {
    logger.Info(ctx, "refreshing RSS feeds")
    return nil
}
```

### 4.3 插件管理器

```go
// station/app/subserver/launcher/plugin/manager.go

package plugin

import (
    "context"
    "fmt"
    "sync"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type PluginManager struct {
    plugins map[string]ContentProvider
    mu      sync.RWMutex
}

func NewPluginManager() *PluginManager {
    return &PluginManager{
        plugins: make(map[string]ContentProvider),
    }
}

func (m *PluginManager) Register(plugin ContentProvider) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    name := plugin.Name()
    if _, exists := m.plugins[name]; exists {
        return fmt.Errorf("plugin %s already registered", name)
    }
    
    m.plugins[name] = plugin
    return nil
}

func (m *PluginManager) GetPlugin(name string) (ContentProvider, error) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    
    plugin, exists := m.plugins[name]
    if !exists {
        return nil, fmt.Errorf("plugin %s not found", name)
    }
    
    return plugin, nil
}

func (m *PluginManager) GetAllContent(ctx context.Context, params ContentParams) ([]Content, error) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    
    var allContent []Content
    
    for name, plugin := range m.plugins {
        content, err := plugin.GetContent(ctx, params)
        if err != nil {
            logger.Warnf(ctx, "plugin %s failed to get content: %v", name, err)
            continue
        }
        allContent = append(allContent, content...)
    }
    
    return allContent, nil
}

func (m *PluginManager) SearchAll(ctx context.Context, query string) ([]Content, error) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    
    var allResults []Content
    
    for name, plugin := range m.plugins {
        results, err := plugin.Search(ctx, query)
        if err != nil {
            logger.Warnf(ctx, "plugin %s search failed: %v", name, err)
            continue
        }
        allResults = append(allResults, results...)
    }
    
    return allResults, nil
}
```

### 4.4 其他插件

#### 任务列表
- [ ] 新闻聚合插件（NewsAPI）
- [ ] 天气插件
- [ ] 日历插件
- [ ] 笔记插件
- [ ] 自定义插件 SDK

---

## 📊 开发优先级

### P0 (必须完成)
1. ✅ Phase 1: MVP 实现
2. Phase 2.1-2.3: 数据库集成
3. Phase 3.1: 搜索缓存

### P1 (重要)
1. Phase 3.2: 搜索历史
2. Phase 3.3: 用户偏好
3. Phase 3.4: 性能优化

### P2 (增强)
1. Phase 4.1: 插件架构
2. Phase 4.2: RSS 插件
3. Phase 4.3: 插件管理器

### P3 (可选)
1. Phase 4.4: 其他插件

---

## 🎯 里程碑

### Milestone 1: 真实数据 (Week 1-3) 🎯
- [ ] 数据库表设计
- [ ] Repository 实现
- [ ] Service 层更新
- [ ] API 测试通过
- [ ] 数据迁移完成

### Milestone 2: 性能优化 (Week 4-6)
- [ ] Redis 缓存集成
- [ ] 查询性能优化
- [ ] 搜索历史功能
- [ ] 用户偏好设置

### Milestone 3: 插件系统 (Week 7-10)
- [ ] 插件架构
- [ ] RSS 插件
- [ ] 插件管理器
- [ ] 插件文档

---

## 📝 技术债务

### 需要重构
- [ ] 搜索算法优化（全文搜索引擎）
- [ ] 缓存策略优化
- [ ] 数据库查询优化

### 需要测试
- [ ] 大数据量性能测试
- [ ] 并发测试
- [ ] 缓存命中率测试

### 需要文档
- [ ] 插件开发指南
- [ ] API 文档更新
- [ ] 性能调优指南

---

## 🚀 快速开始 Phase 2

### 1. 创建数据库结构

```bash
cd station/app/subserver/launcher
mkdir -p db/model db/repo
```

### 2. 实现 Repository 层

参考上面的代码示例,创建:
- `db/model/*.go` - 数据模型
- `db/repo/*_repo.go` - 数据访问层

### 3. 更新 Service 层

替换 Mock 数据为数据库查询

### 4. 运行迁移

```go
// 在 launcher.go 的 Init 方法中
err := db.RunMigrations(ctx, s.dbName)
if err != nil {
    return err
}
```

### 5. 测试

```bash
go test ./...
```

---

## 📚 参考资源

- [GORM 文档](https://gorm.io/docs/)
- [Redis Go 客户端](https://github.com/go-redis/redis)
- [RSS 解析库](https://github.com/mmcdole/gofeed)
- [Go 插件系统](https://pkg.go.dev/plugin)

---

**准备好开始 Phase 2 了吗?** 🚀

从数据库集成开始,逐步将 Launch Screen 打造成强大的本地内容聚合平台!
