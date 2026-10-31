# 模型服务生命周期线框

状态：drafting。对应 `lifecycle-contract.md` LC-01 至 LC-06。
这是低保真交互候选，没有 high-fidelity admission、独立 review receipt
或用户确认。既有 Shell 的其他功能状态不因该候选改变。

运行：`make run-prototype`。使用已经注册的 Desktop / Station Dashboard：

- `?site=dashboard&wireflow=model-service`：管理员模型服务。
- `?site=desktop&wireflow=model-service&actor=alice`：Alice 我的模型。
- `?site=desktop&wireflow=model-service&actor=bob`：Bob 我的模型。
- `?site=desktop&wireflow=model-service&actor=alice&surface=agent`：Alice 模拟对话。

源码：`packages/prototypes/shared/modelServiceWireflow.ts` 的单一 Owner 图，
`ModelServiceWireflow.tsx` 的交互线框；由现有 Dashboard、Desktop Settings
与 Agent 路由接入。没有增加 Desktop 独立卡片、基础库或后端接口。
使用现有 Ant Design / design-tokens，延续 Shell 全局导航和设置层级。

初态 Codex 已安装但未登录，Cursor 未安装，API 尚未配置；Alice 与 Bob
无可用模型。管理员选择 Codex，登录并在模拟授权页批准，验证默认选择，
分配 Alice，进入 Alice Desktop，选择默认并发送演示消息。
再进入 Bob 看空态，或撤销 Alice、模拟共享连接过期验证失效与恢复。
API 支持保存与检查分离，并可以分别验证、分配两个演示模型。

原型顶部与场景控制均明确模拟用途。不输入真实 key、不调用真实厂商、
不把模拟回答当正式验收。节点离线、调用失败、授权失败/过期/取消可触达。
草稿、默认与连接/验证/grant 图在同一浏览器 origin 的切换/刷新后保持。
“重置演示”仅清除此候选的 localStorage，不影响既有原型数据或 Station。

当前无 Settings/模型服务专属 UI Identity，复用 shared UI ID 和 Agent
模块合同。内容层为单一服务详情，操作层显示当前下一步；授权由同一详情
拥有浮层，失败在固定状态区域恢复。没有新增装饰或独立模块视觉体系。

未证明：真实供应商 OAuth、凭据持久化/刷新/隔离、Node 重启、真实模型
费用与额度、原生消费 E2E、辅助技术、暗色及国际化扩展。线框不能证明当前
生产页面已经修复，不能作为实现完成、可发布或可合并的依据。
