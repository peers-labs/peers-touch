# 聊天消息输入系统 - 完整架构设计与实施计划

## 一、现状诊断

### 1.1 当前实现状态

**✅ 已实现部分：**
- 文本消息输入和发送（完整可用）
- OSS文件上传服务（完整实现）
- 输入框UI组件（基础功能完备）
- 后端消息类型定义（支持8种消息类型）

**❌ 未完成部分：**
- 表情选择器（UI已注释，功能未连接）
- 图片消息发送（有TODO标记，未实现）
- 文件消息发送（有TODO标记，未实现）
- 贴纸/表情包（有TODO标记）

### 1.2 技术栈分析

**前端（Flutter Desktop）：**
- 状态管理：GetX
- UI层：`client/desktop/lib/features/friend_chat/widgets/chat_input_bar.dart`
- 控制器：`client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart`
- 文件上传：`client/common/peers_touch_base/lib/network/oss/oss_client.dart`

**后端（Go + gRPC）：**
- 消息类型：8种（TEXT, IMAGE, FILE, LOCATION, SYSTEM, STICKER, AUDIO, VIDEO）
- OSS服务：`POST /sub-oss/upload`
- 群聊接口：`SendGroupMessageRequest` 支持 attachments 字段

## 二、架构设计原则

### 2.1 设计原则

1. **分层解耦**：UI层、业务层、服务层严格分离
2. **统一抽象**：所有消息类型使用统一的发送流程
3. **可扩展性**：易于添加新的消息类型（语音、视频等）
4. **用户体验**：提供即时反馈、进度显示、错误处理
5. **性能优化**：大文件分片上传、缩略图生成、本地缓存

### 2.2 关键设计决策

| 决策点 | 选择方案 | 理由 |
|--------|----------|------|
| 消息发送流程 | 先本地展示→上传附件→发送消息 | 提升用户体验，避免阻塞 |
| 文件上传策略 | 独立的上传服务，返回OSS key | 解耦上传和发送逻辑 |
| 表情选择器 | 使用 emoji_picker_flutter 包 | 成熟方案，减少维护成本 |
| 消息类型扩展 | 基于MessageType枚举 + Strategy模式 | 符合开闭原则 |

## 三、核心架构设计

### 3.1 系统分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer (视图层)                        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  FriendChatInputBar (输入框UI)                          │  │
│  │  - 文本输入框                                            │  │
│  │  - 附件按钮 (pickAttachment)                            │  │
│  │  - 表情按钮 (toggleEmojiPicker)                         │  │
│  │  - 发送按钮                                              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                            ↕                                    │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  EmojiPicker Widget (表情选择器)                        │  │
│  │  AttachmentSelector (附件选择面板)                      │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   Controller Layer (控制层)                    │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  FriendChatController (聊天控制器)                      │  │
│  │  + sendMessage(content, type, attachments)              │  │
│  │  + pickAttachment()                                      │  │
│  │  + toggleEmojiPicker()                                   │  │
│  └─────────────────────────────────────────────────────────┘  │
│                            ↕                                    │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  MessageComposer (消息组装器) [新增]                    │  │
│  │  + composeTextMessage()                                  │  │
│  │  + composeImageMessage(file)                             │  │
│  │  + composeFileMessage(file)                              │  │
│  │  + composeStickerMessage(sticker)                        │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   Service Layer (服务层)                       │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  MessageSendingService (消息发送服务) [新增]            │  │
│  │  + send(message, attachments)                            │  │
│  │  + validateMessage()                                     │  │
│  │  + retryOnFailure()                                      │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  AttachmentUploadService (附件上传服务) [新增]          │  │
│  │  + uploadImage(file) → ossKey                            │  │
│  │  + uploadFile(file) → ossKey                             │  │
│  │  + generateThumbnail(image) → thumbnail                  │  │
│  │  + getUploadProgress() → Stream<double>                  │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  OssClient (现有OSS客户端)                              │  │
│  │  + uploadFile(file) → OssFile                            │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   Network Layer (网络层)                       │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  gRPC Client                                             │  │
│  │  - SendGroupMessage(request) → response                  │  │
│  │  - SendPrivateMessage(request) → response                │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 消息发送统一流程

