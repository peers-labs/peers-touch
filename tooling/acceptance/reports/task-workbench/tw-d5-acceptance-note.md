# TW-D5 阶段验收说明（临时文档）

> 阶段：TW-D5 TerminalSession 长进程 —— PTY worker / viewer 订阅 / cursor 回放 / 诚实生命周期
> 计划：TW-20261102-1102，journeyId tw-j05
> 本文件为阶段临时验收指引；正式结论以 `tw-d5-journey.json` 与提交记录为准。

## 本阶段交付内容

1. **资源合同（proto-first）**
   - `model/domain/agent/terminal_session.proto`：TerminalSession 元数据（session/conversation/turn/device 绑定、pid、status、exit_code、output_bytes、created/ended）与 Create/Update/List/Reconcile/Remove。
   - Station 只存元数据；进程、环境变量与输出永不出设备。
2. **设备持有的 Rust worker（src-tauri）**
   - portable-pty 0.9：create/write/resize/kill/remove/list/read；进程与 256KiB 有界 ring 常驻 worker，Page 不持进程。
   - ring 为单调字节流，cursor 为绝对偏移；请求 cursor 早于保留窗口时返回 resync 边界（单测覆盖 cursor/replay/eviction）。
   - 输出经 `peers-touch://terminal-session-event` 分块（32KiB base64）推送；进程退出由 pump 线程 wait 后发 status 事件（exited/killed + exit code + outputBytes）。
   - cwd 经 `resolve_terminal_cwd` 限定在 actor 工作区根内。
3. **Station 持久化（Go）**
   - `agent_terminal_sessions` 表（pid 显式列名）；Create 使用 worker 生成的 `terms-<ULID>` 作为全局资源 id（幂等：重复上报不建行、不杀进程），draft 话题下存为未绑定行。
   - Reconcile：该设备 worker 不能证明存活的 RUNNING 行一律降级 UNKNOWN，重启后不显示假 running。
4. **Desktop UI**
   - TerminalDock + Drawer 面板：xterm viewer（replay 后订阅）、服务 URL 动作按钮、kill/remove；面板始终跟随当前任务会话，关闭面板只取消订阅。
   - Store merge 以 live worker 证据为准：Station RUNNING 无 live handle 即 unknown；active 选择按会话记忆并自动收敛。
   - 全部用户可见文案进 `packages/locales`（en/zh-CN chat namespace，18+ keys）。

## 本阶段修复的关键缺陷（合并最新 shared-base 后复测发现）

1. **ID 双脑**：worker 造 `terms-<ULID>`、Station Create 另造 `terms_<ULID>` 主键，导致 reconcile 永远匹配不上 live（活进程被立即降级 unknown）、UI merge join 不上 live、update/remove 全部错配。修复：worker id 即全局资源 id，proto Create 携带 session_id，Station 校验格式并幂等落库。
2. **面板会话快照陈旧**：面板只在打开时记录会话，跨话题切换后仍绑旧会话。修复：面板直接读 chat store 当前会话，active 改为按会话映射。
3. **生命周期上报类型错误**：`output_bytes` 以字符串上送，Rust serde 拒绝（expected u64），Station 行停在 running/output_bytes=0。修复为数值上送。

## 如何验收

### A. 全自动 Native Journey（最终判据）

```bash
cd apps/desktop
PT_PLAYWRIGHT_SOCKET=/tmp/tw-d1.sock \
PT_STATION_URL=http://127.0.0.1:18092 \
PT_EVIDENCE_COMMIT=$(git rev-parse HEAD) \
pnpm exec playwright test --config e2e/playwright.config.ts \
  e2e/tests/tw-d5-journeys.spec.ts --project=performance --reporter=line
```

journey 覆盖：启动 `python3 -m http.server` 长服务 → curl 200 → 关闭 viewer 后服务仍 200 →
重开面板同一 session/pid 且历史回放重新得到 URL 动作 → kill 后 UI killed + exit code + 服务下线 →
Postgres 事实（status=killed、pid>0、output_bytes>0、cwd 在 agent-workspaces、JOIN 真实 conversation）→ remove 后行删除。
通过后证据写入：`tooling/acceptance/reports/task-workbench/tw-d5-journey.json`。

### B. 聚焦静态/单测检查

```bash
# Station
cd apps/station && gofmt -l app/subserver/agent && go test ./app/subserver/agent/...

# Rust worker（构建容器内）
cargo test terminal

# Desktop
cd apps/desktop && pnpm run check
pnpm run test -- chat.terminalArtifactReconcile
```

## Non-claims

- 不实现跨 app/系统重启存活的持久 daemon；worker 换代后无证明的会话显示 unknown，可清理或重启。
- Station 不保存输出内容与环境变量；输出只存在设备侧有界 ring 内。
- draft 话题启动的会话以未绑定行存储，绑定到持久任务对话的 rebind 流程不在本切片。
