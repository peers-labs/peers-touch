# CLI 账号连接：接入边界草案

状态：draft。这里只定义既有系统如何服从合同，不定义执行阶段或任务顺序。

- Catalog：补齐实际版本登录能力及精确 key 链接；TRAE 不再投影通用 key 输入。
- Agent：现有 ProviderManagementPort 调用账号连接 Owner，复用 Owner 解析、
  Secret Envelope、私有环境构建及进程回收，不建立第二套安装或权限服务。
- RuntimeAdmissionResolver：在原来的模型与 grant 检查外，解析显式登录绑定；
  不允许凭据缺失时同名个人 fallback，generation 变化使旧运行材料失效。
- CLI executor / model discovery：使用同一个 adapter 凭据投影，不继承主机登录；
  刷新写回交给同一凭据 Owner。
- Dashboard：AIProviderSettings 按 AuthCapabilities 呈现账号连接或 key 方式；
  AIInstallers 只负责安装状态。“已安装”不得标成账号已连接。
- Desktop 个人 Provider：复用既有 Settings 的可见 schema、Tauri transport 和
  Session fence，只补本人登录与恢复按钮。共享消费者保持只读与个人默认操作。
- Proto：Begin/Get/Submit/Cancel/Status/Disconnect 先定义共享合同，再生成绑定。
- 原型：接入现有 Prototype Lib 与 Settings shell；真实授权 API 不连接到模拟原型。
- 用户文档：更新 dashboard-ai-management.md 的完整登录步骤，独立于架构文档。

当前安装策略、资源 grants、模型默认与普通用户控制面边界保留。
新的账号材料格式、状态与恢复合同确认后才写入 active 文档和 operational knowledge。