```
用户操作
   ↓
┌──────────────────────────────────────────────────────────┐
│ 1. 输入/选择内容                                          │
│    - 文本：在输入框输入                                   │
│    - 图片：点击附件→选择图片                              │
│    - 文件：点击附件→选择文件                              │
│    - 表情：点击表情按钮→选择emoji/sticker                 │
└──────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────┐
│ 2. 消息预处理 (MessageComposer)                          │
│    - 验证内容有效性                                       │
│    - 创建临时消息对象 (status: SENDING)                   │
│    - 添加到本地消息列表（乐观更新）                       │
└──────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────┐
│ 3. 附件上传 (如果有附件)                                  │
│    ┌────────────────────────────────────────────────┐    │
│    │ AttachmentUploadService:                       │    │
│    │   - 压缩/优化（图片）                           │    │
│    │   - 生成缩略图（图片/视频）                     │    │
│    │   - 上传到OSS                                   │    │
│    │   - 获取ossKey和URL                             │    │
│    │   - 更新上传进度                                │    │
│    └────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────┐
│ 4. 构造消息请求                                           │
│    - 组装 SendGroupMessageRequest:                        │
│      * type: MessageType (TEXT/IMAGE/FILE/STICKER)       │
│      * content: 文本内容 / 文件名                         │
│      * attachments: [{ type, url, size, ... }]           │
│      * reply_to_ulid: 回复消息ID（如果有）                │
└──────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────┐
│ 5. 发送消息 (MessageSendingService)                      │
│    - 调用gRPC接口                                         │
│    - 等待服务器响应                                       │
│    - 重试机制（如果失败）                                 │
└──────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────┐
│ 6. 处理响应                                               │
│    成功：                                                 │
│      - 更新本地消息状态 (status: SENT)                    │
│      - 更新消息ID为服务器返回的ID                         │
│      - 更新会话最后消息                                   │
│    失败：                                                 │
│      - 更新消息状态 (status: FAILED)                      │
│      - 显示错误提示                                       │
│      - 提供重试按钮                                       │
└──────────────────────────────────────────────────────────┘
```

### 3.3 数据模型设计

#### 3.3.1 扩展 ChatMessage 模型

```dart
// 位置：client/desktop/lib/features/friend_chat/models/chat_message_extended.dart
class ChatMessage {
  final String id;
  final String sessionId;
  final String senderId;
  final MessageType type;
  final String content;
  final List<MessageAttachment>? attachments;  // [新增]
  final Timestamp sentAt;
  final MessageStatus status;
  final String? replyToId;                     // [新增]
  final UploadProgress? uploadProgress;        // [新增]
}

// 附件模型
class MessageAttachment {
  final AttachmentType type;
  final String url;
  final String? thumbnailUrl;
  final int? fileSize;
  final String? fileName;
  final Map<String, dynamic>? metadata;
}

// 附件类型
enum AttachmentType {
  IMAGE,
  FILE,
  AUDIO,
  VIDEO,
  STICKER,
  LOCATION,
  CONTACT,
}

// 上传进度
class UploadProgress {
  final double percentage;
  final int uploaded;
  final int total;
  final UploadStatus status;
}

enum UploadStatus {
  UPLOADING,
  COMPLETED,
  FAILED,
}
```

## 四、实施计划

### Phase 1: 基础架构搭建（预计2天）

#### 任务 1.1: 创建服务层基础架构

**文件清单：**
1. `client/desktop/lib/features/friend_chat/services/message_composer.dart`
2. `client/desktop/lib/features/friend_chat/services/attachment_upload_service.dart`
3. `client/desktop/lib/features/friend_chat/services/message_sending_service.dart`
4. `client/desktop/lib/features/friend_chat/models/message_attachment.dart`
5. `client/desktop/lib/features/friend_chat/models/upload_progress.dart`

**任务详情：**

**1.1.1 创建 MessageComposer 服务**
- [ ] 创建 `message_composer.dart` 文件
- [ ] 实现 `composeTextMessage()` 方法
- [ ] 实现 `composeImageMessage()` 方法
- [ ] 实现 `composeFileMessage()` 方法
- [ ] 实现 `composeStickerMessage()` 方法
- [ ] 实现本地消息ID生成器
- [ ] 编写单元测试

