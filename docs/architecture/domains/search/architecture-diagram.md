# Search 目标架构图

> **Status**: draft / target architecture（D-19 封闭检索域）
> **Date**: 2026-10-22
> **Scope**: 仅 Peers-Touch 域内对象（端 + Station），只返回当前 actor 有权限的内容。
> 配套：[技术设计](./design.md) · [数据合同](./data-model.md) · [决策](./decisions.md)

图例约定：**D 区 = 端侧私有**（永不出端）、**S 区 = 本站授权**（行级 actor/ACL）、**F 区 = 联邦授权**（对端按需裁决）。

## 1. 总图：信任区与两级执行

```mermaid
flowchart TB
    classDef d fill:#e8f0fe,stroke:#4285f4,color:#10233f;
    classDef s fill:#e6f4ea,stroke:#34a853,color:#0f2f1a;
    classDef f fill:#fef7e0,stroke:#f9ab00,color:#3d2f04;
    classDef x fill:#fce8e6,stroke:#d93025,color:#4a1410,stroke-dasharray:5 4;
    classDef core fill:#f3e8fd,stroke:#9334e6,color:#2a1240;

    subgraph CLIENT["客户端（Desktop / Mobile 共享语义）"]
        direction TB
        UI["Search UI<br/>Overlay · 结果/预览 · 功能面板"]
        COORD["Client Search Coordinator（headless）<br/>身份 epoch · 计划/取消 · 融合/分页"]
        subgraph COREPKG["packages/search-core（建议共享 Rust crate）"]
            AST["Query AST / Planner"]
            RANK["RRF 融合 · rank channel"]
            CURSOR["Cursor/session · coverage"]
        end
        RESOLVER["Shell Resource Resolver<br/>消息 anchor · 功能导航 · 附件定位"]
        subgraph DZONE["D 区 · 端侧私有（本账号加密边界）"]
            direction LR
            MSG["Messaging FTS<br/>messaging_message_search_fts"]
            MEM["端侧 Agent 记忆/会话"]
            DATT["设备私有附件投影"]
            HIST["搜索历史（默认关）"]
        end
    end

    subgraph STATION["本站 Station（认证 actor 上下文）"]
        direction TB
        SAPP["Station Search Application<br/>admission · 调度 · fan-out/预算"]
        subgraph SZONE["S 区 · 本站授权（行级 actor/ACL）"]
            direction LR
            SOC["Social 帖/评论"]
            IDP["人员/会话目录"]
            AGT["Agent 会话/知识/笔记"]
            SATT["Peers 管理附件投影"]
            CAP["能力/功能 catalog"]
        end
        SIDX[("S 区派生索引<br/>PG + GIN / 可选成熟引擎")]
        HYD["Batch read-policy hydration<br/>原域裁决 · deny 即丢弃"]
    end

    subgraph FED["F 区 · 联邦（按需，不抓取/不整站索引）"]
        direction LR
        FQ["Federation on-demand adapter<br/>携带认证联邦身份"]
        PEER["对端 Station<br/>按 actor 实时裁决可见性"]
    end

    subgraph AI["模型处理（位置受 processing policy 约束）"]
        direction LR
        EMB_D["端侧 inference<br/>仅 D 区 · 无可用则降级 lexical"]
        EMB_S["Station Agent / 外部 provider<br/>仅 S 区 · 二次显式授权"]
    end

    subgraph BANNED["域外（明确非目标，无配置/Applet/MCP 旁路）"]
        direction LR
        WEB["公网/搜索商"]:::x
        OSF["Peers 之外的 OS 文件/目录"]:::x
        EXT["外部网站 / SaaS connector"]:::x
    end

    UI --> COORD
    COORD --> COREPKG
    COREPKG --> RESOLVER
    COORD -->|D 区查询 · 不出端| MSG & MEM & DATT & HIST
    COORD -->|加密 RPC + actor 上下文| SAPP
    SAPP --> SZONE --> SIDX
    SAPP --> HYD
    SAPP --> FQ --> PEER
    HYD -->|仅授权投影| COORD
    PEER -.->|仅授权投影/不可见不泄漏存在| SAPP

    MSG -.embedding.-> EMB_D
    DATT -.embedding.-> EMB_D
    SIDX -.embedding/answer.-> EMB_S
    EMB_S -.授权 evidence.-> SAPP

    class MSG,MEM,DATT,HIST,EMB_D d;
    class SOC,IDP,AGT,SATT,CAP,SIDX,HYD,SAPP,EMB_S s;
    class FQ,PEER f;
    class COORD,AST,RANK,CURSOR,COREPKG core;
```

