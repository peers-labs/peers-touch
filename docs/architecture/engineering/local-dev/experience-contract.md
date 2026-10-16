# Workflow Snapshot 体验契约

> **Status**: active
> **Version**: v4.0
> **Updated**: 2026-10-13
> **Owner**: Platform Team

## User Journey

```bash
make workflow-snapshot
```

命令输出一个有界 JSON 文档后退出，不启动服务、不监听端口、不打开浏览器。

## Information Hierarchy

每个 workspace 按以下顺序表达：

1. canonical root、workspaceId、branch、HEAD、dirty；
2. 明确存储的 task 列表；
3. task-local corruption 或 source-stale finding；
4. 调用方可选提供的 runtime 状态；
5. snapshot 自身错误与摘要。

不按 branch、mtime、聊天历史或 Plan 数量推断当前任务。

## Safety

- Snapshot 只读，不写 Git、task、registry、Profile、runtime、lease 或 evidence。
- 单个 task 损坏不影响其他 task；单个 workspace 不可读不影响其他 workspace。
- Snapshot 不授予写入、部署、reset、资源占用或完成证明。
- 再次运行从当前源码和 task snapshot 重新计算，不存在轮询缓存。

## Acceptance

- 输出一个 JSON 文档并退出。
- 当前 Git 身份来自本次读取。
- task 恢复、损坏隔离和 source evidence 失效有直接测试。
- 命令不创建 listener、PID、端口、runtime lease 或后台进程。
