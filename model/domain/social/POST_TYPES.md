# 帖子类型设计文档

## 📋 支持的帖子类型

### 1. 纯文本帖子 (TEXT)

**用途：** 快速分享想法、状态更新

**特性：**
- 纯文字内容
- 支持 @ 提及用户
- 支持 # 话题标签
- 最大长度：5000 字符

**示例：**
```
今天天气真好！#周末 @alice
```

**Proto:**
```protobuf
message TextPost {
  string text = 1;
  repeated string hashtags = 2;    // ["周末"]
  repeated string mentions = 3;    // ["alice"]
}
```

---

### 2. 图片帖子 (IMAGE)

**用途：** 分享照片、截图、表情包

**特性：**
- 1-9 张图片
- 支持文字说明
- 自动生成缩略图
- 支持 Blurhash 预加载
- 支持无障碍文字（alt text）

**限制：**
- 单张图片最大 10MB
- 支持格式：JPG, PNG, GIF, WebP
- 最大尺寸：4096x4096

**示例：**
```
今天的晚餐 🍜
[图片1] [图片2] [图片3]
```

**Proto:**
```protobuf
message ImagePost {
  string text = 1;
  repeated ImageAttachment images = 2;  // 最多9张
  repeated string hashtags = 3;
  repeated string mentions = 4;
}
```

---

### 3. 视频帖子 (VIDEO)

**用途：** 分享短视频、Vlog

**特性：**
- 单个视频
- 自动转码（多清晰度）
- 自动生成封面图
- 支持字幕（未来）

**限制：**
- 最大时长：10 分钟
- 最大文件：500MB
- 支持格式：MP4, MOV, AVI, WebM

**示例：**
```
我的猫咪日常 🐱
[视频：30秒]
```

**Proto:**
```protobuf
message VideoPost {
  string text = 1;
  VideoAttachment video = 2;
  repeated string hashtags = 3;
  repeated string mentions = 4;
}

message VideoAttachment {
  string id = 1;
  string url = 2;                      // 原始视频
  string thumbnail_url = 3;            // 封面图
  int32 duration_seconds = 7;
  repeated VideoVariant variants = 10; // 多清晰度
}
```

---

### 4. 链接帖子 (LINK)

**用途：** 分享网页、文章、视频链接

**特性：**
- 自动抓取链接预览
- 显示标题、描述、封面图
- 显示网站 favicon

**示例：**
```
这篇文章写得很好 👍
https://example.com/article

[预览卡片]
标题：如何设计优雅的 API
描述：本文介绍了 RESTful API 的最佳实践...
图片：[封面图]
```

**Proto:**
```protobuf
message LinkPost {
  string text = 1;
  LinkPreview link = 2;
  repeated string hashtags = 3;
  repeated string mentions = 4;
}

message LinkPreview {
  string url = 1;
  string title = 2;
  string description = 3;
  string image_url = 4;
  string site_name = 5;
  string favicon_url = 6;
}
```

---

### 5. 投票帖子 (POLL)

**用途：** 发起投票、收集意见

**特性：**
- 2-4 个选项
- 支持单选/多选
- 设置投票时长（1小时 - 7天）
- 实时显示投票结果
- 投票后可见结果

**示例：**
```
你最喜欢哪个编程语言？

○ Go (45%)
○ Rust (30%)
○ Python (25%)

总票数：120 · 还剩 2 小时
```

**Proto:**
```protobuf
message PollPost {
  string text = 1;
  Poll poll = 2;
  repeated string hashtags = 3;
  repeated string mentions = 4;
}

message Poll {
  string question = 1;
  repeated PollOption options = 2;
  google.protobuf.Timestamp expires_at = 3;
  bool multiple_choice = 4;
  int64 total_votes = 5;
  bool has_voted = 6;
  repeated int32 user_votes = 7;
}
```

---

### 6. 转发帖子 (REPOST)

**用途：** 转发别人的帖子并添加评论

**特性：**
- 嵌套显示原帖
- 可添加转发评论
- 保留原帖作者信息
- 原帖删除后显示"已删除"

**示例：**
```
我也这么觉得！

┌─────────────────────────┐
│ @bob                    │
│ 今天天气真好            │
│ [图片]                  │
│ 10 赞 · 5 评论          │
└─────────────────────────┘
```

**Proto:**
```protobuf
message RepostPost {
  string comment = 1;              // 转发评论
  string original_post_id = 2;     // 原帖 ID
  Post original_post = 3;          // 原帖完整内容
}
```

