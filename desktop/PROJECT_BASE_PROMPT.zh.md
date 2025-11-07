# Peers Touch Desktop

## PREFACE

我们项目是一个基于Flutter的跨平台应用程序，服务于Peers-Touch去中心化社交网络的桌面端业务，主要功能包括用户注册、登录、主界面展示、好友管理、消息通信、AI-Chat、小程序扩展等。

## 项目规模

不限，以家庭为单位，可以万家互联共享。

## 技术栈约束

* 框架：Flutter（最新稳定版）

* 状态管理与路由GetX（必须使用 GetX 的响应式状态、依赖注入、路由管理）

* 视图层：严格使用 StatelessWidget（禁止使用 StatefulWidget，所有状态由 GetX Controller 管理）

* 依赖：dio（网络）、get_storage（本地存储）、flutter_svg（图标）等（需说明）

* 核心目标：代码极简、架构整洁、模块独立可拆、易于维护与扩展（新增模块无需修改全局结构）

## 核心架构原则（必须遵守）

* 分层清晰，单向依赖

* 视图层（View）：仅负责 UI 渲染，通过Get.find<Controller>()获取状态，不处理业务逻辑。

* 控制层（Controller）：管理状态（Rx变量）、实现业务逻辑，依赖数据模型（Model）和服务（Service），不依赖视图。

* 数据层（Model）：定义数据结构（实体、DTO），可实现序列化 / 反序列化，无业务逻辑。

* 依赖方向：View → Controller → Model/Service（禁止反向依赖）。

* 模块内聚，低耦合：业务模块（features/下）需 “自包含”：同一业务的 View、Controller、Model 放在同一模块目录下，不依赖其他业务模块的内部文件。

* 跨模块复用需通过core/（全局通用）或features/shared/（业务级共享），禁止直接引用其他模块的 Controller/Model。

* 状态集中管理

所有可变状态（如接口数据、用户操作状态）必须放在 Controller 中，用 GetX 的Rx/RxBool/RxList等响应式变量声明。

视图通过Obx(() => ...)或GetBuilder监听状态变化，自身不保存任何状态。

* 依赖注入标准化：

全局服务（如 ApiClient、Storage）通过app/bindings/initial_binding.dart注册为单例。

业务模块的 Controller 通过模块内的xxx_binding.dart注册（使用Get.lazyPut，页面销毁时自动回收）。

禁止在代码中硬实例化 Controller/Service（如var controller = HomeController()），必须通过Get.find()获取。

## 项目目录架构

我们的应用程序遵循下面的目录结构规范

```
lib/
├── app/                          # 应用级核心配置（全局唯一）
│   ├── i18n/                     # 多语言配置
│   │   ├── translation_service.dart  # GetX国际化服务（初始化、切换语言）
│   │   ├── en_us.dart               # 英文语言包（{ "login": "Login" }）
│   │   ├── zh_cn.dart               # 中文语言包（{ "login": "登录" }）
│   │   └── locale_keys.dart         # 语言键常量（static const login = 'login';）
│   │
│   ├── routes/                    # 路由管理
│   │   ├── app_routes.dart          # 路由名称常量（static const home = '/home';）
│   │   └── app_pages.dart           # 路由页面映射（GetPage列表：HomePage、ProfilePage）
│   │
│   ├── theme/                     # 主题与样式
│   │   ├── app_theme.dart           # 主题配置（light/dark模式，含颜色、字体）
│   │   └── app_styles.dart          # 全局样式常量（padding: 16, radius: 8）
│   │
│   ├── bindings/                  # 依赖注入绑定
│       └── initial_binding.dart     # 全局初始化绑定（注册ApiClient、Storage等）
│   └── initialization/            # 应用初始化
│       └── app_initializer.dart     # 应用初始化类（负责初始化所有全局服务）
│
├── core/                          # 全局通用能力（跨模块复用，无业务关联）
│   ├── components/                # 通用UI组件（纯展示，无业务逻辑）
│   │   ├── common_button.dart       # 通用按钮（支持类型、尺寸配置）
│   │   ├── common_input.dart        # 通用输入框（带校验、清除功能）
│   │   └── loading_dialog.dart      # 全局加载弹窗
│   │
│   ├── network/                   # 网络请求基础能力
│   │   ├── api_client.dart          # Dio封装（拦截器、基础配置）
│   │   ├── api_exception.dart       # 网络异常处理（超时、404等）
│   │   └── base_response.dart       # 通用响应模型（code、msg、data）
│   │
│   ├── storage/                   # 本地存储封装
│   │   ├── local_storage.dart       # GetStorage封装（get/set/remove）
│   │   └── secure_storage.dart      # 安全存储（加密保存token等）
│   │
│   ├── utils/                     # 纯工具类（无状态，无依赖）
│   │   ├── logger.dart              # 日志工具（debug/release区分）
│   │   ├── validator.dart           # 数据校验（手机号、邮箱正则）
│   │   └── date_utils.dart          # 日期格式化工具
│   │
│   ├── models/                    # 全局共享数据模型
│   │   ├── page_model.dart          # 通用分页模型（page、size、total）
│   │   └── actor_base.dart           # 全应用通用的用户基础信息（id、name、avatar）
│   │
│   ├── constants/                 # 全局常量
│   │   ├── storage_keys.dart        # 存储键常量（user_info、token_key）
│   │   ├── regex_constants.dart     # 正则常量（phoneRegex、emailRegex）
│   │   └── app_constants.dart       # 应用常量（appName、version）
│   │
│   ├── abstractions/              # 共享抽象接口（定义标准能力）
│   │   ├── cacheable.dart           # 可缓存接口（saveToCache()、loadFromCache()）
│   │   └── syncable.dart            # 可同步接口（syncWithServer()）
│   │
│   └── services/                  # 底层内核服务（无UI，核心能力）
│       ├── network_discovery/       # 网络发现服务（如libp2p节点发现）
│       │   ├── node_scanner.dart    # 节点扫描逻辑（搜索周边节点）
│       │   └── discovery_service.dart # 对外接口（startScan()、onNodeFound）
│       │
│       └── mesh_network/            # 并网服务（节点组网）
│           ├── mesh_manager.dart    # 组网管理（连接维护、拓扑更新）
│           └── mesh_client.dart     # 并网客户端（发送/接收数据）
│
├── features/                      # 业务模块（按功能内聚，独立可拆）
│   ├── shared/                    # 业务级共享（跨业务模块复用），带业务状态的，非 Core 功能的共享类型都放这里
│   │   ├── models/                  # 业务共享模型
│   │   │   └── chat_message.dart    # 聊天消息模型（在首页、聊天页都用）
│   │   └── services/                # 业务共享服务
│   │       └── user_status_service.dart # 用户在线状态服务（被多个模块依赖）
│   │   └── errors/                # 错误集
│   │       ├── common_error.dart  # 通用错误基类（code、msg）
│   │       └── user_error.dart    # 用户类错误
│   │
│   ├── home/                      # 首页模块
│   │   ├── controller/              # 模块控制器（业务逻辑+状态）
│   │   │   └── home_controller.dart # 首页数据加载、事件处理
│   │   ├── view/                    # 模块视图（纯StatelessWidget）
│   │   │   └── home_page.dart       # 首页UI（依赖home_controller状态）
│   │   ├── model/                   # 模块数据模型
│   │   │   └── home_feed.dart       # 首页信息流模型（仅首页用）
│   │   └── home_binding.dart        # 模块依赖绑定（注册home_controller）
│   │
│   └── profile/                   # 个人中心模块
│       ├── controller/
│       │   └── profile_controller.dart
│       ├── view/
│       │   └── profile_page.dart
│       ├── model/
│       │   └── user_detail.dart    # 个人详情模型（仅个人中心用）
│       └── profile_binding.dart
│
└── main.dart                      # 程序入口（初始化GetMaterialApp）
```

