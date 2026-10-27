# Mobile Scan Login — Experience

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

## MSL-J01：新手机登录

Desktop入口：全局Settings → 账号与设备 → “在手机上登录”；
已登录账号菜单可提供同动作快捷入口。不能放进Agent/Chat工作区。

在一个固定大小的聚焦面板中显示账号头像、账号名、Station友好名称、
大二维码与“用 Peers Touch 手机端扫一扫”。二维码区域的大小在生成、等待、
过期和授权状态间保持稳定。连接细节折叠，主界面不出现IP、grant或协议拓扑。

Mobile登录/Station选择首屏直接提供“扫描电脑上的登录码”，不用先填写Station。
系统camera权限按需请求；扫码识别后暂停摄像头，自动检验并连接，
显示目标账号和Station，进入“请在电脑确认”。

Desktop显示“允许这台手机登录？”、设备声明和双方相同的短核对码，
唯一主要操作为“允许登录”，次操作“拒绝”。多个claim时选择与手上手机匹配的一台。
必要时先按已有本机锁定/PIN策略解锁，不能弹出无关额外注册表单。

Station要求terms等动作时，Mobile在原Gate Host完成。
确认成功后Mobile通过原PIN设置/解锁流程进入Desktop式全局Shell入口；
Desktop显示“手机已登录”，并提供现有设备管理入口。
完成区域提供“添加另一台设备”；点击为同账号签发新码。
多部已授权手机可同时在线，后续授权不替换先前手机。

## MSL-J02：路线失败

自动Direct→Relay切换只显示“正在连接站点”，细节里允许查看路线。
全部失败显示“手机暂时无法连接此站点”，主操作“重试”，
辅助文案建议手机和电脑连接同一网络。Relay配置引导只面向站点管理员。
不得让用户改抄一长串站点、端口与证书。

## MSL-J03：重登与账号切换

同scope重复扫码不重复创建设备或会话。
Mobile已登录别的账号时，先明确提示将切换；取消保留当前账号。
已有其他手机登录不提示takeover、不踢出其他设备。同device重新认证/会话轮换
只作用于本设备；设备数量策略若拒绝新增，明确显示原因并进入设备管理。
不同Actor身份密钥冲突引导原恢复入口，禁止静默覆盖。

## MSL-J04：退出、过期与抢扫

关闭Desktop面板明确结束本次码；Mobile取消只取消自己的申请。
过期在原码区显示“登录码已过期”及“刷新”；刷新使旧码失效。
有申请时不自动刷新掉核对上下文。Desktop换账号/锁定/退出立即失效授权。
另一手机抢扫不自动获准，也不隐蔽替换当前核对设备。
拒绝/取消本次申请不会撤销该账号的其他手机。单设备撤销只能影响选定设备；
“退出所有设备”是独立明确操作，不与刷新二维码或新增设备混用。

## 工艺与平台合同

继承[Auth UI Identity](../../../../client/common/ui-identity/modules/auth/README.md)、
[Mobile Station交互](../../../../client/mobile/station-selection-interaction-contract.md)、
[Craft Quality](../../../../client/common/ui-identity/craft-quality.md)。
签名特征是带头像的Peers二维码与真实目标Station，不添加动画网络仪表盘。

Desktop沿用LobeUI聚焦面板；Mobile沿用底部任务重心、safe-area和原登录底色。
一个状态一个主动作；状态提示不仅靠颜色；禁止扫描线、呼吸光、闪烁和码图形变。
头像失败使用无头像标准码，不能影响载荷或身份。

必须覆盖窄屏、长中文/英文名称、放大字体、键盘/读屏、对比度、触控、
reduced-motion和前后台切换。扫码画面有可读“关闭”及“改用原登录方式”。
相机不得在后台或面板关闭后保持占用。

原型与实现的视觉/动态/原生证据仍为 UNPROVEN；使用 Prototype Lib 和既有
UI Identity 验证上述状态，不能只看一张成功截图。