**1.1.2 创建 AttachmentUploadService 服务**
- [ ] 创建 `attachment_upload_service.dart` 文件
- [ ] 实现 `uploadImage()` 方法（带进度回调）
- [ ] 实现 `uploadFile()` 方法（带进度回调）
- [ ] 实现图片压缩功能（依赖 flutter_image_compress）
- [ ] 实现缩略图生成功能
- [ ] 实现文件类型检测和验证
- [ ] 实现文件大小限制检查
- [ ] 编写单元测试

**1.1.3 创建 MessageSendingService 服务**
- [ ] 创建 `message_sending_service.dart` 文件
- [ ] 实现统一的 `sendMessage()` 方法
- [ ] 实现消息验证逻辑
- [ ] 实现附件上传协调逻辑
- [ ] 实现gRPC请求构造
- [ ] 实现重试机制（exponential backoff）
- [ ] 实现错误处理和异常转换
- [ ] 编写单元测试

**1.1.4 扩展数据模型**
- [ ] 在 `ChatMessage` 中添加 `attachments` 字段
- [ ] 在 `ChatMessage` 中添加 `replyToId` 字段
- [ ] 在 `ChatMessage` 中添加 `uploadProgress` 字段
- [ ] 创建 `MessageAttachment` 模型
- [ ] 创建 `UploadProgress` 模型
- [ ] 实现模型的 `copyWith` 方法
- [ ] 实现模型的 `toJson` / `fromJson` 方法

#### 任务 1.2: 更新依赖配置

**修改文件：**
- `client/desktop/pubspec.yaml`

**新增依赖：**
```yaml
dependencies:
  # 图片处理
  image: ^4.0.0
  flutter_image_compress: ^2.0.0
  
  # 文件处理
  mime: ^1.0.0
  
  # 权限管理
  permission_handler: ^11.0.0
```

**任务：**
- [ ] 添加必要的依赖包
- [ ] 运行 `flutter pub get`
- [ ] 验证依赖安装成功

### Phase 2: 图片消息支持（预计2天）

#### 任务 2.1: 实现图片选择和预览

**修改文件：**
- `client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart`
- `client/desktop/lib/features/friend_chat/widgets/chat_input_bar.dart`

**新增文件：**
- `client/desktop/lib/features/friend_chat/widgets/attachment_selector.dart`
- `client/desktop/lib/features/friend_chat/widgets/image_preview_dialog.dart`

**任务：**
- [ ] 创建附件选择器UI组件（支持图片/文件/其他）
- [ ] 实现图片选择功能
- [ ] 实现图片预览对话框
- [ ] 支持多图选择（可选）
- [ ] 支持图片裁剪（可选）

#### 任务 2.2: 实现图片上传和发送

**修改文件：**
- `client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart`

**任务：**
- [ ] 集成 `AttachmentUploadService`
- [ ] 实现图片压缩逻辑
- [ ] 实现缩略图生成
- [ ] 实现上传进度追踪
- [ ] 在消息列表中显示上传进度
- [ ] 实现图片消息发送（调用 MessageSendingService）
- [ ] 处理上传失败和重试

#### 任务 2.3: 实现图片消息展示

**修改文件：**
- `client/desktop/lib/features/friend_chat/widgets/chat_message_item.dart`

**新增文件：**
- `client/desktop/lib/features/friend_chat/widgets/message_types/image_message_bubble.dart`

**任务：**
- [ ] 创建图片消息气泡组件
- [ ] 支持缩略图加载
- [ ] 支持点击查看大图
- [ ] 支持图片加载失败显示
- [ ] 支持上传中的进度显示

### Phase 3: 文件消息支持（预计1天）

#### 任务 3.1: 实现文件选择和上传

**修改文件：**
- `client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart`
- `client/desktop/lib/features/friend_chat/widgets/attachment_selector.dart`

**任务：**
- [ ] 在附件选择器中添加文件选项
- [ ] 实现文件选择功能
- [ ] 实现文件大小验证（限制100MB）
- [ ] 实现文件类型检测
- [ ] 实现文件上传进度显示
- [ ] 实现文件消息发送

#### 任务 3.2: 实现文件消息展示

**新增文件：**
- `client/desktop/lib/features/friend_chat/widgets/message_types/file_message_bubble.dart`

**任务：**
- [ ] 创建文件消息气泡组件
- [ ] 显示文件图标（根据文件类型）
- [ ] 显示文件名和大小
- [ ] 支持点击下载文件
- [ ] 支持上传中的进度显示

