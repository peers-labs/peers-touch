# 项目脚手架 (Project Scaffolding)

本文件是你理解项目代码结构、进行空间定位的“地图”。它详细描述了项目的目录结构、模块职责以及代码组织规范。在生成或修改任何代码之前，你必须依据此“地图”来确定代码的正确位置。

## 1. 跨三端（Mobile/Desktop/Station）的统一模型源

**警告：这是项目的核心所在，必须严格遵守。**

我们项目横跨 Mobile, Desktop, Station 三个终端，它们的业务逻辑必须围绕**统一的数据模型**进行。

*   **模型的唯一来源**: 所有的数据模型（Model）都定义在与 `desktop` 目录平级的 `model/domain` 目录下的 `.proto` 文件中。
*   **生成而非手写**: 你**绝不能**在 `desktop` 项目的任何位置（包括 `features/*/model`）手动创建或修改模型类。所有模型文件都是通过脚本从 `.proto` 文件自动生成的。
*   **你的职责**: 当你需要使用某个数据模型时，你必须从已生成的文件中 `import` 它。如果你发现需要的模型或字段不存在，你应该向用户提出请求，要求在 `.proto` 文件中进行定义和更新，而不是自己动手修改。

## 2. Desktop端顶级目录结构与职责

```
lib/
├── app/         # 应用级配置中心 (App Configuration Hub)
├── core/        # 全局通用能力层 (Global Core Layer)
├── features/    # 业务功能模块层 (Business Feature Layer)
└── main.dart    # 应用入口 (Entry Point)
```

*   **`app/`**: **绝对的配置中心**。只存放应用的全局配置，如路由、主题、多语言和全局依赖注入。**严禁包含任何业务逻辑**。
*   **`core/`**: **无业务倾向的工具箱**。存放跨模块复用的、与具体业务完全无关的组件、服务和工具。例如，一个通用的按钮（`CommonButton`）可以放在这里，但一个“购买”按钮则不行。
*   **`features/`**: **业务逻辑的主战场**。所有与特定业务功能相关的代码（View, Controller, Model）都必须按模块划分并存放在此。这是项目扩展的主要区域。
*   **`main.dart`**: **唯一的启动入口**。负责初始化应用并加载根`GetMaterialApp`。

## 3. `features/` 业务模块结构规范

所有业务模块都必须遵循严格的“自包含”结构。以一个名为 `example_feature` 的模块为例：

```
features/
└── example_feature/
    ├── controller/         # 业务逻辑与状态管理
    │   └── example_controller.dart
    ├── view/               # 纯粹的UI展示
    │   └── example_page.dart
    ├── model/              # 该模块独有的数据模型
    │   └── example_model.dart
    └── example_binding.dart  # 模块依赖注入
```

*   **`controller/`**: 存放该模块所有的 `GetxController`。负责处理业务逻辑、接口请求和状态管理。
*   **`view/`**: 存放该模块所有的 `StatelessWidget` 视图。它们是纯粹的UI，通过 `Get.find()` 从 `Controller` 获取数据并展示。
*   **`model/`**: 存放仅供此模块使用的数据模型。如果一个模型需要在多个模块间共享，它应该被移至 `features/shared/models/`。
*   **`*_binding.dart`**: 负责使用 `Get.lazyPut()` 注册该模块的 `Controller`，实现依赖的懒加载和自动回收。

## 4. `core/` 全局通用能力详解

`core/` 目录是你寻找可复用基础能力的地方。

```
core/
├── components/   # 通用UI组件 (e.g., CommonButton, LoadingDialog)
├── network/      # 网络请求封装 (e.g., ApiClient, ApiException)
├── storage/      # 本地存储 (e.g., LocalStorage, SecureStorage)
├── utils/        # 无状态工具类 (e.g., Logger, Validator)
├── models/       # 全局共享数据模型 (e.g., PageModel, ActorBase)
├── constants/    # 全局常量 (e.g., StorageKeys, AppConstants)
├── abstractions/ # 共享抽象接口 (e.g., Cacheable, Syncable)
└── services/     # 底层内核服务 (e.g., NetworkDiscovery, MeshNetwork)
```

