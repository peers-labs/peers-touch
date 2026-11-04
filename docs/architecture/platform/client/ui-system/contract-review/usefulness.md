# 怎样证明组件规范有用

> 验收协议已形成内容冻结的提案；NOT_RUN。没有 fresh holdout、独立答卷或真实 Journey 结果。

思考顺序沿现有 EDX：用户承诺 → 内容语义 → 信息结构 → 路径成本 → 状态与恢复 → 动作表示 → UI Grammar → Wireflow/原型 → 证据。组件规范位于 Grammar 和实现之间，提供选择、合法组合、所有权与观察要求；它不能替产品定义成功。

执行架构复用现有 Reasoning Kernel/CER：Quality 冻结新案例和 Oracle/context，两个隔离执行腿分别采集与审阅，盲评差异后才揭示身份并交 Product Owner 取舍。CLI/schema/evidence matcher 负责引用、来源和一致性，独立 reviewer 负责语义判断。没有新增第二个总评审流程。

## 三种价值分别验

- **选型**：相同任务、模型、工具、预算，基线读现行规范，实验腿额外读已接受 registry。用独立答案验证选择、合法组合、缺口升级及理由来源。至少 24 对，按六类任务分层；不是从既有 547 个公开样例抄题。
- **审查**：至少 24 对含实质缺陷、干净反例、歧义边界的独立任务。验证漏报、误报、首要问题选择与 owner 归因；不能拿 evaluator 输出反推答案。
- **真实使用**：至少六条已有产品 Journey 的成对观察，覆盖保存、发送/附件、关系决策、权限/工具、扫码绑定、Shell/Settings。按业务原合同需要的失败、恢复、跨实体和资源边界展开。必须有真实 renderer、状态 owner 与 receiver/设备回读。

详见 [机器协议](./usefulness-protocol.json)。这些是采样分层及最低范围，实际任务内容由新的独立作者生成；没有写入本包以冒充未见样本。

## 可比与独立

每对固定同一 Outcome Oracle、平台、数据、权限、网络、输入方式、viewport、locale、模型版本与参数。选型/审查任务还固定相同源码与 runtime，唯一 treatment 是新合同访问权。模型上下文缓存、先后顺序与工具结果须隔离；执行顺序随机并平衡。任务作者、键/Oracle 作者、候选作者、证据作者与最终 reviewer 的独立关系沿现有 principal 检查；自称两个 Agent 不代表独立。

真实 Journey 各自冻结 baseline/target 实现的源码与 runtime 摘要；预先声明实现差异，在同一结果合同及匹配环境下观察。结果差异能证明产品结果，支持可观察机制；它不自动证明文档是唯一原因。只有独立受控干预才可标 intervention-confirmed。baseline 没达成安全/结果要求是有效差异，不因其失败而排除比较。

24 对样本适于筛查，无法支持普遍有效。报告原始 paired 结果、分层分母、比例区间与配对差值；推广还要第二批真正新 cohort。所有已公开的 547 场景、520 校准输入都属于 training/exposed，首次封装执行就 burn，超时也不能再作为 unseen。

## 冻结判断条件

阈值是预注册提案：安全/授权/数据丢失零 hard failure；选型正确率≥90%、相对基线绝对提升≥15个百分点；实质缺陷 recall≥90%、干净样本误报≤10%、无无依据的 primary finding；真实 Journey 必要 outcome/recovery 全满足，路径向量不发生重大退化。tokens/wall time 中位成本上限为基线的 1.25 倍，单列而不折算总分。

若基线本身已达上限，不宣称必然提升：须保持 outcome 非劣且降低至少 15% 成本，否则 incremental value 不成立。小样本区间跨越标准，结论为 UNPROVEN。阈值须在新案例/结果曝光前由对应 owner 接受，不在失败后上调。

## 证据与产物

合同/源码为 L1；被检查视觉为 L2；真正状态转移与恢复为 L3；原生运行、读屏、性能和接收端效果为所需 L4。Gallery mock 只验证组件行为，不能证明设备批准、写盘、送达或权限生效。

每次运行保留 Oracle/context、source/model/runtime/contract/token/asset/evaluator 的摘要、分步观察、独立 leg review、盲差异、揭示后 disposition、成本与未运行范围。缺匹配环境、缺实质证据、来源漂移或超时就保持 UNPROVEN。已有 CLI 的 review-verify/compare-validate/compare-evaluate/compare-review-blind/compare-review-disposition 接口继续负责各自边界；具体 case 和证据由 owner adapter 提供。

本次只验证模型与公开校准行为；有效性实验、Gallery 和产品 Journey 均尚未开始。
