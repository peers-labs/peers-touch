# WE-S3：provisioner 侧车 — SPI、policy、Linux OCI allocate/release

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S3",
  "workstreamId": "WE-PROVISIONER",
  "title": "独立 workspace-sandbox-provisioner：ExecutorBackend SPI、镜像/安全 policy、Linux OCI 分配与回收",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "we-s3-provisioner-spi-oci",
  "journeyId": "we-j03-provisioner-spi-oci",
  "runtimeClass": "service",
  "writeSet": ["apps/workspace-sandbox-provisioner", "tooling/docker"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution", "model/domain/agent"],
  "budgets": { "focusedCheckSeconds": 3000, "functionalRunSeconds": 2400, "cleanupSeconds": 600 },
  "checks": [
    { "id": "we-s3-gotest", "command": "cd apps/workspace-sandbox-provisioner && gofmt -l . && go test ./...", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s3-isolation-static", "command": "cd apps/workspace-sandbox-provisioner && go test ./internal/backend -run SecurityTemplate", "verificationClass": "FUNCTIONAL_CHECK" },
    {
      "id": "we-s3-functional",
      "command": "cd apps/workspace-sandbox-provisioner && go test ./internal/... -run 'Allocate|SecurityTemplate|Policy'",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "新增独立可执行单元 provisionerd，对外只实现 provisioner 窄 RPC（mTLS、独立服务身份、短期执行令牌校验 ref 属于 actor）",
    "ExecutorBackend SPI：Probe/Allocate/Release + SecuritySpec 翻译；oci_linux 后端首期以 docker API/CLI 实现但接口对齐 containerd；翻译不出强隔离返回错误（不降级）",
    "policy：镜像白名单+digest（拒绝可变 tag/未授权仓库/任意挂载/特权）、固定安全模板（非 root、no-new-privileges、drop caps、seccomp、只读 rootfs、仅 /workspace 可写）、每 actor 配额、egress allowlist 配置",
    "compose：新增 workspace-sandbox-provisioner（独占 docker.sock）与 egress proxy；station 仍无 sock/非特权；sandbox 网络与 station/postgres 隔离",
    "确定性测试：Allocate 生成容器 id -u 非 0；rootfs 只读；SecuritySpec 缺强隔离字段时 Probe/Allocate 报错；非白名单镜像被拒；Release 停止容器（卷策略占位）",
    "provisioner 不 import Station 业务库、不连业务 DB；只记录审计事件（actor/ref/image@digest/配额），不记密钥/完整输出"
  ],
  "failureBehavior": [
    "本切片不实现 Exec/PTY（S4/S6）",
    "不实现 microVM、不实现 mac/Win 后端（SPI 预留即可）",
    "Station 容器姿态不得为支持 provisioner 而变特权"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

系统出现一个独立、最小权限、可审计的沙盒供给面，能按固定强隔离模板在 Linux 上分配/回收标准 OCI 沙盒；Station 与运行时特权彻底解耦。
