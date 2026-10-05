# Social Private Moments - Experience Contract

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-10-03
> **Owner**: Social Product

---

## 1. Scope

本文定义私密 Moment 从发布、接收、直接链接读取、评论、媒体打开、设备恢复到删除的
用户 Journey。它不定义密码算法、API 形状、存储 schema 或实施顺序。

## 2. Actors And Context

| Actor | Context |
|---|---|
| Alice | Station A 上的发布者，拥有一个已恢复的 Native Desktop |
| Bob | Station B 上 Alice 的已确认联邦好友，有一个或多个受信 Native Desktop |
| Eve | 不是 Alice 的好友；可以关注 Alice，也可能知道 Post/Object ID |
| Anonymous | 不携带身份的 API 调用者 |
| Browser user | 不进入 Social 产品面；Browser 不注册 Social 页面或 runtime |

## 3. Journeys

### `SOC-SEC-J01`: Publish a private Moment

**Capabilities**: `C01`, `C02`, `C04`, `C08`

1. Alice 打开 New Post，输入文本并可添加图片、视频或位置。
2. Alice 必须明确选择 audience；“好友”与“关注者”是两个不同选项。
3. 系统检查当前平台、接收者和设备密钥是否满足私密发布条件。
4. 检查期间只禁用发布动作，草稿和 audience 选择保持可编辑。
5. 条件满足后 Alice 发布，界面显示发布中。
6. 成功后 Alice 立即看到完整 Moment，并能从自己的相册再次打开。
7. Station 持久化读回只能证明 ciphertext 和授权元数据存在，不能出现私密明文。

Failure and recovery:

- 某个 required recipient 没有可用 endpoint 或 recovery Content PreKey：
  不发布、不缩小受众，显示不可用接收者数量，
  Alice 可取消、移除该接收者或稍后重试。
- `CUSTOM_DENY` 选择 `PUBLIC` 作为基础受众：v1 在 Content PreKey claim 前
  显示不支持并保留草稿，不得枚举一个不完整的本地“公开受众”后发布。
- `GROUP` 使用完整 canonical Conversation ID；Group 不存在、发布者不是 active
  成员、成员不属于同一 active Federation，或任一 required recipient 的远端身份/
  PreKey 不可验证时，整体失败并保留草稿。
- audience 超过 256 actors 或 1000 endpoint/recovery slots：在加密前拒绝，不部分发布。
- 网络失败：保留草稿和 audience；不得把私密内容改成 PUBLIC 重试。
- Browser：Social 页面和发布入口不存在；不得通过 Web fallback 发送任何 Social 内容。

### `SOC-SEC-J02`: Authorized recipient reads a private Moment

**Capabilities**: `C02`, `C03`, `C04`, `C05`

1. Bob 从 HOME feed、通知或直接链接打开 Alice 的私密 Moment。
2. 系统验证 Bob 当前 actor 和 device 的访问资格。
3. Bob 看到正文、媒体、允许显示的评论和 audience 摘要。
4. Bob 的响应中只包含当前 actor/device 所需的解密材料。
5. Bob 刷新、重启应用后仍能读取同一内容，且不依赖 Alice 在线。

Failure and recovery:

- envelope 暂未到达：显示“正在准备私密内容”，允许有界重试。
- key 不存在或恢复未完成：显示“需要恢复此设备”，不显示乱码或空白正文。
- ciphertext 被篡改：显示完整性错误，不返回部分明文。
- token 过期：显示重新登录入口；不得静默按匿名身份重试。

### `SOC-SEC-J03`: Unauthorized direct access is denied

**Capabilities**: `C03`, `C05`

1. Eve 或 Anonymous 获得一个真实 private Post ID、Comment ID 或 Object ID。
2. 调用 feed、单 Post、评论、媒体和 envelope API。
3. 所有资源读取均拒绝，不返回正文、评论、媒体字节、recipient PTID、device ID 或
   encrypted key。
4. 对私密 Post 使用统一 not-found wire behavior，避免证明对象存在。
5. 无效或过期 token 返回 typed authentication failure，不能降级成匿名 public read。

