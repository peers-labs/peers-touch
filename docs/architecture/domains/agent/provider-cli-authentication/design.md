# CLI 账号连接：架构草案

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-31 | **Updated**: 2026-10-31
> **Owner**: Peers-Touch Agent Team

本设计扩展既有 Provider Owner 合同，未生效。产品入口由 product-definition.md
决定；安装、模型授权和 API key 存储继续采用现有所有者。

## 所有权与链路

登录会话属于 Provider 的显式 Owner。共享资源只允许当前 Dashboard 管理员
发起，个人资源只允许其 Actor 且必须满足既有个人策略。UI 不传 actor/scope
选择器；服务端从已验证会话和资源身份解析 Owner。

动态请求路径：当前详情的登录动作 → Dashboard 或 Native Rust 的鉴权传输
→ Agent 登录服务 → 该版本 vendor adapter → 官方 CLI。
供应商挑战由 adapter 转为结构化授权地址、设备码或回传码要求，用户在自己
的浏览器授权；CLI 完成后由 Agent 检查并保存登录结果，原页刷新模型。
Model 是共享合同，客户端浏览器不运行 CLI。

不建立任意 shell 代理，不替供应商实施密码登录，不复制整个 HOME。
登录、鉴权检查、模型发现和执行必须使用同一绑定的登录身份，不能登录到 A
目录、实际运行却读取 B 目录。

## Adapter 合同

现有 CLI adapter 能力增加：supported_auth_methods、版本适用条件、
begin/status/submit/cancel/logout、鉴权检查、批准的凭据文件或 keyring 投影、
凭据刷新提交语义。供应商命令为静态注册 argv，客户端不能提交任意命令。

挑战是封闭类型：浏览器授权、设备授权、回传码授权。只转交该任务产生的
HTTPS 授权链接，按 adapter 的供应商域名允许列表验证；不猜测、重写 redirect_uri。
回传字段类型由任务决定，限长并只通过本任务的私密 stdin/PTY 输入。

协议不能适配的安装版本返回 unsupported 并提供准确恢复方式。
Codex 设备授权实际失败和 Claude Console 全局 profile 存储先作为待证明能力，
不能在未知隔离条件下开启。

## 持久化与执行

复用 Station Secret Envelope/KEK。登录任务在 0700 staging 状态中运行，
完成后只提取该 adapter 声明的凭据材料，加密绑定 Owner、Provider UUID、
凭据 generation 和格式版本；未完成的材料不得激活。

普通调用和发现仅获得该已授权 Owner 的登录材料，在执行 Actor 的私有目录中
使用专用凭据投影，聊天、cache、settings 不共用。CLI 写回的刷新材料由同一
凭据 Owner 进行 generation/CAS 提交，退出时清理暂存明文。

对于不能独立控制刷新、会写回同一登录材料的 CLI，账号登录执行使用该凭据
绑定的独占运行 lane，队列与等待均有界且可见；API key 方式沿用现有执行策略。
共享登录的并发刷新与凭据隔离未证明前，不提升并发，也不宣称供应商账户能够
安全共享。详细取舍见 decisions.md。

## 生命周期

按 Owner + Provider 去重登录任务，同一 idempotency key 返回原任务。
任务有 deadline；取消、登录过期、权限撤回和 Station shutdown 回收整个进程组。
重启后持久登录重新检查，在途任务标记中断，不能让不存在的 CLI 进程继续等待。

重登录只暂存新材料，检查成功后原子替换；失败保留有效旧登录。
注销撤销当前 generation，取消该资源的登录任务，移除私有投影，
后续分发再次检查授权和登录 generation。厂商远端 revoke 能力由 adapter
声明，缺失时明确区分本地移除与远端撤销，不伪造远端注销成功。

授权挑战读取和提交每次验证发起会话、Owner、Provider 与 attempt；旧 Session
不能获取新链接或提交验证码。此范围沿用既有同账号新登录撤旧会话行为。
挑战与验证码不进入日志、普通消费列表或错误详情。

## 验证条件

入口可点击、真实授权 challenge、完成登录、真实检查、模型调用、重新登录、
取消、过期、重启和注销均分别有验收。API、单元测试和模拟原型不替代真实
供应商 OAuth 完成。未拿到供应商授权时报告 BLOCKED，不关闭该能力。