当你需要实现一个不与任何特定业务绑定的功能时（如日期格式化、发起一个HTTP请求），你应该首先检查 `core/` 目录中是否已有现成的实现。

## 5. `features/shared/` 业务共享层

当某个模型或服务在**多个业务模块**之间需要共享，但它又**带有业务属性**时，它应该被放在 `features/shared/` 目录下。

```
features/
└── shared/
    ├── models/     # 业务共享模型 (e.g., ChatMessage)
    ├── services/   # 业务共享服务 (e.g., UserStatusService)
    └── errors/     # 通用业务错误定义
```

**决策关键**: 判断一个东西应该放在 `core/` 还是 `features/shared/` 的标准是：**它是否与具体业务概念有关联**？

*   `PageModel` (分页模型) -> `core/models/` (无业务关联)
*   `ChatMessage` (聊天消息模型) -> `features/shared/models/` (与“聊天”这个具体业务关联)

## 6. 代码定位与生成规则

1.  **接到新功能需求时**: 首先确定它属于哪个业务模块。在 `features/` 下找到或创建对应的模块目录，然后在其内部的 `view/`, `controller/`, `model/` 中创建或修改文件。
2.  **需要通用工具时**: 首先去 `core/utils/` 或 `core/components/` 寻找。如果没有，再考虑创建新的通用工具。
3.  **修改代码时**: 严格遵守文件的命名规范（小写蛇形 `file_name.dart`）和类的命名规范（帕斯卡式 `ClassName`）。
4.  **添加依赖时**: 在对应模块的 `binding` 文件中添加。如果是全局依赖，则在 `app/bindings/initial_binding.dart` 中添加。

这份脚手架文件是你行动的指南。在对代码进行任何操作前，请先在此“地图”上找到你的位置。

## 7. 网络请求封装规范 (Network Request Encapsulation Standards)

为了保持代码的整洁和可维护性，我们采用分层的网络请求架构。

### 7.1 核心原则
1.  **禁止裸奔 HTTP**: 严禁在 `Controller` 或 `Service` 层直接实例化 `Dio` 或 `HttpClient` 发起请求。
2.  **统一基座**: 必须使用 `peers_touch_base` 提供的 `HttpService` 作为底层网络能力的唯一来源。
3.  **API 语义化**: 上层调用必须是语义化的 API 方法（如 `login()`, `fetchPosts()`），而不是 HTTP 动词（如 `post()`, `get()`）。

### 7.2 架构分层
1.  **底层 (Foundation)**: `peers_touch_base` 中的 `HttpService` (负责拦截器、超时、BaseUrl等)。
2.  **API 客户端 (ApiClient/Repository)**: 位于 `core/network` 或各模块的 `repository/`。它持有 `HttpService` 的实例，并将 HTTP 接口映射为强类型的 Dart 方法。
3.  **业务层 (Controller/Service)**: 注入 `ApiClient` 或 `Repository`，调用语义化方法。

### 7.3 实际调用场景示例

**错误的做法 (Forbidden):**
```dart
// Controller 中
void login() async {
  final dio = Dio(); // 禁止直接使用 Dio
  await dio.post('/login', data: {...});
}
```

**正确的做法 (Recommended):**

1.  **定义 API 接口 (core/network/api_client.dart 或 features/auth/repository/auth_repository.dart)**:
    ```dart
    import 'package:peers_touch_base/network/dio/http_service_locator.dart';

    class AuthRepository {
      // 获取统一封装的 HTTP 服务
      final _http = HttpServiceLocator().httpService;

      Future<User> login(String username, String password) async {
        // 使用封装好的 get/post 方法
        final response = await _http.post('/auth/login', data: {
          'username': username,
          'password': password,
        });
        return User.fromJson(response);
      }
    }
    ```

2.  **业务层调用 (Controller)**:
    ```dart
    class LoginController extends GetxController {
      final AuthRepository _repo = Get.find<AuthRepository>();

      void login() async {
        // 语义化调用，完全屏蔽 HTTP 细节
        final user = await _repo.login(username.value, password.value);
      }
    }
    ```
