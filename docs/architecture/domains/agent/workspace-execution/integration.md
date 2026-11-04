# 工作区执行落点 — 集成

> **Status**: accepted

## 1. 与 capability authority / dispatch 的集成（不改闸门语义）

复用 task-workbench D4/D7 已建立的合同，不造平行授权系统：

- 沙盒是一种**执行面 capability 资源**（建议 capability id 族：`workspace.sandbox.execute`、`workspace.sandbox.pty`），其 binding 携带 `sandbox_ref`、`image_ref@digest`、`security profile revision`。
- dispatch 闸门维持现状要求：`(capabilityId, capabilityVersion, bindingId, bindingRevision)` READY 且 lease/fencing 通过才派发。沙盒 binding 未 READY → `SANDBOX_NOT_READY`。
- 落点解析：turn 组装时由 capability 执行面得到 `ExecutionPlacement`。解析规则（WE-D04）：
  - 绑定 `workspace.sandbox.*` → target=WORKSPACE_SANDBOX；
  - 绑定 `filesystem.*/shell.allowlist`（本机）→ target=DESKTOP_DEVICE；
  - 同一 turn 出现两类 → 拒绝（混用落点），要求拆 turn。
- 回执校验路径与 D4 一致（tool_call→bounded_result digest、diff 事实、artifact check 归属），仅来源执行体从 Desktop worker 换成 provisioner。

## 2. Station ↔ provisioner 部署集成

- provisioner 作为独立 compose service（k8s 侧为独立 Deployment + ServiceAccount），与 station 网络策略：
  - station → provisioner：仅窄 RPC 端口（mTLS，独立服务身份）。
  - provisioner → 容器运行时：挂 docker.sock（Linux 部署）或 containerd 套接字；**只有 provisioner 挂**。
  - sandbox 网络：独立 network + egress 代理；network policy 禁止 sandbox → station/postgres/internal。
- station 容器维持现状（无 sock、非特权）。compose 增加：
  - `workspace-sandbox-provisioner` service；
  - 沙盒出网 proxy service（allowlist）；
  - workspace 卷根目录（provisioner 管理，按 sandbox_ref 命名）。
- 配置：provisioner 的镜像白名单/digest、安全模板、每 actor 配额为其自身配置，**不**接受来自 station 请求体的覆盖。

## 3. 与 Desktop 本机模式的集成

- Desktop 模式合同与 Rust worker 完全不变（D4 文件/shell、D5 TerminalSession device-held、D6 BrowserSession）。
- Desktop UI 终端/工具卡片增加只读落点标注（本机 / 沙盒 ref 短码 + 后端 kind），同一套面板与 viewer 订阅，不新增第二套终端 UI。
- Desktop 不代理 station 沙盒执行；沙盒模式下 Desktop 只是 stream/事件的展示端。

## 4. TerminalSession 双落点

- Station terminal service 按 `execution_target` 路由 create/write/read/kill/remove/reconcile：
  - DESKTOP_DEVICE → 现有 Rust worker 通道；
  - WORKSPACE_SANDBOX → provisioner PTY RPC。
- 元数据、诚实状态（RUNNING/EXITED/KILLED/UNKNOWN）、bounded output 计数、cursor 回放、viewer 关闭不杀进程的语义在两模式一致。
- reconcile 来源扩展为 {device_id} 与 {sandbox_ref}：换代后无 live proof 的一律 UNKNOWN。

## 5. 与 Browser / 长服务验证的关系

- 沙盒内启动的长服务（dev server）经 sandbox 端口暴露；Browser 验证（device 模式 Chrome/CDP，D6）与沙盒服务如何连通属于后续"browser check 绑定 artifact"能力，本模块只保证沙盒服务可受控启动/暴露/回收，不在本期定义跨域 browser 合同。
- 沙盒服务 URL 作为 turn 资源（类似 D5 的 open-url）上报，供后续 browser 验证消费。

## 6. 向后兼容与迁移

- `execution_target` 默认 `DESKTOP_DEVICE`：无沙盒能力绑定时全部走现状路径，既有行为零变化。
- proto 新字段全部可选；旧 worker 不识别沙盒落点时不会收到该类 turn（dispatch 不会路由给它）。
- `ExecutorKind_WORKSPACE_SANDBOX` 从"预留枚举"变为有执行器支撑；`STATION_HOSTED` 仍不直接跑 CLI（语义不变）。
- 不做数据破坏迁移；沙盒分配表为新增表。

## 7. 观测与审计

- provisioner 记录 allocate/exec/release 的 actor/agent/ref/image@digest/配额决定（不记密钥/完整输出）。
- Station 侧 turn/trace 记录 placement（target、sandbox_ref、binding revision），使"这条命令在哪执行、被什么隔离"可审计。
- 隔离门/不回落门事件独立可检索，供验收与事故归因。
