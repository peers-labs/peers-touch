# Tasks
- [x] Task 1: 设计并固化新契约（manifest v2 + bridge protocol v2）
  - [x] SubTask 1.1: 定义 applet.json 必填字段、权限字段与版本字段
  - [x] SubTask 1.2: 定义 index.json 聚合结构与完整性校验字段
  - [x] SubTask 1.3: 定义 Lynx Bridge 请求/响应与错误码规范
  - [x] SubTask 1.4: 在 packages/applet-sdk 与 host 侧对齐协议类型

- [x] Task 2: 在 Rust 侧实现 Applet Capability Gateway（替换 stub）
  - [x] SubTask 2.1: 在 tauri applets 命令层新增统一 invoke 入口
  - [x] SubTask 2.2: 建立 capability registry 与 deny-by-default 权限校验
  - [x] SubTask 2.3: 复用现有错误码模型输出标准错误
  - [x] SubTask 2.4: 增加审计日志（applet_id/session_id/request_id）

- [x] Task 3: 切换 Desktop 运行时到 Lynx Host（移除 iframe）
  - [x] SubTask 3.1: 用 Lynx Host 组件替换当前 iframe 容器实现
  - [x] SubTask 3.2: 重构 AppletRuntimePage，仅保留加载与生命周期管理
  - [x] SubTask 3.3: 清理前端 postMessage 分发逻辑
  - [x] SubTask 3.4: 保留 pin/open 等主程序导航行为不回退

- [x] Task 4: 将 packages/applets 产物链升级为强校验加载
  - [x] SubTask 4.1: 构建脚本输出 v2 index.json 与 manifest 校验结果
  - [x] SubTask 4.2: 开发同步脚本保持与构建一致的产物结构
  - [x] SubTask 4.3: 主程序加载前执行 schema 与版本兼容检查
  - [x] SubTask 4.4: 非法 applet 拒载并输出可诊断信息

- [x] Task 5: 下线旧链路并完成迁移收尾
  - [x] SubTask 5.1: 删除 iframe 方案与旧桥协议代码路径
  - [x] SubTask 5.2: 删除兼容分支与历史入口，确保单链路运行
  - [x] SubTask 5.3: 更新 Desktop/Applet 开发文档为 Lynx 方案
  - [x] SubTask 5.4: 提供迁移说明（旧 applet 升级 checklist）

- [x] Task 6: 完成验证与回归
  - [x] SubTask 6.1: 添加契约测试（schema、版本、权限）
  - [x] SubTask 6.2: 添加运行时冒烟测试（加载、调用、拒绝路径）
  - [x] SubTask 6.3: 执行 desktop 编译与关键路径回归验证
  - [x] SubTask 6.4: 验证“无 iframe、无 postMessage 旧桥”约束

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1 and Task 2
- Task 4 depends on Task 1
- Task 5 depends on Task 3 and Task 4
- Task 6 depends on Task 2, Task 3, Task 4, and Task 5
