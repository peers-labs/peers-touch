# Bot Webhook API

> **Status**: active（v1）
> **Stability**: 向后兼容的增量演进；破坏性变更将提供新版本路径
> **Last verified**: 2026-10-12
> **Audience**: 在 coding agent hook、CI、外部 SaaS、脚本中向 Peers-Touch Bot 投递事件的调用方

任何能发 HTTPS 请求的工具（`curl`、CI、SaaS webhook、agent hook 脚本）都直接调用下面这一个端点。
v1 不提供也不要求官方 CLI。设计背景（单一 webhook 原语、v1 不维护 sender CLI）见架构决策
[BOT-D02 / BOT-D10](../../architecture/domains/bot/decisions.md)。

---

## 1. 心智模型

- 一个 Bot 就是一个 webhook 收件箱：**不透明 URL + Bearer secret**，单向入站。
- 一次成功调用 = 在该 Bot 与安装者（owner）的直聊中产生**一条消息**，并按通知偏好产生
  **一条通知**；owner 在线时其客户端会收到实时提醒。
- v1 仅可投递给安装者本人；请求体**不能**指定收件人或会话，归因只来自 URL 鉴权。
- Bot 会话是**服务端托管明文**（非端到端加密），客户端不显示 E2EE 锁。

## 2. 获取 URL 与 secret

在 Desktop **全局层 Settings → Bots** 创建 Bot，或调用管理 API（需用户 JWT）：

```bash
POST /bot/create
Authorization: Bearer <用户 JWT>
Content-Type: application/json

{"name": "Claude Code"}
```

响应（protojson，snake_case）：

```json
{
  "bot": {
    "bot_ptid": "ptid:v1:actor:peers:b:bot-wh_xxxx:…",
    "owner_ptid": "ptid:v1:actor:peers:p:…",
    "name": "Claude Code",
    "state": "BOT_STATE_ACTIVE",
    "webhook_id": "wh_xxxx",
    "delivery_scope": "BOT_DELIVERY_SCOPE_OWNER_ONLY",
    "rate_limit_per_minute": 120
  },
  "webhook_url": "/bot/webhook/wh_xxxx",
  "secret_plaintext": "ptsec_…"
}
```

- `secret_plaintext` **只在创建/轮换时返回一次**，服务端只存哈希；请立即存入 CI secret / 本地 0600 文件，不要写进可提交的配置。
- 轮换 secret 时 webhook id / URL / 历史会话不变；停用（disable）/吊销（revoke）对后续请求立即生效。

## 3. 请求

```
POST {station-base}/bot/webhook/{webhook_id}
Authorization: Bearer {secret}
Content-Type: application/json
```

- 独立 secret 鉴权，**不带**用户 JWT，无 cookie/CSRF 面。
- 请求体上限 **32 KiB**（32768 字节），超出返回 413。
- 字符编码 UTF-8；`title`/`body` 中疑似密钥形态的子串会被服务端脱敏。

## 4. 请求体 schema

