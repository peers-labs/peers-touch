# Social Private Moments - Product State Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Social Product

---

## 1. Scope

这些状态描述用户可以观察到的含义。它们不是 React boolean、数据库状态或密码学
实现名。平台可以采用不同控件，但必须保留相同语义、动作和恢复路径。

## 2. Publish States

| State | User-visible meaning | Allowed actions | Forbidden behavior | Transition |
|---|---|---|---|---|
| `AUDIENCE_REQUIRED` | 尚未选择谁可以看 | 选择 audience、继续编辑、取消 | 默认成 PUBLIC 后提交 | audience selected |
| `CHECKING_PRIVATE_READINESS` | 正在确认当前设备和接收者可安全接收 | 继续编辑、取消 | 提交、缩小受众后静默继续 | all recipients ready / failure |
| `READY_PUBLIC` | 内容将公开发布且不受私密 E2EE 承诺保护 | 发布、改 audience、取消 | 隐藏公开含义 | explicit publish |
| `READY_PRIVATE` | 所选 audience 和设备均可安全发布 | 发布、改 audience、取消 | 将 key 放进普通响应 | explicit publish |
| `PRIVATE_UNSUPPORTED` | 当前平台或远端受众不支持私密发布 | 改为受支持 audience、换 Native 设备、取消 | 明文降级、自动改 PUBLIC | user correction |
| `RECIPIENT_KEY_UNAVAILABLE` | 一个或多个接收者暂时无法安全接收 | 查看失败对象、移除、重试、取消 | 部分发布且不告知 | recipient change / key arrival |
| `AUDIENCE_TOO_LARGE` | 私密 audience 超过协议 actor/slot 上限 | 缩小 audience、取消 | 截断接收者、部分发布 | audience reduced |
| `PUBLISHING` | 正在提交一个不可变 audience 的版本 | 取消仅限尚未 durable admission | 重复提交、切换 audience | success / typed failure |
| `PUBLISHED` | 当前设备和 Station 均确认已发布 | 打开、删除、继续浏览 | 用 optimistic state 冒充持久化 | durable readback |
| `PUBLISH_FAILED` | 未发布，草稿仍在 | 重试、编辑、取消 | 清空草稿、改成 PUBLIC 重试 | retry / cancel |

## 3. Read States

| State | User-visible meaning | Allowed actions | Forbidden behavior | Transition |
|---|---|---|---|---|
| `LOADING_AUTHORIZED_RESOURCE` | 正在验证身份、授权和内容 | 返回、取消 | 先显示未验证明文 | authorization result |
| `WAITING_FOR_PRIVATE_KEY` | 有权访问，但当前设备的解密材料尚未可用 | 有界重试、进入恢复 | 无限 spinner、明文 fallback | key arrives / timeout |
| `RECOVERY_REQUIRED` | 需要在受信设备恢复历史访问 | 启动恢复、返回 | 暗示内容已丢失或请求作者密码 | recovery result |
| `RECOVERY_KEY_UNAVAILABLE` | 当前授权内容缺少可验证的 actor recovery envelope | 重试同步、报告、返回 | 请求 Station 解密或静默跳过历史 | envelope arrives / terminal report |
| `DECRYPTING` | 已取得 ciphertext，正在本地验证和解密 | 返回 | 显示部分明文 | verified plaintext / failure |
| `CONTENT_READY` | 内容已通过授权和完整性验证 | 阅读、评论、打开媒体 | 暴露其他 recipient envelopes | delete / relationship change |
| `AUTHENTICATION_REQUIRED` | token 缺失、过期或被撤销 | 重新登录、返回 | 静默降级为匿名 | authenticated |
| `NOT_FOUND_OR_NOT_AUTHORIZED` | 内容不存在或当前用户不可见 | 返回 | 证明私密对象存在、显示作者/受众 | none |
| `INTEGRITY_FAILURE` | 内容损坏或认证失败 | 重新下载、报告、返回 | 返回部分内容或忽略校验 | successful retry |
| `PRIVATE_UNSUPPORTED_ON_DEVICE` | 当前运行时没有安全解密能力 | 转到 Native 设备、返回 | 提供公共 URL 替代 | supported device |
| `DELETED_OR_REVOKED` | 内容已删除或后续访问资格失效 | 返回、清理本地普通 cache | 宣称恶意保存副本已删除 | none |

