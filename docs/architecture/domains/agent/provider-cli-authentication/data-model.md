# CLI 账号连接：拟新增合同

状态：draft。本文件均为 proposal；当前 provider.proto 不含这些对象，
不能将以下内容视为已有数据库或 API。

AuthCapabilities：安装版本、可用登录方式、精确 key URL、是否支持远端 revoke、
是否支持共享 Owner、凭据刷新并发能力。管理投影包含完整能力；消费投影仅给出
当前用户能否连接和合适恢复动作，不暴露 runtime argv。

AuthConnection：Owner、Provider UUID、method、state、credential_generation、
凭据格式版本、sealed_material、last_verified_at。状态是需要登录、已登录、
已失效或检查失败；安装和模型调用结果分别存储/投影。

AuthAttempt：随机 attempt_id、Owner、Provider UUID、发起会话身份、method、
state、expires_at、idempotency_key 和关联 generation。process/PTY 是运行时
资源，不持久化为可恢复的活进程。

AuthChallenge 是 oneof：

- BrowserChallenge：本次 verification_url。
- DeviceChallenge：verification_url、verification_url_complete、user_code。
- ReturnCodeChallenge：verification_url、要求的回传字段。

token、refresh token、cookie、auth 文件正文不属于 AuthChallenge。
challenge 是短期私密投影，过期或完成即不再返回；验证码提交为 write-only。
AuthAttempt 与 AuthConnection 对应 product-state-model.md 的可见状态，
不能用若干 UI boolean 代替。

拟扩展现有 Provider 管理端口：

- BeginProviderLogin(provider_id, method, idempotency_key)。
- GetProviderLogin(provider_id, attempt_id)。
- SubmitProviderLogin(provider_id, attempt_id, response)。
- CancelProviderLogin(provider_id, attempt_id)。
- GetProviderAuthStatus(provider_id)。
- DisconnectProviderLogin(provider_id, expected_generation)。

上述接口分别映射 Dashboard /ai/auth/* 和策略允许的个人 Provider 端口，
共用 Agent 应用服务。最终字段先落 model/domain/agent/provider.proto，
沿用项目生成绑定，禁止 TS/Go 各定义第二份业务状态。
