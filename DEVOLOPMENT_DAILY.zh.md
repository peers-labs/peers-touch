# 开发日报

用于记录开发过程，每日上下文衔接

## 20251204

### Station 

```
今天的工作非常高效，我们完成了**统一身份系统（Unified Identity System）**的核心构建，并将其成功集成到了现有的业务逻辑中，同时为未来的 ActivityPub 联邦协议支持打下了坚实的基础。

以下是今天工作的详细总结：

### 1. 核心架构构建 (Core Architecture)
我们从零开始构建了基于 PTID (Peers Touch Identity) 标准的身份系统核心：

- PTID 标准实现 ：在 frame/core/identity/ptid 中实现了标准的 PTID 格式解析与生成逻辑（ ptid:v1:actor:<namespace>:<type>:<username>:<fingerprint> ）。
- 核心接口定义 ：
  - IdentityService ：定义了身份创建、查询、绑定的标准接口。
  - Resolver & Adapter ：定义了多协议身份解析器和适配器接口，支持扩展。
  - Crypto ：实现了基于 Ed25519 的密钥生成和 Multihash 指纹计算。
- 依赖注入设计 ：重构了 Resolver ，使其依赖于抽象的 Store 接口，而不是具体的数据库实现，实现了核心逻辑与存储的解耦。
### 2. 插件化与原生实现 (Native Implementation)
遵循你的架构建议，我们将具体的实现落地到了 Native Plugin 层：

- 原生实现落地 ：在 frame/core/plugin/native/identity 中实现了具体的 Service 和 Store （基于 GORM）。
- Provider 目录重构 ：建立了统一的 provider 目录结构：
  - provider/libp2p ：存放 Libp2p 适配器。
  - provider/activitypub ：将 ActivityPub 适配器从业务层移动到了这里，保持了架构的一致性。
- 服务注册 ：在 native 包中完成了服务的初始化和注入，确保应用启动时身份服务可用。
### 3. 业务集成与模型升级 (Business Integration)
我们将新的身份系统与现有的用户注册流程进行了深度融合，并升级了数据模型：

- 注册流程集成 ：修改了 frame/touch/actor/actor.go 中的 SignUp 逻辑。
  - 弃用 了临时的 ID 生成函数。
  - 接入 了 IdentityService ，在用户注册时自动生成密钥对和标准的 PTID。
  - 映射 ：将生成的 PTID 直接存储到 PeersActorID 字段，实现了统一身份的落地。
- 数据库模型升级 ：为了支持 ActivityPub 协议，我们对 touch_actor 表进行了关键升级：
  - 新增 ActivityPub 字段 ： DisplayName , Type (Person/Service...), Summary , Icon , Image 。
  - 引入 Namespace ：支持多命名空间（默认为 peers ），配合 Name 字段实现唯一性。
  - 语义明确化 ：明确了 Name 为 PreferredUsername (Handle)， PeersActorID 为 Global ID 。
### 4. 成果与展望
- 当前状态 ：系统现在拥有了一个符合设计文档的、基于密码学的统一身份层。新注册的用户将自动获得一个全球唯一的 PTID，并且数据库结构已经准备好支持 ActivityPub 的联邦交互。
- 下一步建议 ：
  - 完善 ActivityPub 的 Handler，使其能够读取新的 touch_actor 字段并生成标准的 ActivityPub JSON 响应。
  - 实现 provider/activitypub 的具体解析逻辑，允许通过 WebFinger 发现远程用户。
今天的代码变更已经全部编译通过并保存。架构清晰，扩展性强，非常棒的进展！
```

### Client

```
- 右侧面板优化 ：实现了点击非面板区域自动折叠功能，增强了交互体验。
- Tab 组件开发 ：在 peers_touch_ui 中创建了通用的 IconTabs 组件，支持高度自定义样式。
- UI 样式调整 ：根据参考设计优化了 Tab 栏样式，实现了浅蓝背景与线框选中态的结合，并修复了滚动条冲突问题。
```


### PeersTouch

```
完成 ActivityPub 模块重构与核心实现：

1. 模型优化 ：弃用重型 ActivityPubActor ，采用轻量级 Actor + ActivityPubKey 结构。
2. 功能落地 ：实现 Inbox/Outbox 完整流程及简化版客户端 API（关注/点赞/撤销）。
3. 编译修复 ：修正所有库调用与类型错误，项目已通过编译验证。

- Discovery 核心模块开发 ：实现了基于 ActivityPub 协议（Create, Like, Follow 等）的内容流展示与模拟数据逻辑；构建了包含侧边栏（好友/群组）与主列表的完整页面布局。
- UI 组件与视觉定制 ：在 peers_touch_ui 库中封装了通用 IconTabs 组件，并深度定制了 Discovery 页面的 Tab 样式，实现了“浅蓝背景+线框选中”的精致视觉效果。
- 全局交互优化 ：实现了右侧面板“点击外部自动收起”的全局逻辑，并解决了 Discovery 页面多滚动视图的冲突问题，保证了流畅的用户体验。

```


### 明天

要着重处理identity部分的功能，这是根本，关系整个应用账号体系的串联，identity 还没有完成

## 20251205

