# Desktop Search Acceptance

本轮合同为 `chat-device-search`，挂入现有 Chat Domain。只选择
`chat-device-search-contract` 与 `chat-device-search-native-e2e`；不执行
Chat 全量、Completion 或 Full。其他来源、Mobile、Station Search、Ask 与
成员移除传输不属于此合同。

业务接入由 Feature、Capability、Registry 与 Gate catalog 声明。
Native Gate 复用 `chat-storage-native` 的同 Station 双客户端、Actor Fixture、
Runtime Binding、Evidence Store 与清理。Search Core 不持有业务写操作。

一条连续 Journey 只初始化 Alice/Bob 一次：Bob 真实发送中文消息、线程回复
及 55 条历史填充消息，上传真实附件；Alice 在全局 Search 输入、翻页、打开
实际消息/线程并返回。重复、重开、退格和返回必须维持同一查询并零次来源
读取；显式刷新必须进入来源。缓存成本以最终原生日志核对，并同时要求
当前运行的 UI 截图与 DOM。

Bob 的真实编辑与 Alice 的 actor hide 必须使已展示结果更新或消失；
旧正文引用与隐藏引用由原生 owner 拒绝。Functions 必须打开真实 Settings，
空结果与非法查询必须可见恢复。退出后 Search 清空，在同一 Alice 原生窗口
登录 Bob 时清空查询、切换 read scope，并拒绝 Alice 的旧分页 cursor。
ResourceRef 是稳定资源地址；同资源在新账号下仍有权限时允许重新鉴权打开，
不以“换账号后一律拒绝旧地址”代替真实权限判断。

Harness 只执行辅助 Messaging 操作、取得目标 ID 与读取类型化诊断。
Search 查询、打开、返回、刷新和接收端观察均由原生 UI 驱动。禁止复制旧
展示数据库或直接 SQL 写入作为正式业务证明。

执行入口：

```bash
make config
# 核对 three / station-three / 非 loopback remote URL。
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
