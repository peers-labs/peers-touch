# peers_touch_base

`peers_touch_base` 是 Peers Touch 项目的核心基础库，提供了与 AI 服务交互、数据模型定义和网络通信等核心功能。

## 架构与使用说明

本模块的核心入口是 `AiBoxFacadeService`，它为上层应用提供了一个统一的、简洁的 AI 服务接口。为了实现灵活性和可测试性，`AiBoxFacadeService` 支持两种操作模式：**本地模式**和**远程模式**。

### 公共 API (Public API)

以下部分是为外部模块设计的，可以安全地在您的应用代码中直接使用。

#### 1. `AiBoxFacadeService`

这是与本模块交互的**唯一入口点**。它封装了所有复杂的内部逻辑，如 Provider 管理、模型管理和聊天功能。

**使用方法:**

```dart
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_mode.dart';

// 默认使用本地模式 (离线)
final localFacade = AiBoxFacadeService();

// 明确指定使用本地模式
final localFacadeExplicit = AiBoxFacadeService(mode: AiBoxMode.local);

// 明确指定使用远程模式 (与服务器同步)
final remoteFacade = AiBoxFacadeService(mode: AiBoxMode.remote);
```

#### 2. `AiBoxMode` (枚举)

这是一个简单的枚举，用于在创建 `AiBoxFacadeService` 实例时指定其工作模式。

*   `AiBoxMode.local`: **本地模式**。所有 Provider 数据都存储在设备本地，不与任何服务器进行网络同步。这是默认模式。
*   `AiBoxMode.remote`: **远程模式**。Provider 数据会尝试与后端服务器进行同步，并具备本地缓存和回退能力。

### 内部实现 (Internal Implementation)

**警告：** 以下部分是 `ai_proxy` 模块的内部实现细节。**外部模块不应该直接引用或依赖它们**。这些实现可能会在未来的版本中更改，恕不另行通知。

*   **`IProviderManager` (接口)**: 定义了 Provider 管理器行为的内部接口。
*   **`ProviderManager` (类)**: `IProviderManager` 的**在线**实现，负责与后端服务器进行数据同步。
*   **`LocalProviderManager` (类)**: `IProviderManager` 的**离线**实现，所有操作均在本地完成。

将这些实现细节保持在内部，可以确保 `AiBoxFacadeService` 的 API 保持稳定，同时允许我们自由地优化或重构内部逻辑，而不会影响到上层应用代码。

## Features

*   支持本地和远程两种模式的 AI Provider 管理。
*   统一的聊天 API 接口。
*   可扩展的架构设计。