## 4. Comment And Attachment States

### Comment

- `COMMENT_EDITING`: 文本仅在当前设备草稿中。
- `COMMENT_ENCRYPTING`: 保留文本，局部禁用提交。
- `COMMENT_SUBMITTING`: 提交 encrypted payload，父 Post 权限再次验证。
- `COMMENT_POSTED`: receiver 侧读取到完整明文。
- `COMMENT_FAILED`: 保留文本并给出 typed retry。
- `COMMENT_RATE_LIMITED`: 保留文本并显示可重试时间，不自动重复提交。
- `COMMENT_PARENT_UNAVAILABLE`: 父 Post 删除或权限失效，禁止继续提交。

### Attachment

- `MEDIA_PLACEHOLDER`: 已知布局但尚未取得授权。
- `MEDIA_GRANT_PENDING`: 正在申请目标 object 的有界读取能力。
- `MEDIA_DOWNLOADING`: 下载 ciphertext。
- `MEDIA_DECRYPTING`: 本地完整性验证和解密。
- `MEDIA_READY`: 展示明文媒体。
- `MEDIA_ACCESS_DENIED`: 当前 actor/device/object binding 不匹配。
- `MEDIA_INTEGRITY_FAILURE`: hash 或 AEAD 校验失败。
- `MEDIA_OFFLINE_RETRYABLE`: 网络不可用，保持占位和重试动作。

任何 attachment failure 都不得回退到公开、未加密或第三方原始 URL。

## 5. Relationship And Deletion State

| Trigger | New requests | Existing ordinary cache | Previously exported/saved content |
|---|---|---|---|
| Unfollow | `FOLLOWERS` 后续访问失效 | 收到 revoke 后清理 | cannot guarantee removal |
| Friend removed | `FRIENDS` 后续访问失效 | 收到 revoke 后清理 | cannot guarantee removal |
| Block either direction | 所有非 PUBLIC 后续访问失效 | 收到 revoke 后清理 | cannot guarantee removal |
| Moment deleted | Post、Comment、Media、Recovery 后续访问失效 | 删除普通 projection/cache | cannot guarantee removal |
| Device revoked | 该设备不再取得新 envelope 或 recovery material | 清理该账号安全状态 | malicious copies remain outside control |

## 6. State Invariants

1. `CONTENT_READY` 只能从当前 actor/device 的授权、完整性校验和本地解密成功进入。
2. `PUBLIC` 与 private state 不共享自动 fallback。
3. `AUTHENTICATION_REQUIRED` 与 `NOT_FOUND_OR_NOT_AUTHORIZED` 不可互换。
4. key 缺失是可恢复状态，不表现为空 Post、损坏图片或永久 loading。
5. 发布失败、评论失败和媒体失败只影响对应局部动作，不清空其他已验证投影。
6. account switch 后，前一 actor 的 `CONTENT_READY` 私密投影立即失效。
7. 删除/关系失效只承诺阻断后续系统访问，不承诺逆转接收者已经获得的知识。

## 7. Journey Coverage

| Journey | Required states |
|---|---|
| `SOC-SEC-J01` | `AUDIENCE_REQUIRED` through `PUBLISHED`, including every private readiness and publish failure |
| `SOC-SEC-J02` | `LOADING_AUTHORIZED_RESOURCE`, key/recovery states, `DECRYPTING`, `CONTENT_READY`, integrity failure |
| `SOC-SEC-J03` | `AUTHENTICATION_REQUIRED`, `NOT_FOUND_OR_NOT_AUTHORIZED`, media denial |
| `SOC-SEC-J04` | `READY_PRIVATE`, `CONTENT_READY`, `NOT_FOUND_OR_NOT_AUTHORIZED` |
| `SOC-SEC-J05` | all Comment states and parent unavailable |
| `SOC-SEC-J06` | all Attachment states |
| `SOC-SEC-J07` | `RECOVERY_REQUIRED`, `WAITING_FOR_PRIVATE_KEY`, `CONTENT_READY`, device revoked |
| `SOC-SEC-J08` | `DELETED_OR_REVOKED` and ordinary cache cleanup |
| `SOC-SEC-J09` | `READY_PUBLIC`, `PUBLISHED`, `CONTENT_READY` without private-key states |
