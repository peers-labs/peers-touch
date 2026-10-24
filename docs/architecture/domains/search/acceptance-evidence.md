# Search 原生证明快照

> **Status**: active
> **Owner**: Search / Chat business injection
> **Snapshot**: `3fd0225cee5366d8143b742b20d99f49e8dbf051`
> **Branch**: `analysis/android-platform-alignment`

这份索引记录已执行的端侧里程碑，不把旧 PASS 继承到后续源码。
源码、运行实例、provider、oracle 或 action plan 变化后，提交审查必须重新
取得当前快照证明。完整跨来源 Search、Chat 全量或整个分支的 Acceptance
不能由所选 Search Gate 推导。

## 证据定位与绑定

证据存于仓库外的规范 Evidence Store，workspace ID 为 `8b99621815d8a125`。
使用对应 task 的 artifact root 与不可变 run ID 定位 `reports/run.json`；
manifest、逐文件摘要及 native build attestation 共同绑定上述源码。
运行产物、账号凭据、设备状态与截图不进入 Git。

- Mobile task：`mobile-device-search`。
  正式 run：`20261023T194530816976Z-c8fcbf76c334e63b7faf57ff2283db92`；
  native Gate：`20261023T194530960606Z-7ffa62037a4d846bbda101355ee2eff5`。
  `chat-mobile-device-search-native-e2e` 与
  `chat-device-search-contract` 为 PASS；iOS Simulator 与 Android Emulator
  各完成检索及账号场景，共四场景，640.768 秒。
- Desktop task：`desktop-device-search`。
  正式 run：`20261023T200445486946Z-a2212f29e6b86152c4059ce3fa58c971`；
  native Gate：`20261023T200445627402Z-2a6a5760505aea21586a56cb6c675fdc`。
  `chat-device-search-native-e2e` 与
  `chat-device-search-contract` 为 PASS；macOS 连续 Journey 有 26 项断言，
  其中 17 项为 UI 断言，343.825 秒。

环境为已审查的 `three` Profile、同一远程 Station 与隔离客户端。
Development 检查先于正式 Gate 通过；完整性、Suite 生命周期、所选缺口与
六项收口义务审查通过，均为辅助证据。产品证明来自上述正式 native Gate。
Mobile 完整性审计核验 118 个不可变引用、238 个文件及 44 个断言画面；
Desktop 核验 54 个引用和 69 个文件。所持有的运行资源释放检查通过。

## 已证明的范围

全局/会话检索已取得的中文正文、线程回复和附件名称；打开原消息/线程，
返回保留查询、筛选、分页和位置；分页、刷新、空/错误恢复、真实 Settings、
中英文、深浅色及原生键盘边界均进入双端原生 Journey。
账号场景包含当前账号内容检索、旧结果清除及旧 cursor 拒绝。
Mobile 样本先由对端发送并精确接收提交，再通过真实 Search UI 检索。
Desktop 回归还核对原业务变更后的缓存失效与权限拒绝。

Shell 持有入口和详情栈，Search 持有查询/返回上下文，Messaging 持有正文、
权限、投影与原对象定位。原生权限校验和 UI 断言分别提供证据，不能互相替代。

## 未证明的范围

实际硬件、OEM、VoiceOver/TalkBack、OS 后台/锁屏、现场性能、跨 Station、
身份/历史恢复、Applet 来源、Station Search、Ask、全域混合排序和完整
V-01～V-10 保持 UNPROVEN。登录成功不证明另一安装实例的旧加密历史已恢复。
Mobile 的同账号后台恢复实现也不等于已取得 OS 后台/锁屏产品证明。

契约与执行入口见 [Desktop Acceptance](./acceptance.md)、
[Mobile Acceptance](./mobile-acceptance.md) 和
[实际效果](./execution-plans/20261022-device-search-find-open/outcome-comparison.md)。