* 目录约束

禁止在app/中放业务逻辑，仅保留 “应用启动必需的配置”。

core/中的工具 / 组件必须 “无业务倾向”（如common_button.dart不能包含 “登录按钮” 的特定逻辑）。

features/下的模块目录名必须是业务语义（如chat/、settings/，而非module1/）。

* 代码规范（细节约束）
    * 命名规范：
        * 文件 / 目录：小写蛇形（home_page.dart、network_discovery/）。
        * 类名：帕斯卡命名（HomeController、CommonButton）。
        * 变量 / 方法：小驼峰（userName、fetchData()）。
        * 常量：全大写蛇形（MAX_PAGE_SIZE、STORAGE_KEY_USER）。
    * 视图层（View）约束：
        * 必须是StatelessWidget，build 方法仅返回 UI 结构，不包含setState或业务逻辑。
        * 状态获取：通过Get.find<HomeController>()获取控制器，用Obx(() => controller.count.value)监听状态。
        * 事件处理：视图中的按钮点击等事件，需调用控制器的方法（如onPressed: () => controller.login()），不直接处理。
    * 控制层（Controller）约束：
        * 必须继承GetxController，重写onInit（初始化）、onClose（资源释放）等生命周期方法。
        * 响应式状态必须用Rx系列（final count = 0.obs;），禁止用普通变量。
        * 业务逻辑（如接口请求、数据处理）必须放在控制器中，禁止在视图或模型中实现。
    * 模型层（Model）约束：
        * 用class定义数据结构，包含必要的字段和fromJson/toJson方法（序列化）。
        * 禁止包含业务逻辑（如 “计算价格” 应放在 Controller，而非 Model）。
    * 引用
        * import 禁止使用相对路径（如import '../models/chat_message.dart'），必须使用绝对路径（如import 'package:peers_touch/models/chat_message.dart'）。
    * 代码实体
        * 所有可穷举的类型，必须定义为enum（如消息类型、用户角色等）。
        * 所有代码注册的语言，都必须用英文
* 特殊模块处理规范
    * 多语言（i18n）：
        * 语言包必须放在app/i18n/，键值对需通过locale_keys.dart的常量引用（避免硬编码字符串）。
        * 切换语言通过translation_service.dart的方法实现，视图中用tr(LocaleKeys.login)获取翻译。
    * 共享类：
        * 全局共享（无业务关联）：放在core/models/、core/constants/等（如 “分页模型”）。
        * 业务共享（跨模块但有业务关联）：放在features/shared/（如 “聊天消息模型” 在多个模块使用）。
    * 内核服务（无 UI）：
        * 如网络发现、数据同步等底层能力，必须放在core/services/，封装为独立服务类（如NetworkDiscoveryService）。
        * 服务对外暴露简洁接口（start()、stop()、onNodeFound流），内部实现细节隐藏。
        * 业务模块通过Get.find<NetworkDiscoveryService>()调用，无需关心内部实现。

## 扩展性与可维护性要求

* 新增业务模块：只需在features/下新增模块目录（按view/controller/model/binding结构），在app_routes.dart和app_pages.dart中注册路由，无需修改其他模块。
* 配置变更：主题、语言、路由等全局配置变更，仅需修改app/下对应文件，不影响业务模块。
* 测试友好：
    * 控制器逻辑可独立测试（依赖通过Get.put注入，便于 Mock）。
    * 视图纯渲染，无需测试（或仅测试 UI 结构）。

## 其它Prompt

其它非Base级的Prompt在 './PROMPTs' 目录下