Control:

- 对 `PUBLIC` Post 的匿名读取仍然成功。

### `SOC-SEC-J04`: Followers and friends remain distinct

**Capabilities**: `C01`, `C03`

1. Eve 关注 Alice，但没有完成 Friend Request。
2. Alice 发布一条 `FOLLOWERS` Moment：Eve 可以读取，UI 明确说明“关注者可见”。
3. Alice 发布一条 `FRIENDS` Moment：Eve 不可读取。
4. Bob 与 Alice 已确认好友：Bob 可以读取 `FRIENDS` Moment。
5. 任一方向 Block 后，Bob/Eve 均不能通过既有关系绕过 Block。

### `SOC-SEC-J05`: Comment on private content

**Capabilities**: `C02`, `C03`, `C05`

1. Bob 打开可读的 private Moment 并提交评论。
2. 发布中的状态属于评论输入区，失败时保留原文。
3. Alice 和符合互动可见性规则的接收者看到评论明文。
4. Station、OSS 和无权读取父 Post 的用户不能读取评论明文。
5. Post 被删除或 Bob 权限失效后，新的评论写入和读取均被拒绝。

### `SOC-SEC-J06`: Open a private attachment

**Capabilities**: `C02`, `C03`, `C04`

1. Bob 点击 private Moment 的媒体。
2. 系统取得仅绑定 Bob 当前 actor/device 和目标 object 的有界访问能力。
3. 客户端验证 ciphertext 完整性并在本地解密。
4. 媒体正常展示，Station/OSS 不出现明文字节。

Failure and recovery:

- Eve、Anonymous、错误 object binding 或过期能力均不能取得对象字节。
- 下载中断可重试，但不能复用到另一个 object 或 actor。
- 解密失败不回退到未加密 URL。

### `SOC-SEC-J07`: New device and recovery

**Capabilities**: `C04`, `C06`, `C08`

1. Bob 在新 Native 设备登录。
2. 未完成可信恢复前，历史 private Moment 显示“需要恢复”，不显示永久空白。
3. Bob 使用现有 24-word recovery phrase 完成可信恢复。
4. 设备通过 actor recovery envelope 获得有权恢复的历史内容，包括旧设备从未打开过的
   Moment；未授权历史内容仍不可见。
5. 被撤销设备不能取得新内容或新的恢复材料。

### `SOC-SEC-J08`: Delete, block, and audience loss

**Capabilities**: `C03`, `C06`

1. Alice 删除 private Moment，或 Alice/Bob 关系变为 blocked。
2. 后续 feed、detail、comment、media 和 recovery 请求均被拒绝。
3. 在线客户端收到删除/失效状态并清理普通本地 cache。
4. 产品明确说明：已经查看、导出、截图或由恶意客户端保存的副本无法远程收回。
5. 不通过假成功文案承诺接收者历史副本已被删除。

### `SOC-SEC-J09`: Public content remains public

**Capabilities**: `C07`

1. Alice 明确选择 `PUBLIC` 并发布。
2. Anonymous 可通过公开 HTTP 接口读取；Desktop Native 可以在产品内读取。
   Mobile 产品支持延后，Browser 不提供 Social 产品面。
3. UI 明确标记公开内容不受私密 E2EE 承诺保护。
4. 私密 hard cut 不改变公开 timeline、公开分享和未来 federation 的内容可读性。

### `SOC-SEC-J10`: Cross-Station private publish and read

**Capabilities**: `C01`, `C02`, `C03`, `C04`, `C05`, `C09`

1. Alice 和 Bob 的 Home Station 均属于同一 active Federation，且双方 Friend
   Request 已在两个 Home Station 收敛为 accepted。
2. Alice 在 Native Desktop 选择包含 Bob 的 `FRIENDS`、`FOLLOWERS`、`CIRCLE`、
   `GROUP` 或 `CUSTOM_ALLOW` audience。
