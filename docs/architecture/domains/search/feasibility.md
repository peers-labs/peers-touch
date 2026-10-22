# Search 架构可行性研究

> **Status**: component-study-complete / product-unproven
> **Date**: 2026-10-22
> **Owner**: Search / Client / Station
> **Scope**: [设计草案](./design.md) 的组件实验、接入合同实验及源码核对。产品与架构仍为 draft；本文不授予生产实现或发布权限。
> **Scope update 2026-10-22**：检索宇宙已按用户决策收窄为 Peers-Touch 封闭域（D-19）。本文记录的公网 RSS 请求与受控 OS 目录边界实验仅保留为历史机制证据，不代表公网搜索或 OS 文件检索仍是产品能力；相关机制结论只迁移到域内附件权限与边界设计。

## 1. 结论与适用范围

“一份来源协议、Client/Station 两级执行、复用原域索引和权限”的基础架构具有实测支撑。现有 SQLCipher/FTS5 和 PostgreSQL 可以承载本地受保护全文检索与服务端授权候选；受控文件边界、删除/撤权、查询身份失效与结果融合的关键机制可以独立实现。没有证据要求现在新增一种业务数据库或自研搜索引擎。[实验记录](./feasibility-evidence.md)

AI 部分需要区分执行能力与检索质量。真实多语种 E5 模型可以在本机 CPU 执行，查询向量延迟为毫秒级；本轮中文自然语言检索英文/混合架构文档的效果不满足默认方案：六个预先固定的问题，预期文档进入前五仅 2/6，简单混合排序为 1/6。同一问题的英文诊断达到 6/6，说明不能把“支持多语言”当作跨语言召回已经达标。模型、双语分析器、分块与重排仍需选型。

Desktop/Mobile 搜索与打开 Journey、域内附件随父对象授权的完整生命周期、Federation 按需查询、Agent 问答和真实 actor 权限链尚未验证；公网搜索与 OS 文件检索已按 D-19 移出范围，不再作为待验证能力。当前结论是封闭域的组件与合同机制可行，完整产品仍为 **UNPROVEN**。

## 2. 方法与证据身份

实验在 Apple M5 Pro、48 GiB RAM、18 个逻辑 CPU、macOS 26.6.2 上执行。文档工作树为 `peers-touch`，HEAD `fac77ca549f862c0a41bf9f56da2a0db4b61a045`；14 份真实项目文档共 269,899 字节，另取 300 份不同架构文档共 5,785,099 字节进行全文检索规模实验。每个文件的路径、字节数及 SHA-256 保留在原始 JSON。

SQLCipher 使用已有 `peers-android` 构建产物；新增源码核对工作树 HEAD 为 `8700605d0260614c7334df417b664b5a366f99d6`。静态 archive 的存在不证明其对应此 HEAD 的完整构建，本实验只声明实际加载的库版本。没有启动生产 Search、真实用户会话或原生客户端。

证据分为：

- **COMPONENT**：实际库、数据库、模型、受控文件读写；历史公共网络请求只作机制证据。
- **CONTRACT**：独立小型协调器与 SQL 生命周期机制；使用真实文档引用，不属于生产 Rust/Go 实现。
- **SOURCE**：指定源码快照中可复用的接口与缺口。
- **UNPROVEN**：缺少真实 runtime、真实 actor 身份或产品可见证明的能力；公网/OS 文件能力按 D-19 属范围外而非 UNPROVEN。

性能是单机重复采样结果，包含实验适配层开销；不同实验不用于直接比较引擎优劣。小语料、强设备和有限查询不能外推成产品 SLA、手机资源预算或百万对象吞吐。

## 3. 本地受保护全文检索

实际加载 SQLCipher `4.5.7 community` / SQLite `3.45.3`，在加密数据库中创建 FTS5 并查询真实文档。300 份文档的分词与索引写入耗时 **2,827.084 ms**；80 次查询 P50 **0.768 ms**、P95 **2.883 ms**、P99 **2.997 ms**。含多种实验索引的数据库为 **10,326,016 字节**，该体积不是生产单一索引的膨胀率。

删除后指定对象的词项不再命中；revision/tombstone 阻止迟到 upsert；候选产生后移除读授权，hydration 不再返回对象。数据库重新打开仍能读取 300 个对象，错误密钥被拒绝，文件头不为 SQLite 明文头且指定正文标记未出现在数据库字节中。以上支持加密索引与否定读取机制，未覆盖生产密钥生命周期、WAL/备份取证擦除或断网撤权。

