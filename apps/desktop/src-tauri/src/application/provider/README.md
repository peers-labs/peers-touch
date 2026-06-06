# Provider 配置源目录说明

## 1. 目录职责

本目录是 Desktop 端 Provider 配置的源头目录，负责：

- 系统默认 Provider 配置模板；
- 用户作用域（scope）下的配置合并规则；
- Provider/Model 配置的读取、覆盖、删除语义。
- Provider 级运行时辅助能力，例如 CLI-wrapped Provider 的进程执行、超时、工作目录与环境变量控制。

本目录明确采用**纯配置文件持久化**，不使用数据库存储 Provider 配置。

## 2. 配置文件与真源

- 系统默认模板：`providers.default.yaml`
  - 打包进程序，作为每个用户的初始配置基线。
- 用户覆盖文件：`config/providers/users/<scope>/override.yaml`
  - 运行时写入，本地持久化。
  - scope 来源为会话用户标识（未登录回落 `__default__`）。

Provider 配置的真源是“系统模板 + 用户覆盖文件”的合并结果，不是数据库表。

## 3. 数据结构（override.yaml）

用户覆盖文件采用增量结构：

- `revision`：覆盖文件版本号；
- `provider_overrides`：用户新增或修改过的 Provider 全量条目；
- `tombstones`：用户删除的系统默认 Provider 的 ID 列表。

该结构用于表达“用户改动”，避免把系统模板重复写成用户快照。

## 4. 合并规则

加载顺序固定为：

1. 加载系统默认 `providers.default.yaml`；
2. 应用 `tombstones`，从默认集中移除被用户删除的项；
3. 应用 `provider_overrides`，同 ID 覆盖，不存在则追加；
4. 得到当前 scope 的最终有效 Provider 配置视图。

## 5. 写入规则

- 任何 Provider/Model 的新增、更新、删除，都会触发当前 scope 的 override 持久化；
- 系统默认模板永远只读，不被业务写入；
- 覆盖文件使用原子写，确保崩溃恢复时不出现半写文件。

## 6. 为什么不使用数据库

Provider 在当前阶段属于“配置域”而非“高频结构化业务数据”，文件化更符合本项目约束：

- 与“配置统一 YAML、协议交换 JSON”的分层一致；
- 易于审阅、追踪和迁移；
- 天然适配多用户 scope 文件隔离；
- 避免为低频配置引入额外数据库 schema、迁移与运维复杂度。

后续如出现复杂查询/审计需求，可在不改变本目录真源语义的前提下增加索引层，但配置真源仍保持在 YAML。

## 7. CLI-wrapped Provider 执行边界

CLI-wrapped Provider 属于黑盒执行能力，公共执行器只负责一致的进程边界：

- 解析命令参数并向 CLI 追加 `--model <model>`；
- 将 prompt 写入标准输入；
- 收集标准输出作为模型回复；
- 支持超时、工作目录和环境变量控制；
- 将非零退出码、stderr、启动失败和超时统一返回为 Provider 执行错误。
