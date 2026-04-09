# Peers-Touch Proto 编写指南

本文档基于 `model/domain/` 下的真实代码提炼，作为项目内所有 Proto 文件的编写规范。

---

## 1. 基本声明

所有 proto 文件必须使用 `proto3` 语法，并按照以下模板声明头部信息：

```protobuf
syntax = "proto3";

package peers_touch.model.<domain>.v1;

option go_package = "github.com/peers-labs/peers-touch/station/frame/touch/model;model";
```

### package 命名规则

格式固定为 `peers_touch.model.<domain>.v1`，其中 `<domain>` 对应 `model/domain/` 下的目录名。

已有的 domain 示例：

| domain | package |
|--------|---------|
| actor | `peers_touch.model.actor.v1` |
| auth | `peers_touch.model.auth.v1` |
| chat | `peers_touch.model.chat.v1` |
| events | `peers_touch.model.events.v1` |
| social | `peers_touch.model.social.v1` |
| error | `peers_touch.model.error.v1` |
| ai_chat | `peers_touch.model.ai_chat.v1` |
| oss | `peers_touch.model.oss.v1` |
| common | `peers_touch.model.common.v1` |

### go_package 规则

go_package 有两种形式，取决于代码生成的目标位置：

```protobuf
// 形式一：生成到 station/frame/touch/model/ (大多数 domain 使用)
option go_package = "github.com/peers-labs/peers-touch/station/frame/touch/model;model";

// 形式二：生成到独立子目录 (需要独立 Go package 时)
option go_package = "github.com/peers-labs/peers-touch/station/frame/touch/model/events;events";
option go_package = "github.com/peers-labs/peers-touch/station/frame/touch/model/chat;chat";
option go_package = "github.com/peers-labs/peers-touch/station/frame/touch/model/oss;oss";

// 形式三：subserver 内部模型
option go_package = "github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model;model";
```

选择依据：如果该 domain 的模型仅在某个 subserver 内使用，使用形式三；否则优先使用形式一，当 Go 包名冲突时使用形式二。

---

## 2. 目录结构

```
model/domain/
  actor/
    actor.proto
    actor_status.proto
    actor_signup.proto
    session.proto
    session_api.proto
    preferences.proto
  auth/
    auth.proto
  chat/
    chat.proto
    friend_chat.proto
    group_chat.proto
    sticker.proto
    announcement.proto
  social/
    post.proto
    comment.proto
    relationship.proto
    media.proto
    poll.proto
    social.proto
  error/
    error.proto
  events/
    events.proto
  common/
    common.proto
  ...
```

一个 domain 目录下可以有多个 proto 文件，按职责拆分。文件名使用 snake_case。

---

## 3. 字段规范

### 3.1 字段命名：snake_case

```protobuf
message Actor {
  string id = 1;
  string username = 2;
  string display_name = 3;
  uint64 actor_id = 9 [json_name = "actor_id"];
}
```

### 3.2 json_name 标注

当字段名含下划线且需要跨平台 JSON 序列化一致性时，加 `json_name` 标注：

```protobuf
message ActorProfile {
  string display_name = 2 [json_name = "display_name"];
  string server_domain = 12 [json_name = "server_domain"];
  string key_fingerprint = 13 [json_name = "key_fingerprint"];
  int64 followers_count = 19 [json_name = "followers_count"];
  bool manually_approves_followers = 25 [json_name = "manually_approves_followers"];
}
```

单词段字段（如 `id`、`username`、`note`）不需要 `json_name`。

### 3.3 optional 关键字

仅在「该字段可以不传」的场景使用 `optional`，典型场景是更新请求：

```protobuf
message UpdateProfileRequest {
  optional string display_name = 1 [json_name = "display_name"];
  optional string note = 2;
  optional string avatar = 3;
  optional bool manually_approves_followers = 10 [json_name = "manually_approves_followers"];
}

message ChatCompletionRequest {
  string session_id = 1;
  string topic_id = 2;
  string model = 3;
  repeated ChatMessage messages = 4;
  optional bool stream = 5;
  optional double temperature = 6;
  optional int32 max_tokens = 7;
}
```

### 3.4 时间字段

使用 `google.protobuf.Timestamp`，需 import：

```protobuf
import "google/protobuf/timestamp.proto";

message Event {
  string id = 1;
  string type = 2;
  bytes payload = 3;
  google.protobuf.Timestamp created_at = 4;
}

message AuthTokens {
  string token = 1;
  string access_token = 2;
  string refresh_token = 3;
  string token_type = 4;
  google.protobuf.Timestamp expires_at = 5;
}
```

特殊情况：如果该时间仅作为 Unix 时间戳整数传输（如 ai_chat 中的轻量场景），可用 `int64`：

```protobuf
message ChatSession {
  int64 created_at = 13;
  int64 updated_at = 14;
}
```

### 3.5 多态数据

使用 `google.protobuf.Any`：

