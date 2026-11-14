# pt-ew-plugin

`pt-ew-plugin` 是 Peers-Touch Development Workflow 的薄宿主适配层。它把
Codex、Cursor 和 TRAE hook payload 归一化后交给宿主中立 Workflow Kernel。
Kernel 为明确选定的当前 worktree 注入流程路由、必读文档和相关 knowledge。
非平凡开发由 `pt-god-view` 路由到 `pt-dev-workflow`；Hook 不执行研发流程，
不创建 OWNER、assignment 或操作授权。身份缺失和提示故障不能阻断普通工作。

## 边界

- canonical 源码只存在于本目录；
- 不复制 `tooling/skills/`；
- 不保存全局 current-worktree 指针，不把工具 `cwd` 当作聊天身份或永久
  worktree 绑定；
- 不修改用户全局 hooks；
- 不写 Plan、Task、Session、declaration、active-work 或 evidence；
- Hook 全程只读，不写 machine-local observation 或任何状态、回执；
- 机器诊断观察由独立的 `make dev-observe` 入口报告；
- 不替代核心 CLI 的状态与原子性校验。

## 投影

```bash
make skills IDE=codex
make skills IDE=cursor
make skills IDE=trae
```

Codex 使用 `.agents/plugins/pt-ew-plugin`；Cursor 使用带
项目 `.cursor/hooks.json`；TRAE 使用合并后的
`.trae/hooks.json`。三者都引用当前 worktree 的 canonical 文件。
多根工作区中的明确 sibling 事件不注入当前 worktree 提示。

## 验证

运行 Hook/Kernel/Adapter 测试及 `make agent-integration-audit IDE=<host>`。
Hook 回归在禁止 filesystem write 的 Node 进程中仍须返回明确流程路由；
实际宿主日志应确认事件退出码为 0、没有沙箱拒绝，并包含流程提示。