### Phase 4: 表情选择器（预计1天）

#### 任务 4.1: 集成表情选择器

**修改文件：**
- `client/desktop/pubspec.yaml`
- `client/desktop/lib/features/friend_chat/widgets/chat_input_bar.dart`

**新增文件：**
- `client/desktop/lib/features/friend_chat/widgets/emoji_picker_panel.dart`

**任务：**
- [ ] 添加 `emoji_picker_flutter` 依赖
- [ ] 创建表情选择面板组件
- [ ] 实现表情选择和插入到文本
- [ ] 实现表情选择器的显示/隐藏切换
- [ ] 支持常用表情记录

#### 任务 4.2: 实现贴纸/表情包支持

**新增文件：**
- `client/desktop/lib/features/friend_chat/widgets/sticker_grid.dart`
- `client/desktop/lib/features/friend_chat/models/sticker.dart`

**任务：**
- [ ] 创建贴纸网格组件
- [ ] 实现贴纸选择
- [ ] 实现贴纸消息发送
- [ ] 实现自定义贴纸上传
- [ ] 实现贴纸收藏功能

### Phase 5: 优化和测试（预计1天）

#### 任务 5.1: 错误处理和用户体验优化

**任务：**
- [ ] 实现网络错误处理和提示
- [ ] 实现文件太大的错误提示
- [ ] 实现上传失败的重试机制
- [ ] 实现消息发送失败的重试按钮
- [ ] 优化加载状态显示
- [ ] 优化动画效果
- [ ] 添加haptic反馈（移动端）

#### 任务 5.2: 性能优化

**任务：**
- [ ] 实现图片缓存策略
- [ ] 实现大文件分片上传（可选）
- [ ] 实现断点续传（可选）
- [ ] 优化内存使用
- [ ] 优化图片加载性能

#### 任务 5.3: 测试

**任务：**
- [ ] 编写单元测试（服务层）
- [ ] 编写Widget测试（UI组件）
- [ ] 编写集成测试（端到端流程）
- [ ] 手动测试各种场景
- [ ] 测试错误场景（网络断开、文件过大等）
- [ ] 性能测试

## 五、验收标准

### 5.1 功能验收

- [ ] **文本消息**：能正常发送和显示
- [ ] **图片消息**：能选择、上传、发送、显示图片
- [ ] **文件消息**：能选择、上传、发送、显示文件
- [ ] **表情/Emoji**：能选择和插入emoji到文本
- [ ] **贴纸**：能选择和发送贴纸消息
- [ ] **上传进度**：能实时显示上传进度
- [ ] **错误处理**：能正确处理和提示各种错误
- [ ] **重试机制**：失败消息能重新发送

### 5.2 性能验收

- [ ] 图片消息发送延迟 < 3秒（1MB图片）
- [ ] 文件消息发送延迟 < 10秒（10MB文件）
- [ ] UI响应时间 < 100ms
- [ ] 内存占用增长 < 50MB（发送100条消息）
- [ ] 表情选择器打开延迟 < 500ms

### 5.3 质量验收

- [ ] 代码覆盖率 > 80%
- [ ] 无内存泄漏
- [ ] 无UI卡顿
- [ ] 符合代码规范
- [ ] 通过Code Review

## 六、风险评估与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 大文件上传失败 | 高 | 中 | 实现断点续传、分片上传 |
| 图片压缩质量问题 | 中 | 低 | 提供压缩参数配置，让用户选择质量 |
| 表情包加载慢 | 中 | 中 | 本地缓存常用表情包 |
| 跨平台兼容性 | 高 | 低 | 使用成熟的跨平台库 |
| 内存占用过高 | 高 | 中 | 实现图片缓存策略，及时释放资源 |
| 网络不稳定导致上传失败 | 高 | 高 | 实现重试机制和断点续传 |

## 七、关键技术点

### 7.1 图片压缩策略