### Station

```
调整了 Actor 目录与响应，使之符合 activitypub 出入参标准，但是未验证。Identity ID 也未验证，需要继续。
```

### Desktop 

多语言调整到base仓，把proto也调整了下。
 
### 明天

1. 验证 activitypub 是否能用。制作个人 Profile 页，要有 ActivityPub 风格。

2. 尝试 接入Mastodon 的可行性。

## 20251210

尝试接入Mastodon 联邦，但是没这么简单，现在只是实现了部分接口，且难以验证是否工作，持续跟进。

前端方面，可以先关注peers touch网络的功能建设，比如发帖等

把功能都做差不多了，再回头尝试 Mastodon 的联邦功能

## 20251211

### Client 

今天主要完成了以下工作：

1. 核心修复 ：彻底解决了键盘输入卡顿及无法删除的 Bug（迁移 Focus API + 网络请求防抖）。
2. UI 重构 ：全面优化登录页，移除冗余文本，集成 peers_touch_ui 组件，新增多语言切换并封装为通用组件。
3. 数据修正 ：修复了 API Host 缺失及“Alice”幽灵数据问题，确保使用真实用户信息。
4. 架构升级 ：设计并启动了 ActorSession 用户态管理模块（Proto 定义 + 安全存储），为标准化会话管理与 Token 自主刷新打下基础。

### Station

今天主要完成了架构规范化与 Profile 功能完善：

1. 架构重构 ：确立并执行“Handler 无 DB 操作”原则，重构 ActivityPub 模块，将数据库逻辑全部下沉至 Service 层，同时修复了非标准端口下的 URL 生成问题。
2. Profile 功能 ：对齐前后端字段，扩展模型支持地区、标签等扩展信息，实现了完整的查询与修改接口，并确立了数据正确持久化到 actors 和 actor_profiles 双表的逻辑

### 明天

持续完成 Profile 功能的完善，包括前端页面的调整与后端接口的实现。

## 20251212

今天处理 Dart 应用上下文，这个很重要，任何模块都重度依赖上下文提供的运行时、用户信息。但是没有完成，是个重设计和落地的活

明天会继续。

前端方面，对 Posting 的 UI 进行了部分处理。及代码风格重构。但是现在 Posting 打开有overflow的问题

### 明天 

继续调整 GlobalContext 和 实现 Posting 功能

## 20251216


### Station

```
- 完成 auth 模块抽象性评审与落地方案：
  1) 框架增强：server.Handler 增加 Hertz 中间件支持；Hertz 插件组合执行中间件；http.Handler 路径应用 wrappers。
  2) 认证内核：新增 auth.Config 配置入口（支持环境变量 PEERS_AUTH_SECRET），提供 DefaultMiddleware；去除硬编码。
  3) 路由接入：在 Mastodon 路由为需鉴权的接口注入 RequireJWT（verify_credentials、发帖、收藏/取消收藏、转发/取消转发、home 时间线）。
- 整体效果：实现“常见 auth 内核 + handler 级植入”能力，统一鉴权入口，保持业务 handler 无侵入。
- 编译与验证：框架层改动已通过静态检查；全仓构建需补充 protobuf 依赖后再验证。
- 后续建议：迁移 ActivityPub/管理路由到中间件；替换 SessionStore 为 Redis；接入 OAuth2 Provider；清理历史硬编码与散落校验逻辑。
```

## 20251222

1. 发帖功能还是无法正常展示图片与评论，且发贴数据在数据库中冗余数据体量太大，需要重新设计。且现在的数据结构无法支持多种交互，如评论，转发。
2. 开始设计个人页，在 station\frame\docs\actor_description.zh.md 里

## 20251223

个人页还是不完善，登录态也有交叉的现象，没有把个人页、登录等基本功能搞完，其它的不能进行

## 20251224

1. 完善了 Applet 容器与市场的设计与实现，为 Peers Touch 生态扩展奠定了基础。
2. 解决了跨平台 Proto 生成与 WebF 依赖冲突的工程化难题。
3. 详细设计文档已归档至：`station/frame/docs/applet/architecture.md`。

**Applet 核心进展:**
- **架构落地**: 完成了 Station (Store) -> Client Base (Bridge/Manager) -> Desktop UI (Launcher/Market) 的全链路 MVP。
- **技术选型**: 确认使用 WebF (0.16.x) 作为容器，通过 MethodChannel 实现 JS <-> Flutter 通信。
- **UI 实现**: 
    - 实现了 Applet 市场页面。
    - 在左侧导航栏新增了 Pinned Applets Dock，支持呼吸动画与拖拽排序。
- **工程优化**: 锁定了 `protoc_plugin` 版本，解决了 Windows/Mac 生成代码不一致问题；解决了 `intl` 库版本冲突。

**遗留与下一步:**
- 恢复 Bridge 回调（因 evaluateJavascript API 变动暂时注释）。
- 对接真实 Station 接口（目前为 Mock 数据）。

## 20251226

小程序换成了webview的方案，上传下载还在搞，前端能加载了，但是日志少，失败不明

个人页修改信息基本功能可以了，还没有完全测试，还有可能的 bug 会暴露出来，需要继续跟进


