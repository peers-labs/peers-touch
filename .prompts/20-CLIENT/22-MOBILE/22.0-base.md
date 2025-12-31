# Peers Touch Mobile

## PREFACE

本项目是基于 Flutter 的移动端（iOS/Android）应用，服务于 Peers-Touch 去中心化社交网络的移动端业务。核心能力包括用户注册/登录、首页信息流、即时聊天、私密圈子、公开动态、AI-Chat、小程序扩展、社交关系与设置中心等。UI 整体遵循 LobeChat 风格，交互与动效适配移动端手势与屏幕密度。

## 技术栈约束

* 框架：Flutter（最新稳定版）
* 状态管理与路由：GetX（必须使用响应式状态、依赖注入、路由管理）
* 视图层：严格使用 StatelessWidget（禁止使用 StatefulWidget，所有状态由 GetX Controller 管理）
* 依赖：`dio`（网络）、`get_storage`（本地存储）、`flutter_svg`（图标）；可按需补充 `equatable`（模型等值对比）、`intl`（时间/数字格式）
* 核心目标：代码极简、架构整洁、模块内聚可拆、移动端高性能与流畅动效

## 核心架构原则（必须遵守）

* 分层清晰，单向依赖
* 视图层（View）：仅负责 UI 渲染，通过 `Get.find<Controller>()` 获取状态，不处理业务逻辑
* 控制层（Controller）：管理状态（Rx 变量）、实现业务逻辑，依赖数据模型（Model）和服务（Service），不依赖视图
* 数据层（Model）：定义数据结构（实体、DTO），实现序列化/反序列化，无业务逻辑
* 依赖方向：View → Controller → Model/Service（禁止反向依赖）
* 模块内聚、低耦合：业务模块需“自包含”，同一业务的 View/Controller/Model/Binding 同目录，禁止直接引用其他模块内部文件
* 跨模块复用通过 `core/`（全局通用）或 `features/shared/`（业务级共享），禁止直接引用其他模块的 Controller/Model
* 状态集中管理：所有可变状态必须在 Controller 中，以 Rx 系列声明；视图用 Obx/GetBuilder 监听，不保存任何自身状态
* 依赖注入标准化：
  * 全局服务通过 `app/bindings/initial_binding.dart` 注册为单例
  * 模块 Controller 通过模块内 `xxx_binding.dart` 注册（`Get.lazyPut`），页面销毁自动回收
  * 禁止在代码中硬实例化 Controller/Service，必须通过 `Get.find()` 获取

## 代码结构（使用 Desktop 的方式）

移动端代码结构统一采用桌面版规范（保持跨端一致性）：

```
lib/
├── app/                          # 应用级核心配置（全局唯一）
│   ├── i18n/                     # 多语言配置
│   │   ├── translation_service.dart
│   │   ├── en_us.dart
│   │   ├── zh_cn.dart
│   │   └── locale_keys.dart
│   ├── routes/                   # 路由管理
│   │   ├── app_routes.dart
│   │   └── app_pages.dart
│   ├── theme/                    # 主题与样式（移动端密度/字号适配）
│   │   ├── app_theme.dart
│   │   └── app_styles.dart
│   └── bindings/                 # 全局依赖注入
│       └── initial_binding.dart
│
├── core/                         # 全局通用能力（无业务倾向）
│   ├── components/               # 通用 UI 组件（纯展示）
│   ├── network/                  # 网络请求基础能力
│   ├── storage/                  # 本地/安全存储封装
│   ├── utils/                    # 纯工具类（无状态）
│   ├── models/                   # 全局共享数据模型
│   ├── constants/                # 全局常量
│   ├── abstractions/             # 抽象接口
│   └── services/                 # 底层内核服务（如网络发现/并网）
│
├── features/                     # 业务模块（按功能内聚，独立可拆）
│   ├── shared/                   # 业务级共享（跨模块复用）
│   ├── home/                     # 示例：首页模块（view/controller/model/binding）
│   ├── chat/
│   ├── circles/
│   ├── discover/
│   ├── ai_chat/
│   ├── settings/
│   └── profile/
│
└── main.dart                     # 程序入口（GetMaterialApp 初始化）
```