3. Alice 的 Home Station 解析 Bob 的 Home Station 和签名 endpoint manifest，并从
   Bob Home Station 获取一次性 endpoint/recovery Content PreKey。
4. Alice 设备只在本地加密。提交成功后，源 Station 在同一事务中提交 canonical
   resource 和面向 Bob 的 Federation outbox。
5. Bob Home Station 验证源 Station、commit proof、目标 actor 和 payload hash，
   只落地 Bob 可见的密文投影与 envelope。
6. Bob 的 Native Desktop 从自己的 Home Station 收到投影，在本地验证和解密正文、
   图片或视频；Bob 不需要直连 Alice Station，Alice 也不需要在线。

Failure and recovery:

- 任一远端身份、endpoint manifest、PreKey 或 Federation membership 不可验证：
  整体发布失败，保留草稿，不提交部分 Post。
- 源 Station 已提交但远端 Station 暂时不可达：Alice 看到明确的跨站投递待确认状态；
  durable outbox 以相同 idempotency key 重试，不创建第二条 Moment。
- Bob Station 收到重复 frame：返回 duplicate 并保持一份投影。
- payload hash、Station signature、target actor 或 target Station 不匹配：
  终止拒绝且不写入私密投影。

### `SOC-SEC-J11`: Cross-Station private interaction

**Capabilities**: `C02`, `C03`, `C05`, `C06`, `C09`

1. Bob 在 Station B 打开 Alice 的跨站私密 Moment。
2. Bob 提交私密评论或 Reaction；Bob Home Station 持久化签名命令并通过共享
   Federation transport 送达 Alice Home Station。
3. Alice Home Station 重新验证父资源授权并提交 canonical interaction truth。
4. 结果和 viewer-scoped 更新返回双方 Home Station；Alice 与 Bob 的 Native Desktop
   在重连或 reconcile 后看到同一结果。
5. Alice 删除 Moment，或任一方向 Block / 关系失效后，源 Station 发出有序失效事件；
   Bob Station 立即停止新读取/互动/恢复并清理普通投影缓存。

Failure and recovery:

- 远端提交未知结果时保留评论草稿或 Reaction pending 状态，并按 command ID 查询/
  重试，不创建重复互动。
- 接收 Station 可先基于本地 Block truth 隐藏内容，但最终授权和删除事实仍由源
  Station 收敛；不得用 UI 隐藏代替源 authority 撤销。
- 已被正常或恶意客户端保存的明文仍不可远程抹除。

### `SOC-SEC-J12`: Cross-Station restart and recovery

**Capabilities**: `C04`, `C06`, `C09`

1. Bob 从未在旧设备打开目标 Moment。
2. Bob Station 或 Bob Desktop 重启后，投递 projection 从 durable inbox 恢复。
3. Bob2 在 Station B 登录，完成受信恢复后取得 actor recovery envelope。
4. Bob2 验证 Alice Station 的历史 content proof 并读取准确明文。
5. 被撤销设备、过期 Federation membership 或已失效 audience 均无法取得新材料。

## 4. Cross-Session And Platform Rules

- 当前 readiness 只覆盖 Desktop Native；Mobile Native 由后续独立计划补齐。
- Browser 不注册 Social 页面、runtime 或动作；公开 HTTP/Federation 接口不是 Browser 产品面。
- App restart 不改变 audience、内容身份或授权结果。
- Account switch 必须清空前一 actor 的解密投影和 key references。
- Cross-Station private recipient 只在双方 Home Station 属于同一 active Federation、
  身份/设备/PreKey 可验证时支持；跨 Federation 或不可验证 recipient 必须整体失败。

## 5. Product Completion

本产品合同只有在 `SOC-SEC-J01` 至 `J12` 的当前 Desktop required runtime cells 均有
receiver-perspective evidence 时才可声明私密 Moment 安全完成。单元测试、数据库扫描、
API 测试、截图或“密文看起来不可读”不能单独替代 Native sender/receiver Journey。
Mobile readiness 由后续计划独立声明；Browser Social 不属于可降级能力。
