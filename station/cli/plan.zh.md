# Peers-Touch CLI 规划（阶段一）

## 目标与定位
- 为已有 `mobile`/`desktop` UI 提供统一命令行入口，便于自动化与运维。
- 在 `station/app` 常驻后台的前提下，`station/cli/peers.go` 作为可执行入口，调用各子服务能力。
- 阶段一聚焦“可用且稳定”的基础指令与连接能力，逐步扩展到富交互。

## 运行模型
- 守护：`station/app` 进程由 CLI 启停与健康检查，保持常驻。
- 连接：优先 P2P 直连，失败退化至 TURN；统一会话抽象（DataChannel/Media）。
- 配置：集中管理节点身份、网络与存储配置，支持热更新与持久化。

## 阶段一可实现指令

### 进程与状态
- `peers up` 启动 `station/app` 为守护进程（前台/后台模式）。
- `peers down` 停止守护进程，可选 `--force`。
- `peers restart` 重启并校验子服务健康。
- `peers status` 查看进程、端口占用、子服务状态、最近错误。
- `peers logs [-f] [--since ...]` 持续/区间查看运行日志，支持级别过滤。

### 配置与身份
- `peers config get/set <key> [value]` 管理配置（读取、变更、落盘）。
- `peers id show` 展示节点 ID、公钥指纹与命名空间信息。
- `peers id gen [--overwrite]` 生成新密钥对与节点标识。
- `peers id export/import` 进行密钥备份与恢复（加密保护）。

### 节点与网络
- `peers peers list` 列出已发现/已连接的节点，含在线状态与延迟估计。
- `peers ping <peerId>` 测试 RTT、丢包率与路径（直连/中继）。
- `peers connect <peerId> [--prefer p2p|turn]` 建立会话（含重试策略）。
- `peers stun-test` 探测 STUN/TURN 可用性与服务器延迟。
- `peers nat` NAT 类型探测与端口映射尝试，输出策略建议。

### 会话与协作（WebRTC）
- `peers chat <peerId> [-m "text"]` 通过 DataChannel 发送文本/JSON 消息。
- `peers file send <peerId> <path> [--chunk 1MB]` 发送小文件，支持分片与校验。
- `peers room create|join|leave <roomId>` 简易房间聊天（广播/私聊基础）。
- `peers call <peerId> [--audio-only]` 发起媒体会话的信令流程（阶段一不做混音渲染，仅握手验证）。

### 诊断与工具
- `peers doctor` 运行环境诊断（权限、端口、依赖、时间同步）。
- `peers metrics` 输出核心指标（CPU、内存、连接数、吞吐）。
- `peers bench [--duration 30s]` 简易带宽/吞吐测试（DataChannel）。
- `peers version` 显示版本、构建信息与插件列表。
- `peers export logs` 打包最近日志与配置快照，便于问题上报。

## 集成点（代码层面）
- 入口：`station/cli/peers.go#main` 使用现有 CLI 框架（`station/frame/pkg/cli`）。
- 守护控制：调用 `station/app/main.go` 或封装的启动器（支持前后台）。
- 配置读取：复用 `station/frame/config` 与 `station/app/conf` 的现有格式。
- 身份密钥：复用 `station/app/utils/key.go` 与 `station/frame/internal/util/key.go`。
- WebRTC/Peer：对接 `station/app/subserver/peers` 与相关信令/选路实现。
- 日志：复用 `station/frame/logger` 与插件生态（logrus 等）。

## 优先级与里程碑（阶段一）
1. 守护与状态：`up/down/restart/status/logs`（稳定性优先）。
2. 配置与身份：`config`/`id` 全链路打通（生成/展示/导出导入）。
3. 节点基础：`peers list`/`ping`/`connect`（含 STUN/TURN 落地与回退策略）。
4. 会话基础：`chat` 与 `file send`（小文件、断点校验）。
5. 诊断工具：`doctor`/`metrics`/`version`/`export logs`。

## 命令设计约束
- 一致性：参数与输出统一风格，JSON 机器可读输出通过 `-o json` 切换。
- 幂等性：重复执行不破坏状态（如 `up`/`restart`）。
- 安全性：密钥与隐私信息默认脱敏显示，导出需交互或显式 `--yes`。
- 可测试性：每个指令提供最小可用单元测试与模拟依赖。

## 后续扩展（非阶段一）
- `script run` 脚本化批量操作与自动化编排。
- 更丰富的媒体能力（录制、混流、屏幕共享）。
- TUI 界面（交互式终端 UI）。