字段即 [`model/domain/bot/webhook.proto`](../../../model/domain/bot/webhook.proto) 的
proto-JSON。**严格解析：出现任何未知字段 → 400**（请求体不能携带 actor/recipient 等归因字段）。

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema_version` | 是 | 固定字符串 `"1"`；其它值 → 400 |
| `request_id` | 是 | 调用方生成的幂等键，≤ 2 KiB；同值 24h 内重试只产生一次产物 |
| `event_type` | 是 | 枚举全名，见下 |
| `severity` | 否 | 枚举全名；缺省归一化为 `INFO` |
| `title` | 二选一 | 标题，≤ 2 KiB |
| `body` | 二选一 | 正文，≤ 2 KiB；`title`/`body` 至少一个非空 |
| `group_key` | 否 | 折叠键：未读期间同键连续事件在卡片层折叠，≤ 2 KiB |
| `dedupe_key` | 否 | 业务去重提示，≤ 2 KiB |
| `source` | 否 | 来源对象，见下 |

`event_type`（必须使用**完整枚举名**，短名 `TASK_COMPLETED` 会被严格解析拒绝）：

- `BOT_EVENT_TYPE_TASK_COMPLETED` — 任务完成
- `BOT_EVENT_TYPE_WAITING_INPUT` — 等待输入 / 权限确认
- `BOT_EVENT_TYPE_TASK_FAILED` — 任务失败
- `BOT_EVENT_TYPE_IDLE` — 空闲
- `BOT_EVENT_TYPE_CUSTOM` — 自定义

`severity`：`BOT_EVENT_SEVERITY_INFO` / `BOT_EVENT_SEVERITY_ATTENTION` / `BOT_EVENT_SEVERITY_ERROR`。

`source`（全部可选，每个字符串字段 ≤ 2 KiB）：

| 字段 | 说明 |
|---|---|
| `agent` | 产生事件的 agent，如 `claude-code` |
| `workspace` | 工作区/项目标识 |
| `session_id` | agent 会话 id |
| `action_url` | 点击卡片主操作跳转地址；**必须**是合法 `http`/`https` URL，否则 400 |
| `labels` | 字符串 map，至多 32 项；key ≤ 100 字节、value ≤ 512 字节 |

最小请求：

```json
{
  "schema_version": "1",
  "request_id": "ci-4271-20261012T0900Z",
  "event_type": "BOT_EVENT_TYPE_TASK_COMPLETED",
  "title": "Build #4271 passed"
}
```

完整请求：

```json
{
  "schema_version": "1",
  "request_id": "cc-session7-evt001",
  "event_type": "BOT_EVENT_TYPE_WAITING_INPUT",
  "severity": "BOT_EVENT_SEVERITY_ATTENTION",
  "title": "需要授权",
  "body": "Claude 请求执行 rm 命令，等待确认",
  "group_key": "session7",
  "dedupe_key": "evt-001",
  "source": {
    "agent": "claude-code",
    "workspace": "peers-touch-master",
    "session_id": "session-7",
    "action_url": "https://ide.local/session/7",
    "labels": {"repo": "peers-touch", "branch": "feat/bot"}
  }
}
```

## 5. 幂等与折叠

- **幂等键 = `request_id`**，窗口 24h。窗口内重复提交返回 `DEDUPLICATED` 与**同一个** `event_id`，消息与通知都不重复。
- 调用方可安全地“至少一次”重试：网络超时后用**同一个 `request_id`** 重发即可。
- `group_key` 只表达展示层折叠意图，不替代 `request_id` 的幂等语义。

## 6. 成功响应

`200 OK`，`Content-Type: application/json`：

```json
{ "outcome": "INGEST_OUTCOME_ACCEPTED", "event_id": "50bc812aa525a1840651c9ca44d2d17f" }
```

幂等重试时：

```json
{ "outcome": "INGEST_OUTCOME_DEDUPLICATED", "event_id": "50bc812aa525a1840651c9ca44d2d17f" }
```

## 7. 错误与状态码

错误体为 `text/plain`。**鉴权类失败刻意不可区分**（不泄露 webhook id 是否存在）。

| 状态码 | body（纯文本） | 含义与调用方动作 |
|---|---|---|
| `401` | `unauthorized` | webhook id 未知 / Bot 停用或吊销 / secret 缺失或错误。视为**终态**，不要用同一凭证重试 |
| `400` | `invalid webhook event payload` | JSON 不是合法 proto-JSON，或含未知字段、枚举名不合法 |
| `400` | `invalid webhook event` | 解析通过但语义不合法（schema_version、缺 title/body、URL scheme、超长等） |
| `413` | `request body exceeds the limit` | 体 > 32 KiB；裁剪后再发 |
| `429` | `rate limit exceeded` | 触发限流；读响应头 `Retry-After`（秒）后再发；带同 `request_id` 重试不重复 |
| `502` | `event delivery is temporarily unavailable` | 已鉴权、已受理，但投递暂时失败；用同 `request_id` 退避重试 |
| `503` | `webhook ingestion is not configured` | 该 Station 未启用 bot 摄入；联系部署者，非调用方问题 |

限流在解析 body 前执行：每 Bot 默认 **120 次/分钟**（令牌桶）；单源 IP 溢出上限 600 次/分钟。

## 8. 调用方责任：不要拖慢你的 agent

webhook 是**通知副作用**，不在 agent/CI 的关键成败路径上。请在调用侧保证：

1. **固定墙上超时**：`curl --max-time 5`。
2. **失败不反噬**：hook 命令始终成功退出（末尾 `|| true`）。通知失败不应让 agent 报错或卡住。
3. **幂等重试**：需要补偿时用同一个 `request_id`；401/400/413 是终态，直接丢弃并记脱敏日志。
4. **不打印 secret / 完整 body 到日志**。

v1 不提供官方 spool/重试器：`request_id` 幂等 + 调用方短超时已覆盖关键风险；确有强补偿需求时，
由调用方在本地做有界缓冲（最旧先丢）。未来若提供官方受维护客户端，它会作为 `apps/` 下的
一等公民发布。

## 9. 接入示例

### 9.1 curl

```bash
curl -fsS --max-time 5 \
  -X POST "https://<station-host>/bot/webhook/wh_xxxx" \
  -H "Authorization: Bearer $PEERS_BOT_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"schema_version":"1","request_id":"'"$BUILD_ID"'","event_type":"BOT_EVENT_TYPE_TASK_COMPLETED","title":"Build '"$BUILD_ID"' passed"}' \
  || true
