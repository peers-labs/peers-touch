# AI Proxy 模块

AI Proxy 模块是 Peers Touch 项目中的 AI 服务代理层，负责统一管理和调用各种 AI 服务提供商（如 OpenAI、Anthropic、Google 等），为上层应用提供标准化的 AI 聊天接口。

## 架构概述

### 核心组件

1. **服务层 (Service Layer)**
   - `IAiBoxService`: 抽象接口，定义了 `chat()` 和 `chatSync()` 方法
   - `AiBoxClientModeService`: 客户端模式的 AI 聊天服务实现
   - `AiBoxServerModeService`: 服务端模式的 AI 聊天服务实现
   - `AiBoxServiceFactory`: 服务工厂，根据模式创建相应的服务实例

2. **适配器层 (Adapter Layer)**
   - `AiProxyAdapter`: 主要的代理适配器，管理所有 AI 提供商
   - 负责初始化和维护提供商列表
   - 提供根据模型名称查找提供商的功能

3. **提供商管理层 (Provider Management Layer)**
   - `ProviderManager`: 统一管理 AI 提供商的创建、更新、删除和查询
   - 支持本地和远程双写策略
   - 提供默认提供商管理功能
   - `RichProvider`: 包装原始 Provider，添加模型解析和配置验证功能

4. **客户端层 (Client Layer)**
   - `ChatClient`: 抽象接口，定义了 `chat()` 方法
   - `OpenAiChatClient`: OpenAI 服务客户端实现
   - 支持流式响应，模拟真实的 OpenAI API 行为
   - 其他 AI 提供商的客户端可以轻松扩展

5. **本地存储层 (Local Storage Layer)**
   - `AiBoxLocalStorageService`: 管理本地存储的提供商、消息历史、主题等数据
   - 提供数据同步和一致性检查功能

6. **模型层 (Model Layer)**
   - 使用 Protocol Buffers 定义的标准化数据模型
   - `ChatCompletionRequest`: 聊天请求模型
   - `ChatCompletionResponse`: 聊天响应模型，支持流式响应
   - `Provider`: 提供商模型，包含配置、设置等信息
   - `RichModel`: 富模型包装，提供更易用的模型接口

### 数据流

```
应用层
    ↓
AiBoxService (通过工厂获取)
    ↓
AiProxyAdapter (选择提供商)
    ↓
RichProvider (包装提供商)
    ↓
ChatClient (具体客户端)
    ↓
转换为提供商特定格式
    ↓
API 调用
    ↓
转换回标准格式
    ↓
Stream<ChatCompletionResponse>
```

## 主要特性

- **统一接口**: 所有 AI 提供商都通过相同的接口暴露
- **流式响应**: 支持 Server-Sent Events 风格的流式响应
- **类型安全**: 使用 Protocol Buffers 确保数据类型安全
- **易于扩展**: 可以轻松添加新的 AI 提供商支持
- **错误处理**: 统一的错误处理和响应机制
- **双写策略**: 支持本地和远程存储，确保数据可靠性
- **离线支持**: 网络不可用时使用本地缓存数据

## 使用示例

### 基本使用

```dart
// 通过工厂创建服务
final aiService = AiBoxServiceFactory.createService(
  mode: AiBoxMode.client,
  aiBoxService: aiBoxService,
);

// 构建请求
final request = ChatCompletionRequest(
  model: 'gpt-3.5-turbo',
  messages: [
    ChatMessage(
      role: ChatRole.CHAT_ROLE_USER,
      content: '你好，请介绍一下你自己',
    ),
  ],
  temperature: 0.7,
  maxTokens: 100,
);

// 发送请求并接收流式响应
final stream = aiService.chat(request);

// 处理响应
await for (final response in stream) {
  if (response.choices.isNotEmpty) {
    final choice = response.choices.first;
    if (choice.hasMessage()) {
      print('AI 回复: ${choice.message.content}');
    }
  }
}
```

### 提供商管理

```dart
// 创建提供商管理器
final providerManager = ProviderManager(
  aiBoxService: aiBoxService,
  localStorage: localStorage,
);

// 创建新的提供商
final provider = providerManager.newProvider(
  ProviderType.openai,
  'https://api.openai.com',
  'your-api-key',
);

// 保存提供商
final createdProvider = await providerManager.createProvider(provider);

// 获取所有提供商
final providers = await providerManager.listProviders();

// 设置默认提供商
await providerManager.setDefaultProvider(createdProvider.id);

// 获取默认提供商
final defaultProvider = await providerManager.getDefaultProvider();
```

### 适配器使用

```dart
// 初始化适配器
final adapter = AiProxyAdapter(aiBoxService);
await adapter.initialize();

// 获取所有提供商
final allProviders = adapter.allProviders;

// 根据模型查找提供商
final provider = adapter.getProviderForModel('gpt-4');
if (provider != null) {
  // 使用提供商进行聊天
  final client = provider.createClient(model: 'gpt-4', apiKey: 'key');
  final response = await client.chat(request);
}
```

## 扩展支持

要添加新的 AI 提供商支持：

1. **创建客户端实现**
   - 在 `client` 目录下创建新的客户端类（如 `AnthropicChatClient`）
   - 实现 `ChatClient` 接口
   - 处理提供商特定的请求格式和响应

2. **注册客户端创建器**
   - 在 `rich_provider.dart` 的 `_clientRegistry` 中添加新的创建器
   - 例如：`'anthropic': ({model, apiKey}) => AnthropicChatClient(apiKey: apiKey)`

3. **更新提供商类型**
   - 在 `provider_manager.dart` 的 `ProviderType` 枚举中添加新类型
   - 更新相关的配置方法（如 `_getDefaultModel`、`_getProviderName` 等）

4. **添加配置支持**
   - 确保新的提供商类型在创建提供商时能够正确配置
   - 更新相关的 JSON 配置解析逻辑

## 错误处理

系统提供统一的错误处理机制：

- **网络错误**: 通过流式响应返回，或抛出 `ProviderSyncException`
- **配置错误**: 抛出 `InvalidProviderConfigException`
- **提供商特定错误**: 被捕获并转换为标准格式
- **存储错误**: 抛出 `StorageException`

可以通过检查响应的 `finishReason` 或捕获相应的异常来处理错误：

```dart
try {
  final stream = aiService.chat(request);
  await for (final response in stream) {
    // 处理正常响应
  }
} on ProviderSyncException catch (e) {
  print('同步错误: ${e.message}');
} on InvalidProviderConfigException catch (e) {
  print('配置错误: ${e.message}');
} on StorageException catch (e) {
  print('存储错误: ${e.message}');
}
```

## 数据同步

系统支持本地和远程数据同步：

- **双写策略**: 创建、更新、删除操作会同时尝试本地和远程存储
- **容错处理**: 远程操作失败时会回退到本地操作
- **离线支持**: 网络不可用时使用本地数据
- **同步状态**: 提供 `getSyncStatus()` 方法检查同步状态

```dart
// 检查同步状态
final syncStatus = await providerManager.getSyncStatus();
print('本地数量: ${syncStatus['localCount']}');
print('远程数量: ${syncStatus['remoteCount']}');
print('是否同步: ${syncStatus['isSynced']}');
```