# AFL-03A · 公开对象投影重放（Station 侧，仅公开）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-03A",
  "workstreamId": "PUBLIC-PROJECTOR",
  "title": "公开 post/comment/reaction 的日志 append+projector+rebuild；实时桥 live/replay 分离",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j03a-public-projector",
  "closureId": "afl-03a-public-projector",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/subserver/social/application",
    "apps/station/app/subserver/social/infrastructure",
    "apps/station/app/subserver/social/domain"
  ],
  "readSet": [
    "apps/station/app/subserver/social",
    "apps/station/app/subserver/social/feed",
    "apps/station/app/subserver/social/application/moment_event_publisher.go"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl03a-go",
      "command": "cd apps/station/app && go test ./subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl03a-gorm",
      "command": "bash -lc '! rg -n \"\\.(Create|Updates|UpdateColumns|Delete|Exec)\\(\" apps/station/app/subserver/social --glob \"*projector*\" -g \"!*projector*\"'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "afl03a-journey",
      "command": "cd apps/station/app && go test ./subserver/social/... -run PublicProjectionJourney",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "仅公开对象：projector 从日志重放 social_public_posts、MomentDelivery、计数、FTS；提供全量 rebuild 命令且幂等",
    "机械判据针对 GORM：枚举 repo 写方法 + grep .Create(.Updates(.Delete(.Exec(，证明除 projector 包外不可达公开表",
    "MomentEventPublisher 盘点落地：live apply 继续发 SSE（含跨站私密 StageImported* 事务钩子不动），rebuild replay 抑制发布；Journey 断言发帖后 SSE 收到、全量重建不重放",
    "本批不动 social_private_posts 与 secure-content 管线；公开写服务仍保持现状入口直到 AFL-03B"
  ],
  "failureBehavior": [
    "不删任何尚被消费的写路径（删除在 03B）",
    "不碰私密管线"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

仅公开对象的 Station 侧重放闭环（F-01 修正：私密表是在役 E2EE 管线，本批不碰）。实时桥契约：MomentEventPublisher 是现役 SSE 桥（不同于零构造点的 domain/events.go 死结构体），live apply 发布、rebuild 不重放。