```protobuf
import "google/protobuf/any.proto";

message LoginData {
  AuthTokens tokens = 1;
  string session_id = 2;
  google.protobuf.Any actor = 3;
}

message PeersResponse {
  string code = 1;
  string msg = 2;
  google.protobuf.Any data = 3;
}
```

使用 `google.protobuf.Struct` 传递动态 JSON 结构：

```protobuf
import "google/protobuf/struct.proto";

message ToolCall {
  string id = 1;
  string type = 2;
  google.protobuf.Struct function = 3;
}
```

### 3.6 动态键值对

使用 `map<string, string>`：

```protobuf
message Actor {
  map<string, string> endpoints = 7;
}

message ErrorResponse {
  ErrorCode code = 1;
  string message = 2;
  map<string, string> details = 3;
}

message ChatSession {
  map<string, string> metadata = 9;
}
```

### 3.7 oneof 使用

当一个 message 有多种互斥内容类型时，使用 `oneof`：

```protobuf
message Post {
  string id = 1;
  string author_id = 2;
  PostType type = 3;

  oneof content {
    TextPost text_post = 30;
    ImagePost image_post = 31;
    VideoPost video_post = 32;
    LinkPost link_post = 33;
    PollPost poll_post = 34;
    RepostPost repost_post = 35;
    LocationPost location_post = 36;
  }
}
```

### 3.8 跨文件引用

引用其他 domain 的 proto 时，使用相对于 `model/` 目录的路径：

```protobuf
import "domain/activity/activity.proto";

message PollPost {
  string text = 1;
  peers_touch.model.activity.v1.Poll poll = 2;
}
```

---

## 4. 枚举规范

### 4.1 命名规则

- 枚举类型名：PascalCase
- 枚举值：UPPER_SNAKE_CASE
- 第一个值必须为 `_UNSPECIFIED = 0`（proto3 要求零值为默认）
- 枚举值必须带类型前缀，避免命名冲突

```protobuf
enum ErrorCode {
  ERROR_CODE_UNSPECIFIED = 0;
  ERROR_CODE_UNDEFINED = 1;
  ERROR_CODE_ACTOR_NOT_FOUND = 10008;
  ERROR_CODE_UNAUTHORIZED = 20001;
}

enum SessionType {
  SESSION_TYPE_UNSPECIFIED = 0;
  SESSION_TYPE_DIRECT = 1;
  SESSION_TYPE_GROUP = 2;
}

enum MessageType {
  MESSAGE_TYPE_UNSPECIFIED = 0;
  MESSAGE_TYPE_TEXT = 1;
  MESSAGE_TYPE_IMAGE = 2;
  MESSAGE_TYPE_FILE = 3;
}

enum MessageStatus {
  MESSAGE_STATUS_UNSPECIFIED = 0;
  MESSAGE_STATUS_SENDING = 1;
  MESSAGE_STATUS_SENT = 2;
  MESSAGE_STATUS_DELIVERED = 3;
  MESSAGE_STATUS_READ = 4;
  MESSAGE_STATUS_FAILED = 5;
}

enum ChatRole {
  CHAT_ROLE_UNSPECIFIED = 0;
  CHAT_ROLE_SYSTEM = 1;
  CHAT_ROLE_USER = 2;
  CHAT_ROLE_ASSISTANT = 3;
  CHAT_ROLE_TOOL = 4;
}
```

### 4.2 编号分段

ErrorCode 采用编号分段管理不同业务域的错误码：

```protobuf
enum ErrorCode {
  ERROR_CODE_UNSPECIFIED = 0;
  ERROR_CODE_UNDEFINED = 1;

  // 10000 段：Actor/WellKnown 相关
  ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT = 10001;
  ERROR_CODE_ACTOR_NOT_FOUND = 10008;

  // 20000 段：通用 HTTP/协议错误
  ERROR_CODE_UNAUTHORIZED = 20001;
  ERROR_CODE_INTERNAL_SERVER_ERROR = 20008;

  // 30000 段：帖子/社交相关
  ERROR_CODE_POST_NOT_FOUND = 30002;
  ERROR_CODE_CREATE_POST_FAILED = 30004;
}
```

---

## 5. 请求/响应命名模式

遵循 `<Action><Resource>Request` / `<Action><Resource>Response` 的命名模式：

```protobuf
// 查询
message GetPostRequest {
  string post_id = 1;
}
message GetPostResponse {
  Post post = 1;
}

// 列表（带游标分页）
message ListPostsRequest {
  string cursor = 1;
  int32 limit = 2;
  PostFilter filter = 3;
}
message ListPostsResponse {
  repeated Post posts = 1;
  string next_cursor = 2;
  bool has_more = 3;
}

// 列表（带页码分页，来自 common.proto）
message PageQuery {
  int32 page_number = 1;
  int32 page_size = 2;
}

// 创建
message CreatePostRequest {
  PostType type = 1;
  PostVisibility visibility = 2;
}
message CreatePostResponse {
  Post post = 1;
}

// 更新
message UpdatePostRequest {
  string post_id = 1;
  optional string content = 2;
  optional PostVisibility visibility = 3;
}

// 删除
message DeletePostRequest {
  string post_id = 1;
}
message DeletePostResponse {
  bool success = 1;
}

// 事件拉取
message PullEventsRequest {
  int32 limit = 1;
  int64 since_ts = 2;
}
message PullEventsResponse {
  repeated Event events = 1;
}

// 事件确认
message AckEventsRequest {
  repeated string event_ids = 1;
}
message AckEventsResponse {
  int32 acked_count = 1;
}
```