```dart
// 压缩规则：
// 1. 如果图片宽高超过2000px，压缩到2000px
// 2. 质量设置为85%
// 3. 保持原始宽高比

Future<File> compressImage(File imageFile) async {
  final image = img.decodeImage(await imageFile.readAsBytes());
  if (image == null) throw Exception('Invalid image');
  
  int targetWidth = image.width;
  int targetHeight = image.height;
  
  if (image.width > 2000 || image.height > 2000) {
    if (image.width > image.height) {
      targetWidth = 2000;
      targetHeight = (image.height * 2000 / image.width).round();
    } else {
      targetHeight = 2000;
      targetWidth = (image.width * 2000 / image.height).round();
    }
  }
  
  final resized = img.copyResize(image, width: targetWidth, height: targetHeight);
  
  final result = await FlutterImageCompress.compressWithList(
    img.encodeJpg(resized, quality: 85),
  );
  
  final compressedFile = File('${imageFile.parent.path}/compressed_${path.basename(imageFile.path)}');
  await compressedFile.writeAsBytes(result);
  
  return compressedFile;
}
```

### 7.2 上传进度追踪

```dart
// 使用 Stream 传递上传进度
Stream<UploadProgress> uploadWithProgress(File file) async* {
  final fileSize = await file.length();
  int uploaded = 0;
  
  yield UploadProgress(
    percentage: 0.0,
    uploaded: 0,
    total: fileSize,
    status: UploadStatus.UPLOADING,
  );
  
  // 使用 Dio 的 onSendProgress
  final response = await dio.post(
    '/sub-oss/upload',
    data: FormData.fromMap({
      'file': await MultipartFile.fromFile(file.path),
    }),
    onSendProgress: (sent, total) {
      uploaded = sent;
      final progress = UploadProgress(
        percentage: sent / total,
        uploaded: sent,
        total: total,
        status: UploadStatus.UPLOADING,
      );
      // 通过StreamController发送进度
    },
  );
  
  yield UploadProgress(
    percentage: 1.0,
    uploaded: fileSize,
    total: fileSize,
    status: UploadStatus.COMPLETED,
  );
}
```

### 7.3 乐观更新策略

```dart
// 先在本地展示消息，再发送到服务器
Future<void> sendImageMessage(File imageFile) async {
  // 1. 创建临时消息，立即显示
  final tempMessage = messageComposer.composeImageMessage(
    sessionId: currentSession.id,
    imageFile: imageFile,
  );
  
  messages.add(tempMessage);  // 乐观更新
  
  try {
    // 2. 上传图片
    final attachment = await attachmentUploadService.uploadImage(
      imageFile,
      onProgress: (progress) {
        // 更新消息的上传进度
        final index = messages.indexWhere((m) => m.id == tempMessage.id);
        messages[index] = messages[index].copyWith(uploadProgress: progress);
      },
    );
    
    // 3. 发送消息
    final sentMessage = await messageSendingService.sendMessage(
      tempMessage.copyWith(attachments: [attachment]),
    );
    
    // 4. 更新本地消息
    final index = messages.indexWhere((m) => m.id == tempMessage.id);
    messages[index] = sentMessage;
    
  } catch (e) {
    // 5. 失败处理
    final index = messages.indexWhere((m) => m.id == tempMessage.id);
    messages[index] = messages[index].copyWith(
      status: MessageStatus.FAILED,
    );
  }
}
```

## 八、时间估算

| 阶段 | 预计时间 | 关键里程碑 |
|------|----------|------------|
| Phase 1: 基础架构 | 2天 | 服务层完成，模型扩展完成 |
| Phase 2: 图片消息 | 2天 | 图片选择、上传、发送、显示全流程打通 |
| Phase 3: 文件消息 | 1天 | 文件选择、上传、发送、显示全流程打通 |
| Phase 4: 表情选择器 | 1天 | 表情/贴纸选择和发送功能完成 |
| Phase 5: 优化测试 | 1天 | 所有功能测试通过，性能达标 |
| **总计** | **7天** | **完整消息输入系统上线** |

## 九、后续规划

完成本次计划后，可以考虑以下扩展功能：

1. **语音消息**：录音、播放、波形显示
2. **视频消息**：视频选择、压缩、缩略图、播放
3. **位置消息**：地图选择、位置展示
4. **名片消息**：联系人选择、名片展示
5. **消息引用/转发**：支持引用和转发消息
6. **@提及功能**：在群聊中@某个成员
7. **草稿保存**：自动保存未发送的消息内容
8. **消息编辑/撤回**：发送后的消息编辑和撤回

---

**计划制定时间**：2026-02-15
**计划制定人**：AI Assistant
**预计完成时间**：2026-02-22（7个工作日）