关键含义：

- 检索宇宙只有 **D / S / F 三个信任区**；域外三类对象在 admission 与请求 schema 两层都被拒绝（`SCOPE_OUTSIDE_SEARCH_DOMAIN`）。
- **一份语义、两级执行**：共享 `search-core` 负责 AST、融合、cursor、取消；端上跑 D 区，Station 跑 S/F 区；Renderer 只做投影。
- Station **从不回拉端上明文**，也不集中保存 E2EE 正文或其向量。

## 2. 一次查询的时序与权限执行链

```mermaid
sequenceDiagram
    autonumber
    actor U as 当前 actor（ptid）
    participant UI as Search UI
    participant CC as Client Coordinator
    participant DP as D 区 providers
    participant SA as Station Search App
    participant SI as S 区索引/域 adapter
    participant HY as read-policy hydration
    participant FF as Federation（对端）

    U->>UI: 输入（提交查询，非逐字外发）
    UI->>CC: QueryIntent + 身份快照
    Note over CC: intentId + identityEpoch + sourceSetRev + policyEpoch
    par 端侧私有
        CC->>DP: D 区查询（账号密钥隔离）
        DP-->>CC: 候选（消息/记忆/私有附件）
    and 本站 + 联邦
        CC->>SA: 加密 RPC（actor 取自认证上下文，禁自报）
        SA->>SI: 带 actor 谓词检索
        SI-->>SA: S 区候选
        opt F 区且联邦上下文有效
            SA->>FF: 携带认证身份按需查询
            FF-->>SA: 对端授权投影 / 拒绝（不区分不存在）
        end
        SA->>HY: 批量当前读权
        HY-->>SA: 仅可读投影（title/snippet/count）
        SA-->>CC: 授权结果 + coverage
    end
    CC->>CC: RRF 融合（同叶子仅一次）· 稳定分页
    CC-->>UI: 结果（全部已过当前权限）
    U->>UI: 打开结果
    UI->>CC: ResourceRef
    CC->>DP: 打开（D）/ ->>SA: 打开（S/F）
    Note over DP,SA: 第 4 道：preview/open 再校验 revision 与权限
```

四道链，缺一不可：

1. **Admission**：descriptor 仅允许域内 kind；公网/OS/外部 connector schema 拒绝。
2. **候选过滤**：D 区按账号密钥隔离；S 区查询带 actor 谓词；F 区由对端裁决。
3. **read-policy hydration**：title、snippet、count、facet、建议、AI evidence 发布前批量过原域当前权限；deny/unknown 直接丢弃，不泄漏“存在但无权”。
4. **preview/open 再校验**：Resource Resolver 打开时按 revision/联邦可达性再判一次。

撤权/删除/隐藏事件：先阻断读取（deny/tombstone），再异步清理派生物（索引/向量/预览/cursor/AI 引用）。

## 3. 索引、更新与附件生命周期

```mermaid
flowchart LR
    classDef d fill:#e8f0fe,stroke:#4285f4;
    classDef s fill:#e6f4ea,stroke:#34a853;

    subgraph SRC["原域真源（Search 不拥有正文/写操作）"]
        M["Messaging"]:::d
        SC["Social/Secure Content"]:::s
        AG["Agent/知识/笔记"]
        AT["附件存储（端受保护 / Station 对象）"]:::s
        IDM["Identity/Federation"]
    end

    subgraph WRITE["可靠投影"]
        OB["outbox（同事务）<br/>或 watermark snapshot"]
        WK["Index projection workers<br/>snapshot → catch-up → ready"]
        GEN["generation 切换（原子）<br/>tombstone 压住迟到 upsert"]
    end

    M --> OB
    SC --> OB
    AG --> OB
    AT -->|随父对象可见性| OB
    IDM --> OB
    OB --> WK --> GEN
    GEN -. D 区 .-> DIDX[("SQLCipher/FTS5（含向量）")]:::d
    GEN -. S 区 .-> SIDX2[("PG GIN / 向量（行级 ACL）")]:::s

    REVOKE["撤权/删除/受众缩小"] -->|优先 deny 读取| DIDX
    REVOKE -->|优先 deny 读取| SIDX2
    REVOKE -->|随后异步清理| CLEAN["索引/向量/预览/cursor/AI 引用"]
```