---

## 6. 构建流程

### 6.1 Go + Dart 生成

```bash
# 在项目根目录执行
./model/build.sh
```

该脚本做三件事：
1. 遍历 `model/domain/` 下所有 `.proto` 文件
2. 生成 Dart 代码到 `client/common/peers_touch_base/lib/model/domain/`
3. 生成 Go 代码到 `apps/station/`（路径由 `go_package` 决定）

### 6.2 Kotlin + Swift 生成

```bash
# 全部生成
./tooling/scripts/proto-gen-mobile.sh

# 仅 Kotlin
./tooling/scripts/proto-gen-mobile.sh kotlin

# 仅 Swift
./tooling/scripts/proto-gen-mobile.sh swift
```

输出路径：
- Kotlin: `apps/mobile/android/app/src/main/java/`
- Swift: `apps/mobile/ios/PeersTouch/Core/Proto/`

### 6.3 Rust (Desktop) 生成

Desktop 端使用 prost 编译 proto，生成的 `.rs` 文件位于 `apps/desktop/src-tauri/src/model/`。

在 `mod.rs` 中通过 `include!` 宏引入：

```rust
pub mod chat {
    pub mod v1 {
        include!("peers_touch.model.chat.v1.rs");
    }
    pub use v1::*;
}

pub mod actor {
    pub mod v1 {
        include!("peers_touch.model.actor.v1.rs");
    }
    pub use v1::*;
}
```

新增 domain 时，需要在 `mod.rs` 中添加对应的 module 声明。

---

## 7. 强制规则

1. **所有跨平台数据模型必须先定义 .proto** -- 绝对不允许手写模型类（Go struct / Dart class / Rust struct / Kotlin data class / Swift struct）来替代 proto 生成
2. **绝对不允许编辑生成文件** -- `.pb.go`、`.pb.dart`、`prost` 生成的 `.rs` 文件均为生成产物，修改会在下次 build 时被覆盖
3. **新 proto 文件必须遵守命名和 package 规范** -- 参照本文档第 1、2 节
4. **提交 .proto 源文件** -- 生成文件可能在 `.gitignore` 中，但 `.proto` 必须提交
5. **域内应用通信必须使用 protobuf 协议** -- 仅在与第三方系统对接等不可避免的场景下使用 JSON

---

## 8. 新增 Proto 检查清单

以新增一个 `notification` domain 为例，完整流程：

### 第一步：创建 proto 文件

```
model/domain/notification/notification.proto
```

```protobuf
syntax = "proto3";

package peers_touch.model.notification.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/peers-labs/peers-touch/station/frame/touch/model;model";

enum NotificationType {
  NOTIFICATION_TYPE_UNSPECIFIED = 0;
  NOTIFICATION_TYPE_LIKE = 1;
  NOTIFICATION_TYPE_COMMENT = 2;
  NOTIFICATION_TYPE_FOLLOW = 3;
  NOTIFICATION_TYPE_MENTION = 4;
}

message Notification {
  string id = 1;
  NotificationType type = 2;
  string actor_id = 3 [json_name = "actor_id"];
  string target_id = 4 [json_name = "target_id"];
  string content = 5;
  bool is_read = 6 [json_name = "is_read"];
  google.protobuf.Timestamp created_at = 7;
}

message ListNotificationsRequest {
  string cursor = 1;
  int32 limit = 2;
  optional bool unread_only = 3 [json_name = "unread_only"];
}

message ListNotificationsResponse {
  repeated Notification notifications = 1;
  string next_cursor = 2;
  bool has_more = 3;
}

message MarkReadRequest {
  repeated string notification_ids = 1 [json_name = "notification_ids"];
}

message MarkReadResponse {
  int32 marked_count = 1 [json_name = "marked_count"];
}
```

### 第二步：生成 Go + Dart 代码

```bash
./model/build.sh
```

### 第三步：生成 Mobile 代码

```bash
./tooling/scripts/proto-gen-mobile.sh
```

### 第四步：注册 Rust model module

在 `apps/desktop/src-tauri/src/model/mod.rs` 中添加：

```rust
pub mod notification {
    pub mod v1 {
        include!("peers_touch.model.notification.v1.rs");
    }
    pub use v1::*;
}
```

### 第五步：验证编译

确认以下平台均编译通过：
- Go: `cd apps/station && go build ./...`
- Dart: `cd client/common/peers_touch_base && flutter pub get && dart analyze`
- Rust: `cd apps/desktop/src-tauri && cargo check`
- Kotlin/Swift: 各自平台 build
