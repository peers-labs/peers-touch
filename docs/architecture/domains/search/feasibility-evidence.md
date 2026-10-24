# Search 可行性实验记录

> **Date**: 2026-10-22
> **Classification**: 独立 COMPONENT/CONTRACT 研究证据，不是正式 Acceptance run。
> **Result**: 基础组件可行；中文跨语言语义质量未达标；产品 Journey UNPROVEN。
> **Scope update 2026-10-22**: 检索宇宙按 D-19 收窄为 Peers-Touch 封闭域。下文受控 OS 目录与 Bing RSS 实验只保留机制结论，不作为 OS 文件检索或公网搜索能力证据；对应产品主张已移除。

## 1. 复核位置与运行身份

原始产物位于仓库外的机器缓存目录 `peers-search-feasibility-20261022`。复核者将该目录的实际位置设为 `EVIDENCE_ROOT`；下文文件名均相对该目录。保留公开文档实验脚本、JSON、ONNX 权重和派生向量；不包含生产账号或密钥。源码 HEAD `fac77ca549f862c0a41bf9f56da2a0db4b61a045`，JSON 记录每份 corpus 路径/字节/SHA-256。源码复用核对另见 [现状研究](../../../research/search-current-state-and-benchmarks.md)。

主要产物与内容哈希：

- `components.json`：`43c650c710bd8e5eb17ddbde74956f18ceebfb450b89d9c60349c17bf4dfab85`
- `postgres.json`：`a7dbda50dba4168bdf51f0152ec6c9255620e5a1b7974170cb0e2ce0ec526846`
- `semantic.json`：`7392928438372b901e642aadacacae3366c5ad75efd531d55b6f8699d09bcb04`
- `semantic-singleton.json`：`fcf8215d1298daa1cb333f20b06ba6e4f1c026e5057ee7e555a6b19194d41145`
- `semantic-fp32.json`：`ac09b679e61db7d18cd0bf4440495b9529d24f29edad23a5a9f832d1d10fde1e`
- `hybrid.json`：`8695f6d988086b0ab667df193aa0d68849d2a2d0ae19be3065465caa0fb8a8ac`
- `coordinator.json`：`d8824ab7fb3895e9f72b1a07356f1e78f0f49b0bc071417e96c934f32e5a933e`
- `web.json`：`bba4bfc924b5cca2581396581bdce3be3e9dbfd867dc0ca2c65664b5e422fb48`

完整原始输出还保留在运行工具的对应 command execution 目录；以上 JSON 是报告的数字来源。复核需要取得原始缓存并逐项核对哈希；缓存删除后原始证据不可用。本报告不声称永久外部证据留存。

## 2. 全文检索

SQLCipher 13 项检查均为 true：默认中文短词遗漏复现、分词命中、删除移除词项、tombstone 压制迟到 upsert、撤权后候选 hydration 拒绝、加密文件头、正文标记不出现、重开读回、错误密钥拒绝、目录边界、symlink 越界拒绝、rename 读回、真实文档 DOCX 提取。

八个固定关键词及前十预期对象：

1. `Client` → `docs/global/architecture.md`：默认/分词均命中。
2. `小程序` → `applet-runtime/sdk-architecture.md`：默认遗漏，分词命中。
3. `协议` → `applet-runtime/data-model.md`：默认遗漏，分词命中。
4. `权限` → 同上：默认遗漏，分词命中。
5. `生命周期` → `applet-runtime/sdk-architecture.md`：均命中。
6. `Station` → `docs/global/architecture.md`：均命中。
7. `SQLCipher` → `chat/message-search.md`：均命中。
8. `MCP` → `agent/design.md`：均命中。

该指标为“预期对象在前十”，不是穷尽所有 relevant objects 的 Recall@10。查询与文档标签在执行前固定；结果明细及 300 文档 manifest 在 components.json。

PostgreSQL 五项检查均为 true：`simple` 中文短词遗漏复现、预分词命中、reader ACL 过滤、撤权后 hydration 拒绝、诊断 GIN plan。进程生命周期为 initdb→UNIX socket start→query→fast stop。没有真实 Peers actor、向量扩展或大规模服务端性能证明。

## 3. 语义与混合检索

六个中文问题在运行前固定，以下数字为第一份预期文档在去重后文档排名中的位置，越小越好：

1. 客户端、通信模型和服务器分别应该负责哪些事情 → architecture/first-principles：量化第 **8**、FP32 第 **8**。
2. 小程序调用网络和设备功能应该由谁检查是否允许 → applet SDK/data-model：量化第 **1**、FP32 第 **1**。
3. 用户需要在自己的设备里寻找加密聊天中的历史文字 → message-search：量化第 **7**、FP32 第 **8**。
4. 身份数字编号能否传给客户端和另一个服务器 → actor-identity-boundary/unified-actor-system：量化第 **9**、FP32 第 **9**。
5. 把模型提供商的配置和凭据交给服务器统一管理 → provider-station-ownership：量化第 **4**、FP32 第 **4**。
6. 账号切换或设备重新启动时，如何保证异步页面不会读到上一账号的数据 → mobile lifecycle/desktop projections：量化第 **11**、FP32 第 **10**。

