# 好友关系展示设计

## 🎯 设计目标

丝滑地展示用户之间的好友关系，让用户一眼就能看出：
- 谁是我的好友（互相关注）
- 谁关注了我
- 我关注了谁
- 哪些人可以回关

## 📊 筛选分类

### 四个筛选标签

| 标签 | 图标 | 说明 | 筛选逻辑 |
|------|------|------|----------|
| **All** | 👥 | 所有用户 | 显示全部 |
| **Following** | ➕ | 我关注的人 | `isFollowing = true` |
| **Followers** | 👤 | 关注我的人 | `followedBy = true` |
| **Friends** | ❤️ | 互相关注 | `isFollowing && followedBy` |

## 🎨 UI 状态展示

### 关系状态标识

每个用户卡片根据关系状态显示不同的标识和按钮：

#### 1. **互相关注（好友）**
```
┌─────────────────────────────────────┐
│ 👤 Mobile One        [❤️ Friends]   │
│    @mobile-1                        │
│                     [Following] ⬜   │
└─────────────────────────────────────┘
```
- **标识**：粉色 `❤️ Friends` 徽章
- **按钮**：`Following`（OutlinedButton）
- **操作**：点击取消关注

#### 2. **对方关注了我（未回关）**
```
┌─────────────────────────────────────┐
│ 👤 Go Peer      [Follows you] 🔵    │
│    @go-peer-1                       │
│                  [Follow Back] 🟦   │
└─────────────────────────────────────┘
```
- **标识**：蓝色 `Follows you` 标签
- **按钮**：`Follow Back`（FilledButton）
- **操作**：点击回关

#### 3. **我关注了对方（对方未回关）**
```
┌─────────────────────────────────────┐
│ 👤 User Three                       │
│    @user-3                          │
│                     [Following] ⬜   │
└─────────────────────────────────────┘
```
- **标识**：无
- **按钮**：`Following`（OutlinedButton）
- **操作**：点击取消关注

#### 4. **未关注**
```
┌─────────────────────────────────────┐
│ 👤 New User                         │
│    @new-user                        │
│                       [Follow] 🟦   │
└─────────────────────────────────────┘
```
- **标识**：无
- **按钮**：`Follow`（FilledButton.tonal）
- **操作**：点击关注

## 🔧 技术实现

### 后端 API

#### Protobuf 定义
```protobuf
message Actor {
  string id = 1;
  string username = 2;
  string display_name = 3;
  bool is_following = 8 [json_name = "is_following"];
  bool followed_by = 10 [json_name = "followed_by"];
  uint64 actor_id = 9 [json_name = "actor_id"];
}
```

#### API 响应示例
```json
{
  "items": [
    {
      "id": "319499243788189697",
      "username": "mobile-1",
      "display_name": "Mobile One",
      "is_following": true,
      "followed_by": true,
      "actor_id": 319499243788189697
    }
  ]
}
```

### 前端实现

#### 数据模型
```dart
class FriendItem {
  final bool isFollowing;   // 我是否关注了对方
  final bool followedBy;    // 对方是否关注了我
  
  bool get isFriend => isFollowing && followedBy;  // 是否为好友
}

enum RelationshipFilter {
  all,        // 所有用户
  following,  // 我关注的
  followers,  // 关注我的
  friends,    // 互相关注
}
```

#### 筛选逻辑
```dart
List<FriendItem> get filteredActors {
  final actors = searchQuery.isEmpty ? localStationActors : searchResults;
  
  switch (relationshipFilter.value) {
    case RelationshipFilter.all:
      return actors;
    case RelationshipFilter.following:
      return actors.where((a) => a.isFollowing).toList();
    case RelationshipFilter.followers:
      return actors.where((a) => a.followedBy).toList();
    case RelationshipFilter.friends:
      return actors.where((a) => a.isFriend).toList();
  }
}
```

## 🎯 用户体验优势

### 1. **清晰的分类**
- 用户可以快速切换查看不同关系的人
- 每个分类都有明确的含义和图标

### 2. **直观的状态**
- 通过按钮样式和标识一眼看出关系
- 粉色徽章突出显示好友关系
- 蓝色标签提示可以回关

### 3. **引导互动**
- "Follow Back" 按钮引导用户回关
- "Friends" 徽章增强归属感
- "Follows you" 标签提升被关注的感知

### 4. **减少困惑**
- 不同关系状态有不同的视觉表现
- 按钮文本明确表达当前状态和可执行操作
- 筛选功能让用户专注于特定关系

## 🎨 视觉设计

### 颜色方案

| 元素 | 颜色 | 用途 |
|------|------|------|
| Friends 徽章 | 粉色 (`pink.shade50/700`) | 突出好友关系 |
| Follows you 标签 | 蓝色 (`blue.shade50/700`) | 提示可回关 |
| Following 按钮 | 灰色边框 | 已关注状态 |
| Follow Back 按钮 | 蓝色填充 | 强调回关操作 |
| Follow 按钮 | 浅蓝填充 | 普通关注操作 |

### 交互反馈

1. **筛选切换**：点击筛选标签立即更新列表
2. **关注操作**：显示 Snackbar 提示成功/失败
3. **列表刷新**：操作完成后自动刷新，更新状态
4. **计数更新**：顶部显示当前筛选结果的数量

## 📱 使用场景

### 场景 1：查找新朋友
1. 用户打开 "Find Friends" 页面
2. 默认显示 "All" 所有用户
3. 看到 "Follows you" 标签，点击 "Follow Back" 回关
4. 成功后显示 "Friends" 徽章

### 场景 2：管理关注列表
1. 点击 "Following" 筛选
2. 查看所有我关注的人
3. 看到某些人有 "Friends" 徽章（互相关注）
4. 对于没有徽章的，可以选择取消关注

### 场景 3：查看粉丝
1. 点击 "Followers" 筛选
2. 查看所有关注我的人
3. 对于未回关的，显示 "Follow Back" 按钮
4. 快速回关感兴趣的人

### 场景 4：查看好友
1. 点击 "Friends" 筛选
2. 只显示互相关注的人
3. 所有人都有粉色 "Friends" 徽章
4. 管理核心社交圈

## 🚀 未来扩展

### 可能的增强功能

1. **关系统计**
   - 显示每个分类的数量
   - 例如：`Following (12)`, `Followers (8)`, `Friends (5)`

2. **批量操作**
   - 批量回关所有粉丝
   - 批量取消关注

3. **关系时间线**
   - 显示关注时间
   - 显示最近互动

4. **推荐算法**
   - 推荐共同好友
   - 推荐相似兴趣的人

5. **隐私设置**
   - 隐藏关注列表
   - 仅好友可见

## 📝 总结

这个设计通过：
- ✅ **清晰的分类筛选**
- ✅ **直观的视觉标识**
- ✅ **智能的按钮状态**
- ✅ **友好的交互引导**

实现了丝滑的好友关系展示，让用户能够轻松理解和管理他们的社交网络。
