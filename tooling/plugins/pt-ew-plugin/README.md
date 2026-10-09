# pt-ew-plugin

`pt-ew-plugin` 是 Peers-Touch Development Workflow 的薄宿主适配层。它把
Codex、Cursor 和 TRAE hook payload 归一化后交给宿主中立 Workflow Kernel。
Kernel 在第一次可阻断 `PreToolUse` 时原子创建稳定 OWNER identity；每个
mutating OWNER Action 再独立选择一个 workspace，并把工具目标作为
`subjectRoot` 校验。一个 Action 不能跨多个 worktree 写入，assigned child
不能离开 assignment workspace。
通过身份、declaration 和 source scope 校验的写入，会附带由共享架构治理
parser 生成的只读 Context Receipt；该回执只提供必读文档与 knowledge
定位，不改变授权结果。

## 边界

- canonical 源码只存在于本目录；
- 不复制 `tooling/skills/`；
- 不保存全局 current-worktree 指针，不把工具 `cwd` 当作聊天身份或永久
  worktree 绑定；
- 不修改用户全局 hooks；
- 不写 Plan、Task、Session、declaration、active-work 或 evidence；
- 只写 machine-local conversation binding、Anchor receipt 和 release receipt；
- 不替代核心 CLI 的状态与原子性校验。

## 投影

```bash
make skills IDE=codex
make skills IDE=cursor
make skills IDE=trae
```

Codex 使用 `.agents/plugins/pt-ew-plugin`；Cursor 使用带
`failClosed: true` 的 `.cursor/hooks.json`；TRAE 使用合并后的
`.trae/hooks.json`。三者都引用当前 worktree 的 canonical 文件。