---

### 7. 位置帖子 (LOCATION)

**用途：** 分享地理位置、签到

**特性：**
- 地理位置信息
- 可附带图片
- 显示地图预览
- 支持地点搜索

**示例：**
```
在星巴克工作中 ☕

📍 星巴克（国贸店）
北京市朝阳区建国门外大街1号

[图片1] [图片2]
```

**Proto:**
```protobuf
message LocationPost {
  string text = 1;
  Location location = 2;
  repeated ImageAttachment images = 3;
  repeated string hashtags = 4;
  repeated string mentions = 5;
}

message Location {
  string name = 1;              // "星巴克（国贸店）"
  double latitude = 2;          // 39.9042
  double longitude = 3;         // 116.4074
  string address = 4;           // "北京市朝阳区..."
  string place_id = 5;          // Google/高德地图 ID
}
```

---

## 🎨 UI 展示差异

### 时间线中的展示

```
┌─────────────────────────────────────┐
│ TEXT                                │
│ @alice · 2分钟前                    │
│ 今天天气真好！#周末                 │
│ ❤️ 10  💬 5  🔄 2                   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ IMAGE                               │
│ @bob · 5分钟前                      │
│ 今天的晚餐 🍜                       │
│ [图片网格 3x3]                      │
│ ❤️ 25  💬 8  🔄 3                   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ VIDEO                               │
│ @charlie · 10分钟前                 │
│ 我的猫咪日常 🐱                     │
│ [视频播放器 ▶️ 0:30]                │
│ ❤️ 50  💬 12  🔄 8                  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ LINK                                │
│ @david · 15分钟前                   │
│ 这篇文章写得很好 👍                 │
│ ┌─────────────────────────────────┐ │
│ │ [预览图]                        │ │
│ │ 如何设计优雅的 API              │ │
│ │ 本文介绍了 RESTful API...       │ │
│ │ 🔗 example.com                  │ │
│ └─────────────────────────────────┘ │
│ ❤️ 30  💬 15  🔄 10                 │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ POLL                                │
│ @eve · 20分钟前                     │
│ 你最喜欢哪个编程语言？              │
│ ○ Go (45%) ████████                │
│ ○ Rust (30%) █████                 │
│ ○ Python (25%) ████                │
│ 120 票 · 还剩 2 小时                │
│ ❤️ 15  💬 20  🔄 5                  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ REPOST                              │
│ @frank · 25分钟前                   │
│ 我也这么觉得！                      │
│ ┌───────────────────────────────┐   │
│ │ @bob · 1小时前                │   │
│ │ 今天天气真好                  │   │
│ │ ❤️ 10  💬 5                   │   │
│ └───────────────────────────────┘   │
│ ❤️ 8  💬 3  🔄 1                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ LOCATION                            │
│ @grace · 30分钟前                   │
│ 在星巴克工作中 ☕                   │
│ 📍 星巴克（国贸店）                 │
│ [小地图预览]                        │
│ [图片1] [图片2]                     │
│ ❤️ 12  💬 4  🔄 2                   │
└─────────────────────────────────────┘
```

---

## 🔄 实现优先级

### MVP (第一版)

1. ✅ **TEXT** - 最基础
2. ✅ **IMAGE** - 高频使用
3. ✅ **REPOST** - 社交核心

### V1.1 (第二版)

4. ⬜ **VIDEO** - 需要转码服务
5. ⬜ **LINK** - 需要爬虫服务

### V1.2 (第三版)

6. ⬜ **POLL** - 相对独立
7. ⬜ **LOCATION** - 需要地图服务

---

## 📊 数据库表设计

### posts 表（核心）

```sql
CREATE TABLE posts (
    id BIGINT PRIMARY KEY,
    author_id BIGINT NOT NULL,
    type VARCHAR(20) NOT NULL,  -- TEXT, IMAGE, VIDEO, etc.
    visibility VARCHAR(20) DEFAULT 'public',
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP,
    
    -- 统计字段
    likes_count BIGINT DEFAULT 0,
    comments_count BIGINT DEFAULT 0,
    reposts_count BIGINT DEFAULT 0,
    views_count BIGINT DEFAULT 0,
    
    -- 关系字段
    reply_to_post_id BIGINT,
    
    INDEX idx_author_created (author_id, created_at),
    INDEX idx_type (type),
    INDEX idx_created (created_at)
);
```

### post_contents 表（内容）

