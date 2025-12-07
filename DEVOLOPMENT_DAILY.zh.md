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