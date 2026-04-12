# Client Common: GlobalContext Shared Semantics

> Platform-level source for what `GlobalContext` means as a cross-client shared abstraction, and where its boundaries stop.

---

## 1. 文档定位

本文定义：

- `GlobalContext` 作为客户端共享抽象时，应该表达什么语义
- 哪些状态适合纳入全局上下文
- 哪些能力属于共享语义，哪些能力属于平台内核实现
- `client/common` 与具体平台实现之间的边界

本文不定义：

- Desktop 内核如何具体实现 `GlobalContext`
- Flutter 时代历史实现细节
- 某个平台的具体 store、command、事件总线代码结构

继续阅读请看：

- `../desktop/global-context-kernel.md`
- `../../context/architecture/globalcontext-flutter-era-current-state.md`

---

## 2. 为什么需要 GlobalContext

`GlobalContext` 的目标不是变成“万能全局对象”，而是承载客户端运行时中那些：

- 具有全局可见性
- 跨页面、跨模块会被读取或编排
- 不适合散落在单个 feature 内部
- 需要被统一治理、统一恢复、统一观察

的共享上下文语义。

---

## 3. 共享语义边界

适合纳入 `GlobalContext` 的共享语义通常包括：

- 当前身份与会话概况
- 运行时环境状态（如网络、workspace、runtime mode）
- 跨模块任务与通知语义
- 全局能力可用性语义
- 全局级别的编排输入与编排结果快照

不适合纳入 `GlobalContext` 的内容包括：

- 单个 feature 的局部 UI 状态
- 某个页面独占的交互临时态
- 领域内部的完整业务规则
- 可以被更局部 store 清晰承载的细粒度状态

一句话：

- `GlobalContext` 承载全局共享语义，不承载所有状态本身。

---

## 4. 共享层与平台层的关系

`client/common/globalcontext.md` 只定义共享语义层。

这意味着：

- 它回答“哪些东西应该被视为全局上下文”
- 它不回答“Desktop 里用哪个 store、哪个 Rust command、哪个 pipeline 来落地”

因此当前分层关系是：

- 共享语义真源：`docs/client/common/globalcontext.md`
- Desktop 内核实现真源：`docs/client/desktop/global-context-kernel.md`

这两份不是重复，而是抽象层与平台实现层的上下游关系。

---

## 5. 与当前平台现实的关系

当前代码中，Desktop 已经拥有一套新的 GlobalContext Kernel 主线，包括：

- `context_snapshot_get`
- `context_action_dispatch`
- `apps/desktop/src/kernel/global-context/*`

因此：

- 当前实际最成熟的 `GlobalContext` 落地在 Desktop
- 但这不意味着共享层文档应直接退化成 Desktop 实现说明
- 共享层仍然需要保留，用来定义哪些语义是跨平台可复用的

---

## 6. 当前约束

1. 不再以 Flutter / GetX 时代实现作为当前真源。
2. 新的共享层定义必须与 `Station 为共享业务真源` 的边界保持一致。
3. 平台实现可以扩展自己的运行时机制，但不能改写共享语义边界。
4. `GlobalContext` 不应成为“第二业务后端”或“万能状态桶”。

---

## 7. 与其他文档的关系

- 如果你在定义跨客户端共享语义，看本文。
- 如果你在定义 Desktop 内核实现，看 `../desktop/global-context-kernel.md`。
- 如果你在追溯 Flutter 时代旧实现，看 `../../context/architecture/globalcontext-flutter-era-current-state.md`。

---

## 8. 继续阅读

- [Desktop Global Context Kernel](../desktop/global-context-kernel.md)
- [Client Common Base](./base.md)
- [Flutter-Era Historical State](../../context/architecture/globalcontext-flutter-era-current-state.md)
