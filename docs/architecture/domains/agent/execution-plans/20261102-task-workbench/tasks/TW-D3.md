# TW-D3：资料、Artifact 版本、反馈、检查与接受

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "TW-20261102",
  "taskId": "TW-D3",
  "workstreamId": "TW-ARTIFACT",
  "title": "逻辑 Artifact 不可变版本序列、资料采用归因、反馈/检查/接受分别建模并统一切换消费者",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "tw-j03-material-artifact-feedback",
  "closureId": "tw-d3-artifact-version-loop",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/domains/agent/task-workbench",
    "docs/architecture/domains/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "tw-d3-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d3-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tw-d3-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- chatArtifacts portal messages",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "资料上传后发送任务，当前 Turn 的 ContextLedger/归因投影显示资料按版本被实际采用；名称出现不等于采用，移除资料只影响后续轮次",
    "逻辑 Artifact 具备不可变版本序列：新字节产生新版本与正文摘要，正文大对象走 Blob/对象存储，事件只含引用；历史正文不能被同 blob UPDATE 覆盖",
    "人工编辑使用 expected base version 乐观并发，冲突返回当前版本可回读；选区/正文反馈绑定来源 artifact/version 并生成新版本；旧版可回看",
    "检查记录与接受记录分别建模，绑定成果版本/字节摘要、条件与资料修订、检查类型与环境；用户拒绝或检查失败保持任务待处理；依据变更使旧检查/旧接受失效且不自动恢复",
    "reader、Search、通知、消息卡片、Portal、导出全部引用同一 artifact/version；全部消费者切换后删除消息正文/代码块提取作为成果真源的路径（代码块渲染保留为消息展示）",
    "旧消息中确有字节的结果一次性导入成果体系，不伪造原始来源与验证记录",
    "exact-source Native Journey：资料→成果→阅读→选区反馈→新版本→检查→接受→刷新重开→导出打开同一版本"
  ],
  "failureBehavior": [
    "不用最新消息或代码块解析作为正式结果真源，不让每个 reader 自存正文",
    "Agent 自评、模型回复、exit 0 均不能产生检查通过或任务完成",
    "来源过时或不可读显式提示，不换另一篇正文兜底；网页预览与正文版本绑定，正文更新后旧预览标过时",
    "数据迁移只用于该 schema 版本升级，不成为日常兼容层；生产数据迁移另行授权",
    "所有用户可见文案进 packages/locales；禁止 mock 与伪造成功"
  ],
  "updatedAt": "2026-11-02T00:00:00.000Z"
}
```

## 完整闭环

用户资料被真实消费，结果成为可打开的正式 Artifact；反馈与人工修订产生可回看的新版本，检查与接受是不同事实并随依据变更失效；所有工作面消费者打开同一版本，消息文本提取作为成果真源的旧路径在同切片删除。