原问题前五为 2/6。后验英文翻译只做语言诊断，前五 6/6；输出及原中文标签分开保存在 `semantic-language.json`。不得将该结果写为中文搜索通过。

混合实验配置固定为 Jieba 长度大于一的 OR terms、BM25、FP32 semantic、每 channel 前五、RRF `k=60`，无手工权重。前五命中 1/6；第 5 个问题预期对象降至第 6，其余缺乏候选的问题未被融合补回。记录的是该配置的反例，不是对所有混合检索的否定。

模型 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`：

- quantized ONNX SHA-256：`f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193`
- FP32 ONNX SHA-256：`4aa845c27760e06e9a686b9d8b5d440eae4b6612cd09e5b522b716d3941f77ff`
- tokenizer SHA-256：`0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39`

ONNX Runtime `1.31.0`、numpy `2.5.4`、tokenizers `0.23.3`、Jieba `0.42.1`。tokenizer/config/padding、singleton 与英文查询是诊断；未以受控短句 sanity、生成数据或人工翻译替代真实 corpus 的原中文结果。

## 4. 协调器、功能与公共 Web

coordinator.json 七项检查均 true：重复叶子拒绝、去重分页、epoch 失效、建议不出网、取消不后续读取、partial 保留、真实 Settings descriptor binding。受控异步故障与 read barrier 仅证明机制；原生 transport/session/设备 Journey NOT RUN。

Web 实际请求为 `https://www.bing.com/search?q=SQLite%20FTS5%20documentation&format=rss`，10 条真实 URL，包括 sqlite.org。原 RSS/JSON 保存在缓存；没有搜索商密钥、商业 API、分页或原生网页打开证明。

## 5. 复现入口

脚本均在专用缓存：

- `probe.py`：SQLCipher、PG、量化语义；SHA-256 `c728b1f9e0f8dbb01d4900498f35a6e0a3bdf946be1052ccb1d4aa46ce2bcd66`。
- `semantic-fp32.py`：FP32 对照；SHA-256 `35223612bca4cd6f5d4f1121d4c42f40bc3d22136550bd05a052808623e284ea`。
- `semantic-diagnostic.py`：批量/逐条一致性；SHA-256 `e3ac48097c1508614d7bb5cd05b2881dd3a54dd96a5e859cc64fb3fb1710e460`。
- `hybrid-probe.py`：融合；SHA-256 `48d60e5b38059a65d83e46d6d8ef4b94a4074050bb1f35fc80c74af3b25a520e`。
- `control-probe.py`：合同；SHA-256 `082cdc22177e85dbda5929abb9f0e57344fb82153a66bd819164000f94a5959b`。

执行 Python 为 `/opt/homebrew/Cellar/python@3.13/3.13.5/Frameworks/Python.framework/Versions/3.13/bin/python3.13`，依赖路径为缓存 `deps`。语义/core probe 绑定 300 秒预算；PG start/stop 和单个外部请求有独立 timeout。数据库模式拒绝覆盖已有证据目录，复核时应使用独立目录并保留旧结果。

复用 SQLCipher archive 动态链接使用 `-force_load`，必须验证 cipher_version、错误密钥与重开结果，不能把成功链接/普通 SQLite 函数当作加密证明。实验 adapter 采用受控字符串转义；生产实现仍要求 typed/参数化查询与正式 analyzer。

## 6. 证据缺口与资源

未证明：V-01～V-09 全部原生产品 Journey、域内附件随父对象授权的生命周期、Federation 按需查询与存在性不泄漏、手机性能与离线语义、PDF/OCR/独立 Office corpus、Agent provider/session、D 区内容网络边界、生产事件/原子 generation 与 Applet conformance，以及域外来源（公网/OS 文件/外部 connector）无法经任何通道接入的否定证明。真实 OS grant 与搜索商接入按 D-19 属范围外，不再列为待证能力。

Acceptance gap detector 在本轮环境返回 `PT_ACCEPTANCE_ARTIFACT_ROOT is required in CI`，未生成有效正式判定；没有构造 Plan/run 或假身份填补输入。手动审阅维持产品 UNPROVEN。完成审计仅针对研究交付，不授予产品 implementation-ready。

standalone completion material 已生成；`reviewable=false`，因为本次未把组件实验绑定为产品证据，工作树还有已有无关产物。没有工作树级交付/清洁状态证明。缓存中的研究交付审阅记录 `closure-audit.md` 保留精确范围、问题归因与资源处置。

实验 PostgreSQL 已停止，文件/数据库句柄关闭，推理进程退出。模型、脚本和公开语料派生缓存明确保留作复核；没有改动生产源码、导航、协议生成或运行配置。