```sql
CREATE TABLE post_contents (
    post_id BIGINT PRIMARY KEY,
    
    -- 通用字段
    text TEXT,
    hashtags JSON,
    mentions JSON,
    
    -- 图片帖子
    images JSON,
    
    -- 视频帖子
    video JSON,
    
    -- 链接帖子
    link_preview JSON,
    
    -- 投票帖子
    poll JSON,
    
    -- 转发帖子
    original_post_id BIGINT,
    repost_comment TEXT,
    
    -- 位置帖子
    location JSON,
    
    FOREIGN KEY (post_id) REFERENCES posts(id)
);
```

### media 表（媒体文件）

```sql
CREATE TABLE media (
    id VARCHAR(50) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type VARCHAR(20) NOT NULL,  -- IMAGE, VIDEO
    url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    size_bytes BIGINT,
    width INT,
    height INT,
    duration_seconds INT,
    blurhash VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL,
    
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_status (status)
);
```

### poll_votes 表（投票记录）

```sql
CREATE TABLE poll_votes (
    id BIGINT PRIMARY KEY,
    post_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    option_indices JSON NOT NULL,  -- [0, 2] for multiple choice
    created_at TIMESTAMP NOT NULL,
    
    UNIQUE KEY idx_user_post (user_id, post_id),
    INDEX idx_post (post_id)
);
```

---

## 🚀 API 端点

```
# 创建不同类型的帖子
POST /api/v1/posts
Body: {
  "type": "TEXT",
  "visibility": "PUBLIC",
  "content": {
    "text": "Hello World"
  }
}

POST /api/v1/posts
Body: {
  "type": "IMAGE",
  "visibility": "PUBLIC",
  "content": {
    "text": "My photos",
    "image_ids": ["img_123", "img_456"]
  }
}

# 上传媒体
POST /api/v1/media
Content-Type: multipart/form-data
Body: file, type, alt_text

# 投票
POST /api/v1/posts/:id/vote
Body: {
  "option_indices": [0]
}

# 获取投票结果
GET /api/v1/posts/:id/poll
```

---

## 🧪 测试用例

### 创建文本帖子

```go
func TestCreateTextPost(t *testing.T) {
    req := &model.CreatePostRequest{
        Type: model.PostType_TEXT,
        Content: &model.CreatePostRequest_Text{
            Text: &model.CreateTextPostRequest{
                Text: "Hello World",
            },
        },
    }
    
    post, err := service.CreatePost(ctx, req, userID)
    assert.NoError(t, err)
    assert.Equal(t, "Hello World", post.GetTextPost().Text)
}
```

### 创建图片帖子

```go
func TestCreateImagePost(t *testing.T) {
    // 1. 先上传图片
    media1, _ := mediaService.Upload(ctx, imageData1)
    media2, _ := mediaService.Upload(ctx, imageData2)
    
    // 2. 创建帖子
    req := &model.CreatePostRequest{
        Type: model.PostType_IMAGE,
        Content: &model.CreatePostRequest_Image{
            Image: &model.CreateImagePostRequest{
                Text: "My photos",
                ImageIds: []string{media1.Id, media2.Id},
            },
        },
    }
    
    post, err := service.CreatePost(ctx, req, userID)
    assert.NoError(t, err)
    assert.Len(t, post.GetImagePost().Images, 2)
}
```

---

## 📱 客户端示例

### Flutter 创建帖子

```dart
class PostComposer extends StatelessWidget {
  final PostType type;
  
  Future<void> _submit() async {
    switch (type) {
      case PostType.TEXT:
        await _api.createPost(CreatePostRequest(
          type: PostType.TEXT,
          text: CreateTextPostRequest(text: _textController.text),
        ));
        break;
        
      case PostType.IMAGE:
        // 1. 上传图片
        final mediaIds = await Future.wait(
          _selectedImages.map((img) => _api.uploadMedia(img))
        );
        
        // 2. 创建帖子
        await _api.createPost(CreatePostRequest(
          type: PostType.IMAGE,
          image: CreateImagePostRequest(
            text: _textController.text,
            imageIds: mediaIds,
          ),
        ));
        break;
    }
  }
}
```

---

## 🎯 总结

这套设计：

✅ **类型丰富** - 覆盖主流社交场景  
✅ **扩展性强** - 使用 oneof，易于添加新类型  
✅ **性能优化** - 分表存储，索引合理  
✅ **用户体验** - 每种类型都有针对性的 UI  
✅ **渐进实现** - 可以分阶段上线

下一步：实现 MVP 三种类型（TEXT, IMAGE, REPOST）！
