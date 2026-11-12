# TW-D4 阶段验收说明（临时文档）

> 阶段：TW-D4 Artifact 版本环 —— 文件变更事实 / 有界命令 / COMMAND 检查
> 计划：TW-20261102-1102，journeyId tw-j04
> 本文件为阶段临时验收指引；正式结论以 `tw-d4-journey.json` 与提交记录为准。

## 本阶段交付内容

1. **设备工具产生可审计事实（Rust executor）**
   - `local_file_write` / `local_file_edit` 返回 `change_type`、变更前字节 sha256/size、LCS 统一 diff（上限 16KiB，超限截断）。
   - `local_shell_exec` 有界化：60s 超时杀死、单流 64KiB 上限，回执包含 exit_code / duration_ms / cwd / stdout / stderr / timed_out；错误使用类型化 code（PATH_OUTSIDE_ROOT / COMMAND_NOT_ALLOWED / COMMAND_TIMEOUT / EXECUTION_FAILED）。
2. **Station 校验与持久化（Go）**
   - turn artifact 变更事实校验（created 不得带 before、modified 必须带 before、diff ≤64KiB）。
   - 新增 COMMAND 检查：Station 校验同一会话内真实 `local_shell_exec` 调用、退出码、回显命令，以及 `sha256(bounded_result)` 与证据一致；PASSED 要求 exit 0。
   - 续写恢复补发持久化 `tool_result` 事件；终端快照发送前排空事件序列（修复竞态）；诊断导出补齐 bounded result。
3. **Desktop UI**
   - 工具卡常驻展示 diff / 摘要 / 退出码 / cwd / duration / stdout / stderr。
   - Artifact 面板可将最近一次通过的命令登记为版本的 COMMAND 检查。
4. **多轮折叠修复（关键）**
   - 一个 Turn 持久化为多条 assistant leg（工具调用 leg 内容为空，最终 leg 承载答案）。修复：
     - 折叠节点记录内容承载 leg 的 `contentMessageId`，Artifact 认领使用该 id（此前认领空 tool leg 被 Station 拒绝）。
     - 已完成的工具调用 leg 不再被误判为 Turn 终态（快照间隙曾导致气泡提前 completed、认领按钮缺失）；后位 leg 仍在流式时气泡保持非终态。

## 如何验收

### A. 全自动 Native Journey（最终判据）

```bash
cd apps/desktop
PT_PLAYWRIGHT_SOCKET=/tmp/tw-d1.sock \
PT_STATION_URL=http://127.0.0.1:18092 \
PT_EVIDENCE_COMMIT=$(git rev-parse HEAD) \
pnpm exec playwright test --config e2e/playwright.config.ts \
  e2e/tests/tw-d4-journeys.spec.ts --project=performance --reporter=line
```

journey 覆盖：写文件（人工批准）→ grep 失败 exit 1 → 精确 edit（diff 可见）→ grep 通过 exit 0 → 认领最终消息为不可变版本 → 绑定通过的命令为 COMMAND 检查。
通过后证据写入：`tooling/acceptance/reports/task-workbench/tw-d4-journey.json`。

### B. 聚焦静态/单测检查

```bash
# Station
cd apps/station && gofmt -l . && go test ./app/subserver/agent/...

# Desktop（worker 测试；需在带 keyring 的环境运行，构建容器内
# local_capability_advertisement_exposes_only_implemented_replay_claims
# 因无 OS keystore 失败，已在基线提交复现，属环境问题非回归）
cargo test desktop_executor_worker

cd apps/desktop && pnpm run check
pnpm exec vitest run src/store src/store/streaming
```

### C. 手工验收（运行中的 Cell）

1. Agent 页新话题，要求：“用 local_file_write 创建 d4xxxx.txt，内容 status=fail”。
2. 批准工具卡；气泡在最终答复 leg 完成前不显示终态。
3. 再要求 `grep status=ok d4xxxx.txt`，工具卡显示退出码 1 与输出。
4. 要求用 local_file_edit 将 `status=fail` 改为 `status=ok`，工具卡显示 unified diff（-status=fail / +status=ok）与字节摘要。
5. 重跑同一 grep，工具卡显示退出码 0。
6. 最终消息下出现“保存为新 Artifact”，点击后面板打开；面板中点“命令检查通过”，版本出现一条 passed 的 COMMAND 检查。
7. Postgres 旁证：

```sql
SELECT source_tool_call_id, command, command_exit_code, length(command_output_sha)
FROM agent_artifact_checks WHERE id='<check-id>';
-- 期望：<tool_call_id>|grep|0|64
```

## 当前状态

- Journey：run23 UI 全链路通过（认领版本来源为内容 leg、COMMAND 检查 passed），仅测试脚本 psql 多行字符串缺陷导致收尾断言未执行；已改为 stdin 传 SQL，run24 复验。
- 环境：compose `pt-tw-d1`（Station :18092），Cell `tw-d1-cell`，模型 qwen2.5:0.5b（偶发跳过工具调用，journey 内自动换新话题重试）。
