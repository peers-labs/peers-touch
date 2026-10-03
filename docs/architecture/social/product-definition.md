# Social Private Moments - Product Definition

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-10-03
> **Owner**: Social Product
> **Module**: `apps/station/app/subserver/social/`, `apps/desktop/`, `apps/mobile/`

---

## 1. Product Thesis

### Target users

- 在自己的 Station 上发布日常动态，并只分享给明确受众的个人、家庭和小团队用户。
- 需要与同一 Federation 内其他 Station 的好友安全分享私密动态的 Native Desktop 用户。
- 需要明确区分公开内容、关注者内容、好友内容和精确名单内容的发布者。

### Excluded users

- 需要 DRM、禁止截图或撤回接收者记忆的内容发行者。
- 需要服务端全文检索、服务端内容审核或广告分析私密正文的运营场景。
- 需要 Browser Social、跨 Federation 私密分享或本阶段 Mobile 私密 Social 的用户。

### User problem

当前 UI 把非公开 Moment 表达为私密受众，但实际存在以下差距：

- 私密正文和评论在 Station 数据库明文保存。
- 私密媒体虽然加密，但对象以 public visibility 保存。
- 合法接收者可能获得其他接收者和设备的 key-envelope 元数据。
- 单 Post 和评论 GET 没有可选身份解析，合法私密读者会被当作匿名用户。
- `FOLLOWERS` 允许任何关注者读取，不等于用户通常理解的“好友可见”。

### Product promise

> 用户选择非公开受众后，只有发布者和发布时被授权、且持有有效设备密钥的接收者
> 能读取内容；Station、OSS、未授权账号和匿名请求均不能获得私密明文。

第一可用结果是：Station A 的 Alice 发布一条“好友可见”的文本加图片 Moment，
Station B 的 Bob 作为已确认联邦好友，在自己的受信 Native Desktop 读取正文和图片；
Eve 即使知道 Post ID、对象 ID 和来源 Station，也无法读取正文、评论、媒体对象或
其他接收者信息。

长期价值是：同一套受众、密钥、恢复和失败语义覆盖 Post、Comment 和 Attachment，
Desktop 与 Mobile 不再分别维护一套“看起来私密”的实现。

## 2. Trust And Privacy Promises

1. `PUBLIC` 内容明确不是端到端加密内容，允许 Station 读取和公开分发。
2. 所有非 `PUBLIC` 内容的正文、结构化 payload、评论和媒体字节均为端到端加密。
3. Station 可以持有完成鉴权和投递所需的最小路由元数据，但不持有内容密钥或私密明文。
4. 普通接收者只能取得自己的设备 key envelope，不能从 Post API 枚举其他接收者。
5. 无身份、身份无效、受众不匹配和对象 grant 不匹配均 fail closed。
6. 已经看过或自行保存的内容无法被密码学撤回；产品不得承诺远程抹除接收者记忆。
7. 删除、拉黑和关系变化阻止后续获取、投递和新设备恢复，并触发受控本地缓存清理。
8. 密钥不可用、设备未恢复或平台不支持时显示明确状态，不降级为明文。
9. 源 Station 与接收 Station 只能处理密文、签名证明和最小路由元数据；跨站不会扩大
   任一 Station 的明文可见性。

## 3. Capability Profile

| ID | Capability | Class | User value | Readiness claim |
|---|---|---|---|---|
| `SOC-SEC-C01` | Explicit audience semantics | required | 发布前知道谁可以看 | `PUBLIC`、`FOLLOWERS`、`FRIENDS`、`CIRCLE`、`GROUP`、`SELF`、自定义名单语义互不混淆；v1 的 `CUSTOM_DENY` 只支持以 `FOLLOWERS` 为基础受众 |
| `SOC-SEC-C02` | Private content confidentiality | required | Station/OSS 泄漏不直接暴露私密内容 | 非公开正文、评论、结构化 payload 和媒体只以 ciphertext 离开设备 |
| `SOC-SEC-C03` | Object-level authorization | required | 猜到 ID 也不能越权读取 | Post、Comment、媒体对象和 key envelope 都绑定当前 actor/device |
| `SOC-SEC-C04` | Trusted-device read and recovery | required | 换设备或重启后结果可解释、可恢复 | 受信设备通过现有恢复短语恢复从未打开过的授权历史；缺密钥时明确失败 |
| `SOC-SEC-C05` | Metadata minimization | required | 接收者名单和设备信息不被旁路泄漏 | 普通读取响应只包含当前设备所需 envelope 和必要 audience 摘要 |
| `SOC-SEC-C06` | Honest deletion and relationship changes | required | 用户理解阻断的真实边界 | 后续访问被拒绝；不承诺删除已被接收者保存的副本 |
| `SOC-SEC-C07` | Public Moment continuity | required | 安全升级不破坏公开社交 | 公开发布、公开读取和未来联邦路径保持可用 |
| `SOC-SEC-C08` | Native private experience | required | 原生客户端具备完整私密能力 | Native Desktop 是当前 readiness cell；Mobile 延后独立实现与验收；Browser 不提供 Social 产品面 |
| `SOC-SEC-C09` | Cross-Station private sharing | required | 联邦好友可私密分享 | 同一 active Federation 内的远端受众可接收、读取、互动、恢复并响应撤销；源/接收 Station 都不得获得明文 |