- Peers 管理附件没有独立授权：**父对象 read-policy 即附件权限**；附件名/正文/缩略图/count 随父对象一起出现或消失。
- D 区正文、chunk、向量只写本账号受保护存储；新设备历史未恢复时显示真实 coverage，不回退到 Station 搜 E2EE 正文。
- Search 派生索引可重建，业务原文/恢复 cursor/密钥不进 Search。

## 4. AI 处理边界（处理位置 ≠ 检索范围）

```mermaid
flowchart LR
    classDef d fill:#e8f0fe,stroke:#4285f4;
    classDef s fill:#e6f4ea,stroke:#34a853;
    classDef x fill:#fce8e6,stroke:#d93025,stroke-dasharray:5 4;

    D["D 区证据<br/>消息/私有附件/端侧记忆"]:::d -->|query/embedding 仅端侧| ED["端侧 inference"]:::d
    ED --> ANS_D["语义召回/回答（不出端）"]:::d
    D -.永不上传.-> X1["Station / 外部模型"]:::x

    S["S 区证据"]:::s -->|来源策略 + 用户显式授权 ①| SA2["Station Agent"]:::s
    SA2 -->|二次独立授权 ②| EXT2["外部 model provider"]:::s
    SA2 --> ANS_S["带引用回答（仅本轮可读证据）"]:::s
```

- 模型只在**当前 actor 可读的域内证据**上工作，不能借模型扩大可读范围。
- D 区无端侧 inference 时保留 lexical，不静默改走远端；外部模型已收到的内容不可追溯撤回，外发前如实告知。
- Agent 的工具原始输出、内部推理、Secret 不进索引；工具调用是否可独立检索（anchor 到 tool-call）为待确认项，当前锚点是消息/轮次。

## 5. 功能导航与结果对象

```mermaid
flowchart LR
    Q["关键词 / ID / 功能别名（无需模型）"] --> FC["Shell/模块功能 catalog<br/>module+capability+action（受信 descriptor）"]
    FC -->|仅当前账号 eligible| OPEN["打开 Settings/模块/Applet 入口"]
    Q2["描述性自然语言"] --> SEM["semantic/rerank（有界候选）"]
    OPEN -.只导航不写入.-> FORM["原模块表单/确认（写操作归原域）"]
```

## 6. 否定边界（必须持续成立）

```mermaid
flowchart TD
    A["任何来源通道"] --> B{"descriptor kind / 请求 scope"}
    B -->|person/message/post/agent/knowledge/domain-attachment/applet-object/function| C["进入 admission"]
    B -->|web / os-file / external-connector| D["SCOPE_OUTSIDE_SEARCH_DOMAIN"]
    E["UI 设置"] -.无法开启.-> XW["公网搜索商"]
    F["Applet 贡献"] -.仅自有域内对象.-> C
    G["MCP/Skill 工具"] -.域外工具拒绝.-> D
    H["实验开关/配置"] -.不存在旁路.-> XO["OS 目录/外部 SaaS"]
```

## 7. 落地形态（建议目录，不代表已实现）

```text
model/domain/search/                     Proto：QueryIntent/ResourceRef/Result/Coverage
packages/search-core/                    共享 Rust：AST/planner/RRF/cursor/session（无 Tauri/DB/模型依赖）
apps/desktop|mobile/src-tauri/.../search/  D 区 adapter（FTS/私密附件/功能）+ Client coordinator
apps/station/app/subserver/search/       S 区 application + index/domain adapters + F 区 federation on-demand
docs/architecture/domains/search/        本合同（product/design/data-model/extensions/decisions）
```

现状提醒：门户 `application/search` 与 Launcher 搜索仍返回空/mock；`tools_search_providers` 固定 `all/web` 与 `web-search` Applet 公网路由在实施时移除；以上均为目标态，产品 Journey（V-01～V-09）当前 UNPROVEN。