```

### 9.2 CI（GitHub Actions 片段）

```yaml
- name: Notify Peers-Touch on failure
  if: failure()
  env:
    PEERS_BOT_SECRET: ${{ secrets.PEERS_BOT_SECRET }}
  run: |
    curl -fsS --max-time 5 -X POST "$PEERS_BOT_URL" \
      -H "Authorization: Bearer $PEERS_BOT_SECRET" \
      -H "Content-Type: application/json" \
      --data "{\"schema_version\":\"1\",\"request_id\":\"ci-${GITHUB_RUN_ID}\",\"event_type\":\"BOT_EVENT_TYPE_TASK_FAILED\",\"severity\":\"BOT_EVENT_SEVERITY_ATTENTION\",\"title\":\"CI 失败\",\"body\":\"${GITHUB_WORKFLOW} #${GITHUB_RUN_NUMBER}\",\"source\":{\"agent\":\"github-actions\",\"workspace\":\"${GITHUB_REPOSITORY}\",\"action_url\":\"${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}\"}}" \
      || true
```

### 9.3 Claude Code hooks

Claude Code 经 stdin 传入 hook JSON。下例用 `jq` 映射后投递；`Stop` 映射为任务完成，
`Notification`（请求权限/输入）映射为等待输入。命令始终以 `|| true` 收尾。

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "jq -c '{schema_version:\"1\",request_id:(\"cc-\"+.session_id+\"-stop\"),event_type:\"BOT_EVENT_TYPE_TASK_COMPLETED\",severity:\"BOT_EVENT_SEVERITY_INFO\",title:\"任务完成\",source:{agent:\"claude-code\",session_id:.session_id}}' | curl -fsS --max-time 5 -X POST \"$PEERS_BOT_URL\" -H \"Authorization: Bearer $PEERS_BOT_SECRET\" -H \"Content-Type: application/json\" --data-binary @- || true"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "jq -c '{schema_version:\"1\",request_id:(\"cc-\"+.session_id+\"-notif-\"+(.message|gsub(\"[^A-Za-z0-9]\";\"\"))),event_type:\"BOT_EVENT_TYPE_WAITING_INPUT\",severity:\"BOT_EVENT_SEVERITY_ATTENTION\",title:\"等待输入\",body:(.message // \"Claude 需要确认\"),group_key:(\"cc-\"+.session_id),source:{agent:\"claude-code\",session_id:.session_id}}' | curl -fsS --max-time 5 -X POST \"$PEERS_BOT_URL\" -H \"Authorization: Bearer $PEERS_BOT_SECRET\" -H \"Content-Type: application/json\" --data-binary @- || true"
          }
        ]
      }
    ]
  }
}
```

> hook 字段映射是调用方约定，不是服务端合同：服务端只认第 4 节的 canonical JSON。

## 10. 投递后的可观察结果

- 成功受理的事件在 Bot↔owner 直聊中产生一条可回看的消息，并在通知偏好允许时产生一条通知。
- owner 在线时其客户端秒级收到提醒；离线期间产生的消息与未读在任意客户端重开后回收。
- 重试语义以第 5 节为准：同一 `request_id` 不产生重复消息或通知。