约束：
* 禁止在 `app/` 存放业务逻辑；`core/` 工具/组件不可包含业务倾向
* `features/` 目录名必须体现业务语义（如 `chat/`、`settings/`）
* import 禁止使用相对路径，统一使用包路径（如 `package:peers_touch_mobile/...`）

## 代码规范（细节约束）

* 命名规范：文件/目录小写蛇形；类名帕斯卡；变量/方法小驼峰；常量全大写蛇形
* 视图层约束：必须是 StatelessWidget；`build` 仅返回 UI 结构；事件处理调用 Controller 方法
* 控制层约束：继承 GetxController；生命周期 onInit/onClose；状态用 Rx 系列；业务逻辑放在 Controller
* 模型层约束：定义字段与 `fromJson/toJson`；不包含业务逻辑
* 枚举：所有可穷举类型必须定义为 `enum`
* 文案：所有代码注册语言统一为英文（UI 可多语言）

## 移动端交互补充（LobeChat 风格适配）

* 导航策略：
  * 一级导航使用底部 TabBar（Chat/ Circles/ Discover/ AI/ Me），高度 56–64dp
  * 二级导航使用顶部 SegmentedTabs 或页面内标签；支持左侧 Drawer（滑动呼出）在平板展示为侧栏
  * 三级信息辅助采用右侧 SlideOver（大屏）或 BottomSheet（手机），优先不遮挡内容
* 手势与返回：
  * 支持 iOS 边缘返回、Android 物理返回键；路由由 GetX 统一管理
  * 列表滑动与露出动作（滑动删除、置顶、收藏）遵循 Material 手势与 LobeChat 反馈风格
* 安全区与密度：
  * 全面屏与刘海屏使用 SafeArea；字号/间距按移动密度适配（SP/DP）
* 动效基准：
  * 页面切换 200–300ms、容器展开 180–240ms、悬浮反馈 120–180ms（曲线：fastOutSlowIn/easeInOut）

## 多语言（i18n）

* 语言包放在 `app/i18n/`，键值通过 `locale_keys.dart` 常量引用
* 切换语言通过 `translation_service.dart`；视图使用 `tr(LocaleKeys.xxx)`

## 扩展性与可维护性

* 新增业务模块：在 `features/` 下按 `view/controller/model/binding` 结构新增，并在 `app_pages.dart` 注册路由
* 全局配置变更：主题、语言、路由仅修改 `app/` 下对应文件
* 测试友好：控制器逻辑可独立测试（依赖通过 Get.put 注入，便于 Mock）；视图纯渲染

## 其它 Prompt

其它非 Base 级 Prompt 在 `./PROMPTs/` 目录下，涵盖全局描述、UI 骨架、组件、UI Kit 与主题、动效维度、视觉规范等。

## 迁移建议（从当前 mobile 结构到目标结构）

当前 `lib/` 目录存在 `pages/`、`controller/`、`components/`、`services/` 等散列结构，建议按如下映射迁移：

* `lib/pages/*` → `lib/features/<module>/view/*`
* `lib/controller/*` → `lib/features/<module>/controller/*`
* `lib/model/*` → 业务内模型：`lib/features/<module>/model/*`；全局共享模型：`lib/core/models/*`
* `lib/components/*` → 无业务倾向的组件：`lib/core/components/*`；带业务状态的共享组件：`lib/features/shared/components/*`
* `lib/services/*` 或 `lib/service/*` → 底层服务：`lib/core/services/*`；业务共享服务：`lib/features/shared/services/*`
* `lib/common/*` → 根据职责归入 `core/`（通用）或对应 `features/`
* `lib/utils/*` → `lib/core/utils/*`
* `lib/store/*` → 本地存储：`lib/core/storage/*`；状态型业务存储：`lib/features/shared/services/*`
* `lib/l10n/*` → `lib/app/i18n/*`
* `lib/proto/*` → 若为模型定义，归入 `core/models/`；若为网络/并网交互，归入 `core/services/`

迁移过程中保持模块内聚与绝对路径导入，逐步替换旧引用，确保编译与路由注册平滑过渡。