## 4. Audience Product Semantics

| Audience | Product meaning | Non-friend access |
|---|---|---|
| `PUBLIC` | 任何人可见 | allowed |
| `FOLLOWERS` | 任何当前关注作者、且未被拉黑的账号可见 | allowed after following; UI 必须明确这一点 |
| `FRIENDS` | 已完成双向 Friend Request 的好友可见 | denied |
| `CIRCLE` | 发布者私有名单中的成员可见 | only listed members |
| `GROUP` | 发布时属于目标 Conversation Group 的成员可见；目标使用完整 canonical Conversation ID，成员可以跨 Station | only eligible active group members |
| `SELF` | 仅发布者自己的受信设备可见 | denied |
| `CUSTOM_ALLOW` | 仅显式选择的账号可见 | only allow list |
| `CUSTOM_DENY` | v1 仅支持 `FOLLOWERS` 减去显式排除账号 | denied when listed; `PUBLIC` base unsupported |

`FOLLOWERS` 不得在 UI 中翻译或呈现为“好友”。`FRIENDS` 是本次产品合同新增的
required audience。Audience 创建后不可扩大；缩小受众通过删除并重新发布，或未来
另行设计可验证的 key rotation，不在本次隐式实现。

私密发布是有界能力：初始协议最多接受 256 个 recipient actors、合计 1000 个
endpoint/recovery slots。超过限制时在加密前返回 `AUDIENCE_TOO_LARGE`，不得部分发布。

`CUSTOM_DENY(PUBLIC)` 需要一个可枚举、带版本且覆盖联邦 Actor 的 PUBLIC recipient
authority，当前产品没有该能力，因此 v1 在提交前返回 `PRIVATE_UNSUPPORTED`。
`GROUP` 保留为 required audience，并接受 Conversation 权威快照中属于同一 active
Federation 的远端成员。FRIENDS、FOLLOWERS、CIRCLE、GROUP 与 CUSTOM 产生的每个
远端 Actor 都必须具备可验证的 Home Station、endpoint manifest 和一次性 Content
PreKey。任一 required recipient 不可验证时整体发布失败，不得静默缩小受众或部分提交。
跨 Federation recipient 仍在 Content PreKey claim 前返回 `PRIVATE_UNSUPPORTED`。

## 5. Platform Matrix

| Capability | Desktop Native | Mobile Native | Browser | Degradation |
|---|---|---|---|---|
| Public publish/read | required | deferred | prohibited | Browser 不注册 Social 页面、runtime 或写入口；公开 HTTP/Federation API 不等于 Browser 产品支持 |
| Private publish/read | required | deferred | prohibited | 不提供 Browser Social 降级或入口 |
| Private attachment open | required | deferred | prohibited | 不提供公开 ciphertext URL 作为替代 |
| Trusted-device recovery | required | deferred | prohibited | Mobile 由后续计划实现；Browser 无 Social 恢复入口 |
| Cross-Station private sharing | required | deferred | prohibited | 当前只声明 Desktop Native 双 Station 闭环 |

## 6. Feasibility Closure

