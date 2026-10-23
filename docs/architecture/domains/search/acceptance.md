# Desktop Search Acceptance

本轮合同为 `chat-device-search`，挂入现有 Chat Domain。只选择
`chat-device-search-contract` 与 `chat-device-search-native-e2e`；不执行
Chat 全量、Completion 或 Full。其他来源、Mobile、Station Search、Ask 与
成员移除传输不属于此合同。

业务接入由 Feature、Capability、Registry 与 Gate catalog 声明。
Native Gate 复用 `chat-storage-native` 的同 Station 双客户端、Actor Fixture、
Runtime Binding、Evidence Store 与清理。Search Core 不持有业务写操作。
此 Environment ID 表示运行拓扑和资源要求，不表示某个 env Profile。
具体 Profile、Station 地址和部署目标在运行时解析并写入 Runtime Manifest；
Search Gate 只消费已验证的 Manifest，不绑定具体 Profile 名称。
Search Fixture 为两端配置同一临时 Actor 身份密钥目录，密钥仍按 canonical
Actor key ref 隔离，以保持同窗口登录 Bob 时的身份连续性。两端设备身份、
消息数据库、缓存和客户端存储继续独立；密钥目录随本次 Fixture 根目录清理，
不进入 Git 或证据文件，也不复制展示数据来满足账号隔离断言。

一条连续 Journey 只初始化 Alice/Bob 一次：Bob 真实发送中文消息、线程回复
及 55 条历史填充消息，上传真实附件；Alice 在全局 Search 输入、翻页、打开
实际消息/线程并返回。重复、重开、退格和返回必须维持同一查询并零次来源
读取；显式刷新必须进入来源。缓存成本以最终原生日志核对，并同时要求
当前运行的 UI 截图与 DOM。
分页前须由接收端原生 Messaging owner 确认全部测试消息已同步。长数据准备前
先检查 Search 弹窗确实完成绘制；每项 UI 证据都核对弹窗透明度、动画准备态、
视口边界与命中位置。后台窗口暂停帧回调时不能以隐藏 DOM 作为可见结果。
证据捕获在原有 30 秒预算内同时等待绘制、非 loading 状态和该项业务断言；
截图与 DOM 暂存后再次核对查询、结果正文及业务断言。中途收到投影变更时
丢弃暂存帧，只有一致的帧才写入不可变 Evidence Store。缓存读取计数覆盖
证据捕获完成时点；附件断言还须在该帧结果正文中保留真实文件名。
命中断言只读取真实 `.pt-search-row` 的正文，不能用包含查询词的空结果
文案满足。每帧记录结果行数与正文，validator 从同帧原生 DOM 独立解析
结果按钮数量；分页、缓存、编辑、非法查询恢复和账号切换都必须保留
真实命中行。同窗口登录 Bob 后，该设备尚未恢复原 Bob 设备的历史；
按产品 S-05，只检索当前设备已取得的可读消息。Journey 通过该窗口的
原生 Messaging owner 在既有会话真实发送一条唯一的新消息，再通过 UI
等待其实际结果行，不能把同步期间的空结果截图计为账号隔离通过。
证据记录新消息 ID、查询、原生 Bob 身份、切换前后 read scope 与进程 ID；
validator 要求查询清空、scope 改变、进程保持和新正文实际命中。
发送与结果等待分别形成有预算的步骤，失败可定位到首个业务边界。

Bob 的真实编辑与 Alice 的 actor hide 必须使已展示结果更新或消失；
旧正文引用与隐藏引用由原生 owner 拒绝。Functions 必须打开真实 Settings，
空结果与非法查询必须可见恢复。退出后 Search 清空，在同一 Alice 原生窗口
登录 Bob 时清空查询、切换 read scope，并拒绝 Alice 的旧分页 cursor。
同一 Desktop client class 登录 Bob 会撤销原 Bob 客户端会话。Journey 必须
先记录原客户端仍为 Bob 的已认证身份，再等待原生 Identity owner 返回
`authenticated=false`、`reason=revoked`、空 Actor 和终态 phase，才将该客户端
在共享生命周期记录中标记为 revoked；validator 核对两端状态。清理不再对
已撤销会话重复执行 logout；Alice 窗口恢复分配身份后仍须正常 logout。
ResourceRef 是稳定资源地址；同资源在新账号下仍有权限时允许重新鉴权打开，
不以“换账号后一律拒绝旧地址”代替真实权限判断。

Harness 只执行辅助 Messaging 操作、取得目标 ID 与读取类型化诊断。
Search 查询、打开、返回、刷新和接收端观察均由原生 UI 驱动。禁止复制旧
展示数据库或直接 SQL 写入作为正式业务证明。
附件经同一 Messaging 发送接口上传真实文件；系统文件选择器不属于 Search
合同，不要求共享桌面会话取得独占输入。

执行入口：

```bash
make config
# 核对本次授权的 Profile、部署目标和非 loopback remote URL。
# 当前源码需形成 clean checkpoint，Station live commit / proto 需一致。
# 远程部署与 disposable Fixture reset 须有对应授权。
export PT_ACCEPTANCE_ARTIFACT_ROOT=/absolute/external/evidence-root
python3 tooling/scripts/acceptance-run.py \
  --gate chat-device-search-contract \
  --gate chat-device-search-native-e2e \
  --runtime-cell desktop-macos-native
```

只在完整 Journey、原生 validator、source identity、Evidence Store 完整性、
secret scan 与清理均有效时报告正式 `PROVEN`。结构校验、Core 测试和
`tmp/search-native/` 的开发检查不构成该结论。预检受阻保持
`BLOCKED/UNPROVEN`，不能降低 Station/client 一致性或 Fixture 授权要求。
