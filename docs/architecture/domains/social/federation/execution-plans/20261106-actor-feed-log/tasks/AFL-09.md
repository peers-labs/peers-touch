# AFL-09 · 终态证据矩阵收口

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-09",
  "workstreamId": "END-STATE-PROOF",
  "title": "v1 五类 Journey FUNCTIONAL_PROOF + 检查全绿 + outcome 证据回填",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j09-proof",
  "closureId": "afl-09-end-state-proof",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "docs/architecture/domains/social/federation/execution-plans/20261106-actor-feed-log"
  ],
  "readSet": [
    "apps/station",
    "apps/desktop",
    "model",
    "tooling/acceptance"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl09-station",
      "command": "cd apps/station/app && gofmt -l . && go test ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl09-proto",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl09-desktop",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/desktop run build",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl09-functional",
      "command": "cd apps/station/app && go test ./subserver/social/... -run ActorFeedLogEndStateJourneys",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "afl09-gates",
      "command": "python3 tooling/scripts/acceptance-run.py --require-proven --scope actor-feed-log-endstate",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "v1 证明矩阵五类 FUNCTIONAL_PROOF：①篡改注入拒收且投影不变（feed_fork 可观测）；②跨站收敛（帧总线通知 + 缺口拉取两路径，含 Relay opaque 抓包断言）；③硬切拒收（旧公开写/Mobile 发帖 typed 拒绝 + 第二设备单设备拒绝）；④线程发现（非关注者入站评论/反应成线程并扇出）；⑤在役 E2EE 私密不回归（prepare/submit、跨站私密投递、撤回、native private gates 零变化）",
    "性能基线先测后定阈值并落档；outcome 实际结果区按 current-source 证据回填，未运行 Gate 保持 UNPROVEN；DEFERRED 的 v2 Journey（多设备/密文隔离/助记词回灌）保持 UNPROVEN，不计入 v1 完成",
    "Go/proto/Desktop 检查全绿；不宣告生产发布或 Mobile UI 完成"
  ],
  "failureBehavior": [
    "公开副本不可收回作为已知产品语义如实记录",
    "不证明 v2 DEFERRED 项（AFL-04/05B/07/07B）"
  ],
  "updatedAt": "2026-11-07T00:00:00.000Z"
}
```

## 完整闭环

v1 证据收口：五类 Journey FUNCTIONAL_PROOF。多设备合流、密文子链隔离/撤回、助记词回灌恢复
随 AFL-04/05B/07/07B 延 v2，本轮保持 UNPROVEN。