| Capability | Existing foundation | Missing closure | Smallest executable proof |
|---|---|---|---|
| `C01` | Audience proto、`CanRead`、Friend Request truth、Conversation canonical group identity | typed CIRCLE/GROUP target、Conversation-owned same-Station membership snapshot、`CUSTOM_DENY(FOLLOWERS)` 和准确 UI copy | Alice/Bob 成为好友，Eve 仅 follow；同一 Post 只对 Alice/Bob 可见；Group 成员可读，远端成员与 `CUSTOM_DENY(PUBLIC)` 在提交前整体拒绝 |
| `C02` | Messaging Core AES-GCM attachment crypto、Key Exchange、客户端 SQLCipher | 私密 Post/Comment payload 加密与共享 content-key contract | Station 数据库和日志只出现 ciphertext，Bob Native 显示精确明文 |
| `C03` | JWT、`CanRead`、private repo 二次校验 | Optional auth、媒体 grant、viewer-scoped envelope | 匿名/过期 token/Eve 对同一资源均被拒绝，Bob 成功 |
| `C04` | 设备身份、Key Exchange、Recovery 基础 | 独立的一次性 endpoint/recovery Content PreKey 与历史 recovery-envelope 查询 | Bob 重启成功；Bob2 用恢复短语读取从未打开过的授权历史 |
| `C05` | Audience grants 和 per-device envelopes | 响应裁剪和作者管理视图分离 | Bob 响应中不存在 Eve/其他设备 envelope |
| `C06` | 删除、Block、delivery revoke | ciphertext/grant/cache 清理语义 | Alice 删除或拉黑后，新请求和新设备恢复失败，既有已读副本不做虚假撤回声明 |
| `C07` | public table、public timeline | 与私密 hard cut 的回归隔离 | 匿名用户仍能读取 public Moment |
| `C08` | Desktop Native crypto/runtime 已完成；Mobile 有共享内核基础 | 删除 Browser Social 产品面；Mobile 后续独立接入 | Desktop Native 完成同站与跨站 Journey，Browser 路由/入口扫描为零 |
| `C09` | Federation durable delivery、peer routes、Actor endpoint manifest、跨站 Friend Request/relationship、Social private envelopes | 远端 Content PreKey claim、recipient-scoped private projection、对象代理读取、互动命令、撤销事件与 Desktop 状态 | 两个真实 Station 上 Alice 发布，Bob 收到并解密；Bob 评论/reaction；重启/断网/删除/block 后双方收敛 |

## 7. Non-Goals

- 不承诺防截图、防拍照、防接收者复制。
- 不在 Station 上建立私密正文全文检索、内容推荐或内容审核。
- 不用数据库磁盘加密替代端到端加密；磁盘加密只属于纵深防御。
- 不把 Chat 的 Conversation 权限模型复制为 Social 权限模型。
- 不在本次实现 Mobile Social；Mobile 由后续独立产品、运行时与验收计划负责。
- 不提供 Browser Social 页面、runtime、发布或读取入口。
- 不支持跨 Federation 私密分享、`CUSTOM_DENY(PUBLIC)`、历史 audience 扩大，
  或无用户参与的任意新设备解密。
- 不保留旧明文私密写路径、双写、永久 fallback 或 signaling 专用密钥协议。

## 8. Prototype Decision

本次不要求新增可执行原型。现有 Social Composer、Audience selector、detail 和错误态
布局由 Social UI Identity 约束；新增产品状态是局部 trust/error/recovery 状态，
不改变页面信息架构。若实现阶段需要重做 Audience selector 或设备恢复流程，则必须
返回 PRODUCT 并触发 `pt-prototype-design`。

## 9. Accepted Product Decisions

1. 接受新增 `FRIENDS`，并保持 `FOLLOWERS` 的真实开放关注语义。
2. 接受所有非公开 Post/Comment/Attachment 均为 E2EE，不只加密图片。
3. 接受 Browser Social 产品面整体禁止；公开 HTTP/Federation API 保持存在，但不注册
   Browser Social 页面、runtime、发布或读取入口。
4. 接受同一 active Federation 内的 Desktop Native 跨 Station 私密分享成为 required。
5. 接受开发期旧私密明文不做服务端“伪迁移”；DESIGN 选择经再次授权后的精确范围 reset。
6. 接受私密 audience 的初始 256 actor / 1000 slot 硬上限和显式失败。
7. v1 的 `CUSTOM_DENY` 仅接受 `FOLLOWERS` 基础受众；`PUBLIC` 基础受众在具备完整、
   可版本化的联邦 PUBLIC recipient authority 前保持 unsupported。
8. `GROUP` 使用 canonical string Conversation ID。跨站 Group 必须绑定 Conversation
   authority snapshot、成员 Home Station 和 Federation scope；不可验证时整体拒绝。
9. 作者 Home Station 保持 Post/Comment/Reaction 的业务 authority；接收 Station 只
   保存 viewer-scoped 密文投影和投递状态。
10. 跨站 transport 复用共享 Federation delivery/outbox/inbox 和 peer route，不新增
    Social 专用网络栈，也不把社交数据写入 Federation Ledger。
11. Mobile Native 在本轮明确 deferred，不能用生成代码或共享 Rust 内核冒充产品可用。
