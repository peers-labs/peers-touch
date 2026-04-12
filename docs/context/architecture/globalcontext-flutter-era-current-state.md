# GlobalContext Flutter-Era Current State

> Historical document. This file records the Flutter/GetX-era GlobalContext implementation state and is retained only for historical reference.

---

## 1. 文档定位

本文不是当前真源。

它只记录：

- Flutter 时代 `GlobalContext` 的实现现状
- 当时的状态读取/写入方式
- 当时的初始化时序、token 链路、登出流程与已知问题

当前共享层与当前 Desktop 内核真源请看：

- `../../client/common/globalcontext.md`
- `../../client/desktop/global-context-kernel.md`

---

## 2. 适用范围

本文适用于：

- 回溯 Flutter / GetX 时代客户端实现
- 解释历史设计包袱与演进来源
- 辅助理解为何当前需要新的 GlobalContext 分层治理

本文不适用于：

- 指导当前 Desktop / Mobile 新代码实现
- 作为当前跨端共享层真源
- 作为当前平台内核真源

---

## 3. 历史实现特征

该时代实现的典型特征包括：

- `client/common/peers_touch_base/lib/context/` 作为主实现路径
- `DefaultGlobalContext` 作为唯一实现
- `Get.put`、`InitialBinding`、`SplashController` 等 Flutter / GetX 生命周期模型
- `Map<String, dynamic>` 作为大量运行时状态载体
- `GlobalContext` 同时承担 session、profile、preferences、logout 等多类职责

这些特征不代表当前主线架构，只代表历史实现状态。

---

## 4. 历史价值

保留本文的原因：

- 解释旧实现中的 token 读取链路、logout 机制和状态混杂问题
- 为当前 GlobalContext Kernel 重构提供演进背景
- 避免未来重新误把旧实现当成当前真源

如果未来不再需要追溯 Flutter 时代实现，可再评估是否归档或删除。
