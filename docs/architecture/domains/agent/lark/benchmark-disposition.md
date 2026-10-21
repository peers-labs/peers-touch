# 飞书助手 — 参考能力处分

> **Status**: draft
> **Version**: v1.0
> **Created / Updated**: 2026-10-15
> **Owner**: Agent / Channel

## 可核对来源

基准客户端参考仓库 `reference-client-workspace`：

- `internal/domain/larkagent/service.go`：scope 分类、用户 profile、
  `RunAsRequester`、文档预览、OAuth 与运行资产。
- `internal/domain/larkagent/cloud_credential.go`：托管 CLI 凭据辅助边界。
- `internal/domain/channel/lark.go`：入站内容类型和平台适配。
- `internal/domain/larkagent/doc_fetch.go`：文档获取。
- `internal/domain/skill/lark_skills/lark-card/SKILL.md`：卡片工具。
- `toolings/scripts/lark-cli-image-versions.env`：公开 `larksuite/cli`
  v1.0.43 发行包引用。该引用不证明当前源码已集成或许可证评审已完成。

Peers 研究工作树 `peers-lark/feat/lark-channel`：
入站、投递、开通确认等缺口见[执行模型](../execution-plans/20261015-lark-capability-closure/plan.md)。
它不是当前执行根，也不是自动复制或恢复已删除文件的授权。

## 采纳与调整

采纳：扫码开通、自带应用、区域、完整资料、真实创建步骤和可恢复权限决策。
调整：普通用户使用一个抽屉和一个全局设置入口，不输入插件 ID 或路径。

采纳：文字/post/图片/文件、卡片、用户决定、群与话题。
调整：Station 持有 canonical admission 和投递意图，平台适配器不启动第二 Agent。
执行与投递分别恢复，重复入站和卡片动作沿用现有幂等 owner。

采纳：请求人独立 OAuth profile、授权范围和工作资料读取/操作。
调整：按实际动作申请 scope；个人凭据与 Bot、模型身份隔离。
不能沿用参考仓库的机器内部登录、共享凭据或管理员权限。

采纳：复用公开 CLI / SDK / 已登记工具的方向。
调整：逐动作验证分发、scope、身份、副作用、批准和产物。
公开资产引用、scope 列表和 SDK 的能力不能替代实际工具可用清单。

拒绝：将媒体占位、截图、scope 存在或安装成功当作功能完成证据。
拒绝：以“后期再接”为理由删除已确认的媒体、工作能力或自动化范围。

## 工作扩展 inventory frontier

参考 `defaultUserAuthScopes` 覆盖的候选命令族：
Base、多维表格的字段/记录/表/视图/表单/应用/角色/workflow，
画板，日历/日程/忙闲，联系人，
文档/comment/媒体/权限，docx，云盘，
消息/群成员/置顶/反应，邮箱，
妙记，搜索，电子表格，幻灯片，空间/文件夹，
任务/清单，视频会议/记录/笔记，知识库/成员/节点。

这是源码观察到的候选范围，**不是已经验证的动作目录**。
LARK-18C 必须继续逐命令从公开 CLI 的实际 discovery 枚举，
给每个被采纳动作登记：
稳定 ID、当前版本、公开来源与许可证、命令/API、输入输出、
scope、user/Bot 身份、只读/副作用、批准边界、恢复、接收者断言。
无法公开分发或没有可取证执行链的动作保持阻塞；不以其他示例代证。

当前该清单仍未关闭，不能冻结“所有工作扩展已完整登记”的结论。