中文限制已复现：`用户授权目录文件检索` 在默认 `unicode61` 下无法用 `目录` 命中；Jieba 分词后可以。八个明确关键词探针中，预期文档进入前十从 **5/8** 提高到 **8/8**。这不是完整 Recall@10；姓名、ID、短语、拼写错误和跨语言自然语言需另一组标注语料。[FTS5 tokenizer 合同](https://sqlite.org/fts5.html#tokenizers)

架构含义：继续由 Messaging 持有其原加密索引，Search 通过 native provider 查询；域内附件等其他 D/S 区真源使用各自受保护投影并随父对象授权。生产 analyzer 必须同时处理短词/长句与混合语言，并保存原文 anchor，不能把分词后的串直接当预览正文。Jieba 是验证工具，不是已经选定的 Rust/Go 生产依赖。

## 4. Station 索引与授权

独立 PostgreSQL `16.15` 使用 UNIX socket，未开放 TCP。14 份真实文档完成 `tsvector + GIN` 建索引与查询；80 次重复查询 P95 **0.084 ms**。`EXPLAIN` 在强制关闭 sequential scan 的诊断下显示 GIN Bitmap Index Scan，证明该查询形式能使用索引，不证明优化器在生产规模必然选择它。

不同受控 reader 的 SQL 授权过滤与候选后撤权检查通过；`simple` 同样复现中文短词遗漏，预分词后命中。reader 是实验标签，不能替代 Peers actor/session、Social 父对象 policy 或 Federation 权限证明。[PostgreSQL 全文检索](https://www.postgresql.org/docs/16/textsearch.html)

`pg_trgm` 可加载，`pgvector` 不在此安装环境的可用扩展中。没有向量索引、ANN、权限变化下的向量分页或 Station 吞吐证明。实验数据库进程已停止。

架构含义：PG 派生投影是有依据的候选；最终 metadata/snippet/count 仍经当前领域 batch read-policy。现在不足以冻结服务端 semantic 存储或第二搜索引擎，也不能把实验 JOIN 变成跨业务数据库任意读取。

## 5. 域内附件边界与功能（含历史文件/网络实验）

> 范围更新后，本节前两个文件/网络实验只保留机制结论；公网搜索与 OS 目录检索不是产品能力（D-19）。

**文件 COMPONENT（历史机制证据）**：将真实公开文档复制到受控目录，成功读取、重命名与重新解析；指向目录外的符号链接被 canonical boundary 检查拒绝。由真实 Markdown 经 macOS `textutil` 生成 DOCX，再提取文本，内容标记存在。

迁移到封闭域后的有效结论是“父对象授权边界 → 附件提取 → 索引 → resolver 时再校验”的机制分解，以及路径 canonicalization 不能单独消除检查到打开之间的替换竞态。OS picker、watcher/重授等 OS-grant 生命周期不再适用；PDF/OCR 和独立 Office 语料对“域内附件提取”仍未证明。

**网络 COMPONENT（历史机制证据，范围外能力）**：向 Bing 公共 RSS 发出真实查询，得到 10 个带真实 URL 的结果，包括 sqlite.org。该实验只说明外部返回可投影为 typed result；公网搜索已移出 Search 范围，不产生供应商接入、分页/限流/SLA 义务。

**网络 SOURCE（移除项）**：`application/tools/mod.rs` 的 `tools_search_providers()` 返回固定 `all/web`，`tools_set_search_primary()` 只是回显输入；封闭域决策下这些固定数据与 Settings 搜索商 UI 应在实施时移除，不作为待接入 provider 资产。

**功能 CONTRACT/SOURCE**：实际 `model-service.ts` 模块声明 `id: 'models'`、Settings entry/panel，中文资源提供“模型服务”；独立 catalog 能生成受信任的 `settings:models` 引用。原生 Settings 打开、返回原查询与写操作仍未验证。功能搜索应读取现有 module/Host descriptor 并按当前账号 eligibility 过滤，不能另维护一套猜路由的名称列表。

## 6. AI 语义与排序

使用真实 `Xenova/multilingual-e5-small` ONNX，revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`。按照原模型文档使用 `query:` / `passage:`、attention-mask mean pooling 和 L2 normalization；输出 384 维。1006 个真实段落/长段切片，最多 256 tokens，CPU 两个 intra-op/一个 inter-op 线程。[原模型说明](https://huggingface.co/intfloat/multilingual-e5-small)

量化权重 **118,308,185 字节**，语料编码 **16,694.582 ms**；60 次查询向量 P95 **3.511 ms**，进程峰值 RSS **902.97 MiB**。FP32 权重 **470,268,533 字节**，语料编码 **15,464.920 ms**，查询 P95 **3.212 ms**，峰值 RSS **2,149.89 MiB**。峰值包含 runtime、tokenizer、图及数据，不能当作模型净内存；不同分支独立运行，未建立受控性能对比。

两个权重版本的原中文探针均为前一 **1/6**、前五 **2/6**。量化逐条编码得到相同六个预期排名；抽样 batch/singleton cosine 大于 0.99949。显式 `<pad>` 的 FP32 抽样与原 batch 向量基本一致。这些诊断削弱了批量/padding 是主因的假设，但没有独立验证 ONNX 导出与原 PyTorch 的完全一致性。

固定原问题包括客户端/服务端职责、Applet 权限、本机加密聊天历史、跨边界数字身份、provider 凭据集中管理与账号切换隔离。后验英文翻译诊断前五 **6/6**、前一 **4/6**；它仅用于定位语言差异，不能替换中文产品指标。

同六个中文问题用 Jieba 多词 OR + BM25 与 FP32 semantic，各取前五，RRF `k=60` 后前五 **1/6**；lexical 也是 **1/6**。英文文档缺少中文词项、语义排序偏离以及候选截断都会影响结果，当前证据不能唯一归因到模型。融合不能弥补候选不存在，也可能压低仅被一个 channel 召回的对象。

架构含义：

- keyword/ID/名称/功能别名是独立基础能力，不依赖每次输入调用模型。
- semantic adapter、analyzer、分块、模型和重排保持独立 port、identity/revision；当前 E5 不选为生产默认。
- 中文查英文/混合内容进入独立质量分层。受控双语 metadata/词典、允许范围内的 query rewrite、其他成熟模型和重排均是待测候选，不能将本轮人工翻译算作已有自动能力。
- 手机端模型包、内存、耗电和后台竞争未证明，不能直接复用这台 Mac 的结果承诺离线语义。
- 向量、索引和 query embedding 都受处理边界约束。实验使用公开语料在本机推理；未形成产品私密数据网络审计。

源码 `MemoryEmbeddingProvider` 有真实 OpenAI/Ollama HTTP adapter，但 `HashMemoryEmbeddingProvider` 的 `token-hash` 仅是确定性 fallback，不是语义模型。Search 接入必须核对 provider actor ownership、实际 embedding/rerank readiness；不能凭 completion 可用推定其他能力。Ask 的引用、生成与权限撤销不在本轮实验范围。

## 7. 查询合同与扩展性

独立协调器完成七项检查：重复叶子 channel 拒绝、RRF/分页对象不重复、A→B→A epoch 拒绝旧响应、输入建议不调度 Web、取消后不继续读、失败来源保留其他结果，以及真实功能 descriptor 绑定。

这说明推荐合同不要求新建完整任务引擎。可使用既有 context/cancel、受限 source port、query epoch 和 resolver；同一 source 接入 query/derived-index 模式，Search UI 不新增业务分支。实验是 Python 小型合同，不是共享 Rust Coordinator、跨语言 Model 生成或真实 SDK conformance。

稳定分页、跨进程取消、当前政策变化、升级 generation、Applets 未挂载执行、卸载清理和真实打开仍需各 source 的完整闭环。加入新来源只声明协议不够；注册、当前 eligible、coverage ready 分别证明。[接入与扩展合同](./extensions.md)

## 8. 进入产品实现前的证明义务

按完整纵向链路推进，每条都覆盖查询、权限、打开、更新/删除与失败恢复：

1. **域内内容与功能**：真实账号下接 Messaging/Social/Identity/Agent/Settings，跨会话查询→当前 actor 授权过滤→原对象 anchor→返回；并证明 Chat 默认落点与 Search 按需挂载。
2. **域内附件**：Peers 管理附件随消息/知识/帖子入库→名称/正文提取→按信任区索引→父对象上下文中打开→父对象撤权/删除即同步不可见；D 区附件不上传。
3. **域外拒绝**：公网查询、OS 路径、外部 connector 经 UI/descriptor/Applet/MCP 任一通道提交均被拒绝，且无配置旁路；Federation 仅在授权上下文中返回对端可见对象，不泄漏不可见对象的存在性。
4. **语义质量**：独立双语标注语料与较弱设备；冻结 analyzer/chunk/model/rerank 和预算前，证明相对 lexical 不退化，并保留明确对象直达。
5. **Ask 与扩展**：由 Agent owner 在当前 actor 可读的域内 evidence 上执行→有引用回答→引用重新授权与打开；真实新 Applet 经同一协议只贡献自有域内对象，不改全局页面 switch。

这些是建议的证据顺序，不是执行计划。所有 [V-01～V-09](./integration.md) 产品 Journey 仍为 **NOT RUN/UNPROVEN**；没有正式 Acceptance PASS。

## 9. 产物与复核

[证据记录](./feasibility-evidence.md) 提供精确查询、结果、原始 JSON/脚本哈希及运行身份。原始输出、模型、public corpus 向量与独立脚本保存在专用缓存目录，未加入 Git；没有持久化生产凭据或私密语料。PostgreSQL 与实验进程已释放，模型缓存仅用于复核本研究。

结论不依赖失去原始输出的历史测量，也不根据命令退出码补全成功。文档完成与产品可用是不同状态：本轮完成封闭域可行性研究，生产 Search、默认导航、域内附件/Federation 接入、域外拒绝的否定证明和 Agent 集成仍待确认与实施。
