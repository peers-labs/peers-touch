# CLI 账号连接：验收合同草案

状态：draft。以下是要求，全部未执行，不能声明通过。

PCA-A01 / J01：点击“登录 X”产生该 CLI 实际供应商地址，能在用户浏览器打开；
拦截自动弹窗后仍能点击本页链接，不要求 SSH 或寻找 CLI 文件。

PCA-A02 / J01：设备授权显示本次设备码；回传授权可在本页输入要求字段；
结果绑定同一 Provider、Owner、attempt 和 generation。

PCA-A03 / J01：真实供应商授权完成后，状态检查成功；刷新模型并完成一次真实
授权模型调用。模型调用失败只报告该调用失败，不改写已登录事实。

PCA-A04 / J02：再次点击去重；切换服务商/账号、退出、权限撤回、
验证码过期后旧响应不能覆盖当前状态，也不能继续提交旧 challenge。

PCA-A05 / J02：重新登录失败或取消保留有效旧材料；成功原子替换旧 generation，
后续调用使用新材料。

PCA-A06 / J03：取消/关闭 Station 回收本次 CLI 进程组；
重启恢复持久登录，在途任务变为中断并提供重新登录。

PCA-A07 / J03：断开后缓存、私有凭据投影和下一次分发均不可继续使用旧 generation；
区分本地移除和供应商远端 revoke。

PCA-A08：Alice/Bob、共享 Owner/个人 Owner、CLI HOME/keyring 均验证隔离；
共享 grants 撤销不能 fallback；未知 vendor profile 存储不能偷偷开启。

PCA-A09：不透明刷新使用独占 lane 时等待即时可见、可取消、受预算限制；
登录替换、注销和调用刷新并发不会提交旧材料。

PCA-A10 / J04：点击精确 key 页面可直接创建供应商 key，回到原详情保存；
key 不进入 GET、日志、错误正文或 URI。

PCA-A11：版本不支持、设备授权请求失败、供应商拒绝、模型无权限、网络超时
各有可执行恢复动作。没有 valid vendor authorization 时报告 BLOCKED。

PCA-A12：键盘、焦点返回、窄屏、中英文、暗色、减少动效与 live region
都在实际 Dashboard 或 Native Settings 验证；模拟截图不证明 OAuth 完成。

实现复用现有 CLI / Provider Gate 所有者，只测本能力。当前阶段不运行全量测试、
不生成伪造登录凭据或把启动探测升级为正式 Acceptance。
