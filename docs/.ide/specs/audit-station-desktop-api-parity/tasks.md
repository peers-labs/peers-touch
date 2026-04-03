# Tasks
- [x] Task 1: 盘点 Station 对外接口清单（排除 applets 与 llmbox）
  - [x] SubTask 1.1: 按业务域提取 `apps/station/app` 对外路由与命令入口
  - [x] SubTask 1.2: 标记每个接口的用途与证据代码位置
  - [x] SubTask 1.3: 过滤并剔除 applets/llmbox 相关项

- [x] Task 2: 盘点 Desktop 现有能力清单
  - [x] SubTask 2.1: 提取 `apps/desktop` 前端服务层 API 封装
  - [x] SubTask 2.2: 提取 `apps/desktop/src-tauri` 命令暴露清单
  - [x] SubTask 2.3: 按业务域归类并去重

- [x] Task 3: 生成接口映射矩阵与差异结论
  - [x] SubTask 3.1: 建立 station→desktop 一对一/一对多/缺失映射
  - [x] SubTask 3.2: 标注“已对齐 / 未对齐 / 不在范围”
  - [x] SubTask 3.3: 为未对齐项补充证据与影响级别

- [x] Task 4: 输出补齐优先级建议
  - [x] SubTask 4.1: 给出高优先级缺口（影响核心主流程）
  - [x] SubTask 4.2: 给出中低优先级缺口（运营/辅助能力）
  - [x] SubTask 4.3: 形成下一阶段实施建议列表

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1 and Task 2
- Task 4 depends on Task 3
