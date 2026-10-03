# Social Private Moments - Experience Contract

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-24
> **Owner**: Social Product

---

## 1. Scope

本文定义私密 Moment 从发布、接收、直接链接读取、评论、媒体打开、设备恢复到删除的
用户 Journey。它不定义密码算法、API 形状、存储 schema 或实施顺序。

## 2. Actors And Context

| Actor | Context |
|---|---|
| Alice | 发布者，拥有一个已恢复的 Native 设备 |
| Bob | Alice 的已确认好友，有一个或多个受信 Native 设备 |
| Eve | 不是 Alice 的好友；可以关注 Alice，也可能知道 Post/Object ID |
| Anonymous | 不携带身份的 API 调用者 |
| Browser user | 已登录但当前运行时没有受支持的设备密钥能力 |

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
  成员或任一 active 成员属于远端 Station 时，在 Content PreKey claim 前整体
  显示不支持并保留草稿。
- audience 超过 256 actors 或 1000 endpoint/recovery slots：在加密前拒绝，不部分发布。
- 网络失败：保留草稿和 audience；不得把私密内容改成 PUBLIC 重试。
- Browser：在提交前显示“此设备不支持私密发布”，不得发送明文。

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
2. Anonymous、Desktop、Mobile 和 Browser 都可以读取。
3. UI 明确标记公开内容不受私密 E2EE 承诺保护。
4. 私密 hard cut 不改变公开 timeline、公开分享和未来 federation 的内容可读性。

## 4. Cross-Session And Platform Rules

- Private publish/read 的业务结果跨 Desktop Native 和 Mobile Native 一致。
- Browser 只支持 PUBLIC；私密入口在用户提交前拒绝。
- App restart 不改变 audience、内容身份或授权结果。
- Account switch 必须清空前一 actor 的解密投影和 key references。
- Cross-Station private recipient 在本次能力完成前为明确 unsupported，不允许部分发布；
  必须在 Content PreKey claim 前失败，并使用另一个真实 Station 上的 Actor
  身份证明，而不是场景内伪造 PTID。

## 5. Product Completion

本产品合同只有在 `SOC-SEC-J01` 至 `J09` 的 required runtime cells 均有
receiver-perspective evidence 时才可声明私密 Moment 安全完成。单元测试、数据库扫描、
API 测试、截图或“密文看起来不可读”不能单独替代 Native sender/receiver Journey。
