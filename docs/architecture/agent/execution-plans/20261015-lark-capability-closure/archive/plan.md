# Lark 能力闭环实施计划

> **Plan ID**: lark-capability-closure-20261015
> **Version ID**: 20261016-confirmed-production-v2
> **Created**: 2026-10-16T02:00:00.000Z
> **Owner**: Peers-Touch Agent / Channel

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "lark-capability-closure-20261015",
  "versionId": "20261016-confirmed-production-v2",
  "createdAt": "2026-10-16T02:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {"sources": ["docs/architecture/agent/design.md", "docs/architecture/agent/data-model.md", "docs/architecture/agent/modern-chat-agent/design.md", "docs/architecture/agent/execution-plans/20261015-lark-capability-closure.md"], "decisions": ["MCA-D15", "MCA-D16A", "MCA-D17", "MCA-D23"]},
  "scope": {"sourceClaims": [{"pathPrefix": "apps/station/app/subserver/channel", "mode": "exclusive-write"}, {"pathPrefix": "apps/station/app/subserver/agent", "mode": "exclusive-write"}, {"pathPrefix": "apps/station/app/subserver/oss", "mode": "exclusive-write"}, {"pathPrefix": "apps/station/app/cmd/lark-channel-plugin", "mode": "exclusive-write"}, {"pathPrefix": "apps/station/app/conf/sub_channel.yml", "mode": "exclusive-write"}, {"pathPrefix": "apps/station/app/main.go", "mode": "exclusive-write"}, {"pathPrefix": "apps/station/app/go.mod", "mode": "exclusive-write"}, {"pathPrefix": "apps/station/app/go.sum", "mode": "exclusive-write"}, {"pathPrefix": "apps/desktop/src", "mode": "exclusive-write"}, {"pathPrefix": "apps/desktop/src-tauri/src", "mode": "exclusive-write"}, {"pathPrefix": "apps/oauth2-client", "mode": "exclusive-write"}, {"pathPrefix": "model/domain/channel", "mode": "exclusive-write"}, {"pathPrefix": "packages/locales", "mode": "exclusive-write"}, {"pathPrefix": "tooling/plugins/build-lark-plugin.sh", "mode": "exclusive-write"}, {"pathPrefix": "tooling/acceptance/domains/channel", "mode": "exclusive-write"}, {"pathPrefix": "tooling/acceptance/gates/channel", "mode": "exclusive-write"}, {"pathPrefix": "tooling/acceptance/gates.yaml", "mode": "exclusive-write"}, {"pathPrefix": "tooling/acceptance/registry.yaml", "mode": "exclusive-write"}, {"pathPrefix": "docs/architecture/agent", "mode": "exclusive-write"}], "nonGoals": ["跨工作区写入、切换或创建 worktree", "未经授权 commit/push/PR/deploy/reset", "用占位文本代替图片/文件处理", "把其他平台或独立 AgenticFlow/A2A 产品混入 Lark 完成度"]},
  "tasks": [
    {"id": "LARK-00", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-00.md", "dependsOn": []},
    {"id": "LARK-01", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-01.md", "dependsOn": ["LARK-00"]},
    {"id": "LARK-02", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-02.md", "dependsOn": ["LARK-01"]},
    {"id": "LARK-03", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-03.md", "dependsOn": ["LARK-00"]},
    {"id": "LARK-04", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-04.md", "dependsOn": ["LARK-03"]},
    {"id": "LARK-05", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-05.md", "dependsOn": ["LARK-04"]},
    {"id": "LARK-06", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-06.md", "dependsOn": ["LARK-04"]},
    {"id": "LARK-07", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-07.md", "dependsOn": ["LARK-06"]},
    {"id": "LARK-08", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-08.md", "dependsOn": ["LARK-02", "LARK-04"]},
    {"id": "LARK-09", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-09.md", "dependsOn": ["LARK-02", "LARK-06"]},
    {"id": "LARK-10", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-10.md", "dependsOn": ["LARK-09"]},
    {"id": "LARK-11", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-11.md", "dependsOn": ["LARK-02", "LARK-06"]},
    {"id": "LARK-12", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-12.md", "dependsOn": ["LARK-11"]},
    {"id": "LARK-13", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-13.md", "dependsOn": ["LARK-03", "LARK-08", "LARK-12"]},
    {"id": "LARK-14", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-14.md", "dependsOn": ["LARK-10", "LARK-11", "LARK-13"]},
    {"id": "LARK-15", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-15.md", "dependsOn": ["LARK-14"]},
    {"id": "LARK-16", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-16.md", "dependsOn": ["LARK-06", "LARK-13"]},
    {"id": "LARK-17", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-17.md", "dependsOn": ["LARK-10", "LARK-16"]},
    {"id": "LARK-18A", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-18A.md", "dependsOn": ["LARK-12", "LARK-17"]},
    {"id": "LARK-18B", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-18B.md", "dependsOn": ["LARK-18A"]},
    {"id": "LARK-18C", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-18C.md", "dependsOn": ["LARK-18B"]},
    {"id": "LARK-19", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-19.md", "dependsOn": ["LARK-02", "LARK-13", "LARK-18C"]},
    {"id": "LARK-20", "workstreamId": "LARK-CLOSURE", "path": "tasks/LARK-20.md", "dependsOn": ["LARK-19", "LARK-07", "LARK-15"]}
  ],
  "authorization": {"checkpoint": {"localCommit": "denied", "amend": "denied"}, "delivery": {"push": "denied", "pullRequest": "denied"}, "runtime": {"deployProfiles": [], "destructiveResetScopes": []}, "history": {"rewrite": "denied"}}
}
```

## Acceptance Execution

```json
{"closures": {"lark-00": [], "lark-01": ["lark-01-e2e"], "lark-02": ["lark-02-e2e"], "lark-03": ["lark-03-e2e"], "lark-04": ["lark-04-e2e"], "lark-05": ["lark-05-e2e"], "lark-06": ["lark-06-e2e"], "lark-07": ["lark-07-e2e"], "lark-08": ["lark-08-e2e"], "lark-09": ["lark-09-e2e"], "lark-10": ["lark-10-e2e"], "lark-11": ["lark-11-e2e"], "lark-12": ["lark-12-e2e"], "lark-13": ["lark-13-e2e"], "lark-14": ["lark-14-e2e"], "lark-15": ["lark-15-e2e"], "lark-16": ["lark-16-e2e"], "lark-17": ["lark-17-e2e"], "lark-18a": ["lark-18a-e2e"], "lark-18b": ["lark-18b-e2e"], "lark-18c": ["lark-18c-e2e"], "lark-19": ["lark-19-e2e"], "lark-20": ["lark-20-e2e"]}, "completion": ["lark-01-e2e", "lark-02-e2e", "lark-03-e2e", "lark-04-e2e", "lark-05-e2e", "lark-06-e2e", "lark-07-e2e", "lark-08-e2e", "lark-09-e2e", "lark-10-e2e", "lark-11-e2e", "lark-12-e2e", "lark-13-e2e", "lark-14-e2e", "lark-15-e2e", "lark-16-e2e", "lark-17-e2e", "lark-18a-e2e", "lark-18b-e2e", "lark-18c-e2e", "lark-19-e2e", "lark-20-e2e"], "full": ["lark-01-e2e", "lark-02-e2e", "lark-03-e2e", "lark-04-e2e", "lark-05-e2e", "lark-06-e2e", "lark-07-e2e", "lark-08-e2e", "lark-09-e2e", "lark-10-e2e", "lark-11-e2e", "lark-12-e2e", "lark-13-e2e", "lark-14-e2e", "lark-15-e2e", "lark-16-e2e", "lark-17-e2e", "lark-18a-e2e", "lark-18b-e2e", "lark-18c-e2e", "lark-19-e2e", "lark-20-e2e"]}
```

## 北极星与执行边界

普通用户完整开通、对话、处理媒体与飞书工作，技术用户配置/诊断可达；最终全能力及接收者结果不可缩减。
完整语义见[执行模型](../20261015-lark-capability-closure.md)。唯一实现根是当前 `peers-touch/master`
工作区；`feat/lark-channel` 的三个基础提交只作为已审计源码输入，以语义合并方式进入当前源，
不切换工作树、不覆盖当前分支演进。已确认的 Lark 多连接原型是生产交互合同。

LARK-00 是产品/源码/原型/能力清单与授权准入任务，不证明产品能力。所有命名
Gate/Journey 都必须由本计划注入真实业务适配器后运行，不能以静态规则或假接口代证。
提交、push、PR、部署、重置和历史改写未授权；实际运行只允许使用当前机器已有配置和 Lark
资源，不创建或改变共享环境。未产生当前源码、接收者可见证据的能力保持 UNPROVEN。
