# Release Distribution — 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-21 | **Updated**: 2026-10-21
> **Owner**: Architecture Team

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| RD-D01 | Station 镜像托管于 GHCR | accepted |
| RD-D02 | 单镜像 + 运行时角色选择，不为 Relay 分叉镜像 | accepted |
| RD-D03 | 用户分发面 `tooling/distribution/` 与测试机 `tooling/docker/` 分离 | accepted |
| RD-D04 | 引导脚本以固定 tag raw URL 分发，一期不建自有短域名 | accepted |
| RD-D05 | 桌面构建用官方 tauri-action；一期三平台均不签名 | accepted |
| RD-D06 | 自首版起启用 Tauri updater（minisign 签名） | accepted |
| RD-D07 | 首发前 identifier 固定为 com.peers.touch.desktop | accepted |
| RD-D08 | git tag 是唯一版本真源，CI fail-closed 校验一致性 | accepted |
| RD-D09 | 候选验收、公开匿名验收与稳定入口晋级分别拥有生命周期 | accepted |
| RD-D10 | Station 镜像发布 linux/amd64 + linux/arm64 双架构 | accepted |
| RD-D11 | 密钥安装时本地生成，零默认密钥、零日志泄露 | accepted |
| RD-D12 | 一期范围限定：单节点 Station + Desktop 三平台；Relay/LiveKit/签名/二级渠道排除 | accepted |
| RD-D13 | 镜像源参数化必须覆盖全部四个构建消费方，默认官方源、大陆/内网显式覆盖 | accepted |
| RD-D14 | 升级前完整备份，原位回滚须证明兼容，否则恢复一致快照 | accepted |
| RD-D15 | 用户安装生成独立 Dashboard 凭据，不继承开发默认口令 | accepted |

---

## RD-D01: Station 镜像托管于 GHCR

**Status**: accepted
**Date**: 2026-10-21

### Context

deploy-station.yml 当前 org policy 刻意不使用 GHCR（`contents:read`、远程 daemon 本地构建），导致镜像无分发出口，用户向一键安装无从谈起（E2）。

### Decision

发布产物推送到 `ghcr.io/peers-labs/peers-touch-station:<tag>`，由 release.yml 的 `station-image` job 在 tag 事件中构建推送；deploy-station.yml 的权限模型保持不变。

### Rationale

GHCR 与仓库/Action 原生集成（GITHUB_TOKEN + `packages:write`），公开镜像匿名可拉取、无 Docker Hub 速率限制、无需独立账号体系（E10）。Go 静态二进制镜像构建时间短，不依赖既有测试机 daemon 拓扑。

### Alternatives Considered

- Docker Hub：需要独立组织账号与凭证管理，匿名拉取有速率限制，对"挂在 GitHub 仓库的开源项目"是额外运维面。
- 继续远程本地构建 + 用户在自有机器编译：要求用户具备 Go/Docker 构建环境与全部源码，违背一键安装目标。
- 自建 registry：无运维收益，纯成本。

### Consequences

正面：用户拉取路径标准化；测试机部署未来也可以选择改为 pull（不在本期）。负面：需要一次性把 GHCR 包设为 public 的运维动作（否则匿名 403，安装 Journey 会立即暴露）；包生命周期与仓库权限耦合。

---

## RD-D02: 单镜像 + 运行时角色选择

**Status**: accepted
**Date**: 2026-10-21

### Context

现状 station 与 relay 共用同一 Dockerfile/镜像，以 `PEERS_NODE_ROLE` 选择 composition（E4）。

### Decision

GHCR 只发布一个镜像。用户 compose 只消费 station 角色；relay 角色的未来分发复用同一 tag 镜像。

### Rationale

多镜像会制造"角色 × 版本"矩阵与漂移风险；既有 entrypoint 已完整承担角色投影，分发层无需重新分叉。

### Alternatives Considered

- 分拆 `peers-station` / `peers-relay` 镜像：构建与发布路径翻倍，无收益（一期 relay 不在用户安装面）。

### Consequences

正面：发布矩阵只有一个制品，角色与版本永不漂移。负面：镜像内含两种角色的二进制能力，体积不做角色裁剪；可接受（Go 静态二进制单文件）。

---

## RD-D03: 用户分发面与测试机部署面分离

**Status**: accepted
**Date**: 2026-10-21

### Context

内部测试机 compose 同时包含源码 build、Relay、LiveKit、Acceptance 与主机绑定，而自托管用户只需要固定版本的 Station 和 PostgreSQL。两类受众共享一份编排会产生不可穷举的条件组合。

### Decision

新增 `tooling/distribution/`（install.sh、用户 docker-compose.yml、.env.example）作为用户分发面；`tooling/docker/compose.yml` 与 deploy-station.yml 仍归属测试机/运维面，仅承接 RD-D09（摘 tag 触发）与 RD-D13（构建参数转发）的必要跨模块改动，受众边界不混。

### Rationale

两个受众的需求方向相反且不可调和：测试机 compose 需要 build 段、强制 env 注入、relay/livekit/webhook profile、主机网络调参；用户面需要 image 固定、零配置、最小变量集。合编一个文件必然靠条件分支与注释切换，是典型并行真源（违反 STRUCT-02）。

### Alternatives Considered

- 用同一份 compose + override：override 组合状态不可穷举，安装器仍需生成多份文件，复杂度更高且测试机回归风险直接落在用户面。
- 仅改 tooling/docker/compose.yml 兼容两边：会污染测试机 4 套环境的稳定部署路径。

### Consequences

正面：用户安装面零测试机语义、可独立演进；4 套测试环境零回归风险。负面：两份 compose 长期并存，entrypoint/镜像契约是共享点；共享契约变更时两处都受质量门约束（design.md §7-6）。

---

## RD-D04: 固定 tag raw URL 作为 curl 入口，一期不建短域名

**Status**: accepted
**Date**: 2026-10-21

### Context

业界安装脚本通常挂自有域名（get.docker.com、sh.rustup.rs）；本项目尚无独立站点运维（E16）。

### Decision

一期官方指令使用固定 release tag 的 raw.githubusercontent.com URL（脚本与同 tag compose/资产互相引用）；安装器从同 tag Release 的 `checksums.txt`（流水线就实际资产生成，非仓库提交文件）校验 `docker-compose.yml` sha256，文档给出校验和核对方式。自有短域名作为未来纯 CNAME 层，不改脚本契约。

### Rationale

tag 路径不可变，满足"脚本拉到的资产与测试过的版本一致"；raw 经 HTTPS 分发；零新基础设施。分支/HEAD URL 明确禁止（漂移不可审计）。

### Alternatives Considered

- GitHub Pages + 自有域名：需要域名、DNS、Pages 发布链路与内容审查，对早期项目是纯负担。
- 只发 Release 资产、要求用户先手动下载：不满足一键安装目标。

### Consequences

正面：零新基础设施即可获得不可变、可审计的安装入口。负面：URL 较长且暴露 github.io 域名观感；GitHub 短时不可用时安装不可用（可接受：镜像本身也在 GHCR）。反转条件：项目拥有稳定主域名且安装量使品牌链接成为必要。

---

## RD-D05: 官方 tauri-action 矩阵构建；一期不签名

**Status**: accepted
**Date**: 2026-10-21

### Context

release.yml 不构建桌面产物（E7）；macOS 签名需 US$99/年 Apple 会员，Windows 证书同样有成本；Windows 未签名仅一次性 SmartScreen 提示、非阻断（E11/E12）。

### Decision

三平台矩阵全部交给 `tauri-apps/tauri-action`；一期不注入任何代码签名证书。安装文档如实说明各平台绕过路径。NSIS 采用 currentUser 模式。macOS 发布单一 universal dmg（Intel/Apple Silicon 合一），Windows/Linux 只出 x86_64。

### Rationale

签名是独立信任层，与"产物能发出"解耦；内测期用户规模与签名采购周期不匹配；tauri-action 是 Tauri 官方维护的发布动作，避免自维护矩阵脚本。

### Alternatives Considered

- 等证书就绪再发布：发布链路本身需要真实 tag 演练，越晚发现矩阵问题修复成本越高。
- 自建三平台构建脚本：重复实现 tauri-action 的 updater 产物发布、tag 解析、矩阵兼容逻辑。

### Consequences

正面：发布链路今天就能用真实 tag 演练，矩阵与 updater 集成问题早暴露；签名升级时只加 secret 不动结构。负面：macOS 用户首次打开需右键绕过 Gatekeeper，转化率受损；Windows 有一次 SmartScreen 警告。**反转/升级条件**：任一平台出现真实非技术用户分发需求，或 Apple 会员/证书采购完成——届时仅新增 secret 与签名参数，不改产物矩阵结构。

---

## RD-D06: 首版起启用 Tauri updater（minisign 签名）

**Status**: accepted
**Date**: 2026-10-21

### Context

Tauri updater 的签名密钥是自生成 minisign 密钥对，免费且与 OS 代码签名完全独立（E14）。

### Decision

首个公开版本包含 updater 依赖、Rust Builder 初始化、capabilities、配置、公钥与 `createUpdaterArtifacts`。稳定发现入口使用 GitHub `/releases/latest/download/latest.json`，清单内包 URL 固定 tag；同一 universal 更新包在两个 macOS 架构键下引用。tauri-action 负责包和签名生成，流水线核对合并后的清单完整性；候选和 rc 不晋级稳定入口。

### Rationale

若首发不带更新通道，第二版才补，会出现"无法应用内更新的初代版本"永久悬空；签名通道零成本，且为后续强制/灰度留出演进位置。更新信任根必须先于用户基数建立。

### Alternatives Considered

- 依赖用户手动重新下载：IM 客户端迭代频率高，手动更新导致网络版本碎片化，联邦互通排障困难。
- 自建更新服务：GitHub Release 已是合格静态更新源，无必要。
- 把清单入口固定旧 tag：旧客户端永远读到旧版本，无法发现更新；固定 tag 只适用于清单内的包地址。

### Consequences

正面：不存在"无法应用内更新的初代悬空版本"，更新信任根先于用户基数建立。负面：私钥成为必须保护的发布秘密（泄露者可签发被客户端接受的更新）；私钥轮换在丢失场景意味着更新链重建，须在执行阶段把轮换/吊销预案写入运维文档。

---

## RD-D07: identifier 首发前固定为 com.peers.touch.desktop

**Status**: accepted
**Date**: 2026-10-21

### Context

现有 `.dev2` identifier 只服务本地开发且从未公开发布；公开 identifier 会成为 Keychain、通知、安装目录和 updater 链的持久身份。

### Decision

公开产物之前把 identifier 从 `com.peers.touch.desktop.dev2` 改为 `com.peers.touch.desktop`，此后不可变。

### Rationale

identifier 绑定 macOS Keychain、通知、未来签名身份与升级链；当前 dev2 从未随公开产物发布（E8），现在改是零迁移成本窗口。发布后再改等于让全部用户"新装一个应用"。

### Alternatives Considered

- 沿用 dev2 以免动配置：把开发身份永久固化到产品，不可接受。

### Consequences

正面：开发身份与产品身份隔离，Keychain/通知/签名/升级链在首发即固定。负面：开发期本地配置（dev2 数据目录）与正式版隔离，开发机需重新登录一次，属一次性成本。

---

## RD-D08: git tag 唯一版本真源 + CI 一致性校验

**Status**: accepted
**Date**: 2026-10-21

### Context

Desktop package、Cargo package、Tauri config、Release tag 与 OCI label 原本可独立变化，发布流程没有一处能证明这些版本表达一致。

### Decision

tag 去掉 `v` 后必须与三处客户端版本完整相等，包括合法 prerelease 后缀；对应 lockfile 同步。镜像 label、Release、updater manifest 和包内版本使用同一完整 SemVer。版本准备是后续明确批准的发布操作，本轮不 bump 版本、不创建 tag。更新实验使用实际包内版本严格递增的两个候选，不能仅更换 rc tag 而保持包内 `0.1.0`。错误 tag、版本不一致、同版本更新和 prerelease/stable 混用都有反向验证。

### Rationale

多版本源（package.json / Cargo / 手工填 Release）漂移是发布事故最常见来源；tag 是不可变、已签名语义的天然锚点。

### Alternatives Considered

- 以 tauri.conf.json 为真源反推 tag：tag 是发布动作的实际触发器，工作流无法被"未打的 tag"触发，反过来才成立。

### Consequences

正面：版本漂移类发布事故在创建 Release 前即被阻断。负面：版本提升必须同时改三处版本号并打匹配 tag，多一步机械操作；由 CI 校验消除遗忘风险。

---

## RD-D09: release.yml 单一发布编排

**Status**: accepted
**Date**: 2026-10-21

### Context

Station 镜像、Desktop 包和同一 GitHub Release 共享 tag，但它们的构建、候选验证、公开和稳定发现具有不同失败边界；内部部署还曾与 tag 发布隐式耦合。

### Decision

release-notes 唯一创建 draft；构建产生候选产物；verify-candidate 认证下载实际 draft 资产，Suite 文件服务原样提供包字节和签名。updater 候选测试清单仅投影下载 origin，原始清单固定 tag URL 独立断言；该 override 不进入正式配置。finalize 在候选通过后公开资产且 `make_latest=false`；verify-public 新 Suite 无凭证验收，promote-stable 只晋级已验证完整正式版。镜像 tag 不覆盖既有 digest，局部失败幂等恢复；内部部署仅 workflow_dispatch。

### Rationale

"一个 tag = 一次完整发布"必须在单一工作流内可观察；现有空 Release job 被实质作业取代，而不是再叠加第三个工作流形成触发顺序竞争。现状（E18）公开发布 tag 会 SSH 滚动全部 4 台测试机；tag 语义转为公开发布后（含 rc 演练），这种隐式联动会让内部测试床被未经评审的版本打断。公开发布与测试机部署是两种授权意图，触发器必须分离。

### Alternatives Considered

- 新建 station-release.yml 与 desktop-release.yml 并存：两工作流各自创建/更新同一 Release 存在竞态，changelog 归属不清。
- 保留 deploy-station 的 tag 联动：公开发布与测试机滚动继续耦合，rc tag 也会触发 4 机部署，违背最小授权与可演练性。
- 让 release.yml 最后一步再触发测试机部署：跨工作流调用链不可观察，且把发布者权限扩展到 SSH secret 面。
- 先匿名下载 draft 再决定公开：GitHub 权限模型使该依赖无法完成。
- 公开即 latest 后再验收：会向稳定用户暴露尚未通过匿名安装和更新检查的版本。

### Consequences

正面：发布与内部部署解耦，稳定入口仅消费已验证的完整版本。负面：公开匿名验收使用独立 Suite，失败的公开资产仍可直接访问，故其状态必须诚实记录且不晋级 latest；跨 GHCR/GitHub 没有分布式原子事务。测试机需显式 dispatch，release 权限限于所需 job。

---

## RD-D10: 双架构镜像（amd64 + arm64）

**Status**: accepted
**Date**: 2026-10-21

### Context

Station 是 CGO 关闭的 Go 静态服务，公开自托管目标同时包含常见 x86_64 主机和 arm64 服务器；单架构镜像会迫使另一类用户自行构建。

### Decision

station-image 发布 linux/amd64 与 linux/arm64 manifest list。

### Rationale

CGO 关闭（E6），Go 交叉编译 + QEMU 即可，增量构建时间主要在 arm64 的 QEMU 部分，成本低；arm64 自托管场景（Apple Silicon 机房、Graviton、开发板）是合理对冲（E17 为低置信假设，因此仅保留双架构、不做更多架构）。

### Alternatives Considered

- 只发 amd64：首个 arm64 用户即被迫自建镜像。
- 增加 armv7：无证据需求，QEMU 成本与验证面不值得。

### Consequences

每次发布多一次 arm64 构建（约数分钟）；arm64 只做启动 healthz 验证，不承诺性能等价。发布 job 必须注入 BUILD_COMMIT/BUILD_LABEL/BUILD_TIME（E19），保证镜像 OCI label 与 tag 自洽，不沿用 unknown/dev 默认值。

---

## RD-D11: 密钥安装时本地生成

**Status**: accepted
**Date**: 2026-10-21

### Context

现有运维 compose 要求调用者提供应用 JWT 和数据库口令。公开安装若复制固定默认值或让容器临时生成，实例身份、备份和恢复都会失去明确 owner。

### Decision

`PEERS_AUTH_SECRET`、`PEERS_DB_PASSWORD` 由 install.sh 在安装主机用 `openssl rand -hex 32` 生成，写入 0600 `.env`；镜像、仓库、CI、安装日志均不出现默认值或回显。

### Rationale

密钥唯一所有者是自托管用户；延续项目"No Secrets in Code"铁律。既有 compose 已以 `:?` 强制注入（E3），安装器只是把"运维手工生成"自动化，契约不变。

### Alternatives Considered

- 提供开发默认密钥：公开默认密钥等同无密钥，必然被带进生产。
- 首次启动时容器内生成：密钥会只存在于容器层/卷语义中，备份、升级、排障时用户不可见不可控。

### Consequences

正面：每实例秘密独立，镜像与仓库可完全公开，符合项目 No Secrets 铁律。负面：丢失 `.env` 即丢失 DB 口令与认证秘密，安装输出必须明确告知备份责任；`uninstall --purge` 会连带删除，须二次确认。

---

## RD-D12: 一期范围边界

**Status**: accepted
**Date**: 2026-10-21

### Context

Station、Desktop、Relay、代码签名和多种二级分发渠道可形成庞大矩阵，但首个可证伪目标只需要自托管 Station 与三平台 Desktop 的一条完整链路。

### Decision

一期交付：单节点 Station（station+postgres）一键安装、GHCR 双架构镜像、Desktop 三平台未签名产物 + updater 通道。明确排除：Relay/LiveKit/Webhook 用户安装、代码签名、Homebrew/Flatpak/Store、Mobile、裸二进制/Helm、自建更新服务、灰度/强制更新。

### Rationale

分发链路首先要"完整跑通一次"；排除项均有明确触发条件而非永久否定，避免一次性建设无验证的分发矩阵。

### Alternatives Considered

- 首版即覆盖 Relay 联邦安装 + 签名 + Homebrew/Store：每条都是独立验证面，同时铺开将没有一条链路能被真实发版证明。
- 只发 Station 或只发 Desktop：两端共同构成"自托管 + 客户端"最小可用闭环，缺一则分发链路无法端到端验证。

### Consequences

正面：范围可被一个 tag 的完整发版 Journey 证明。负面：联邦全功能（依赖 Relay 公共基础设施）的用户自助部署仍需等待后续范围；一期用户得到的是可单节点运行、可升级的 Station 与 Desktop。

---

## RD-D13: 镜像源参数化覆盖全部构建消费方

**Status**: accepted
**Date**: 2026-10-21

### Context

大陆镜像源硬编码不止存在于 station.Dockerfile（E5）：builder-base.Dockerfile 同样硬编码；acceptance runtime 两个 compose 经 `BUILDER_IMAGE=hub.byted.org/...` 走内网，Dockerfile 的 `if ! command -v go` 分支正是为这条内网路径服务。若只改发布构建默认值而不把覆盖能力接到所有消费方，大陆测试机、`make station` 与内网 acceptance 构建会回归（评审 blocking finding F1）。

### Decision

`APT_MIRROR`/`GO_TARBALL_MIRROR`/`GOPROXY`/`GOSUMDB` 作为统一构建参数契约：默认值全部官方源；station.Dockerfile 与 builder-base.Dockerfile 同时参数化；tooling/docker/compose.yml 的 build.args 从环境变量转发；deploy-station env 合成段、devctl runCompose、acceptance 两个 compose 在大陆/内网路径显式传覆盖值。`GOSUMDB` 默认官方校验，仅显式覆盖时关闭。

### Rationale

单一参数契约 + 环境注入，保证"官方默认安全、内网显式降级"在四条路径上行为一致；禁止在任一文件重新硬编码镜像源（并行真源）。

### Alternatives Considered

- 只在 release.yml 传官方源、其余路径维持硬编码：默认源翻转后大陆/内网构建立即失败，且同文件出现两套源语义。
- 维护两个 Dockerfile（发布版/大陆版）：分叉漂移不可避免。

### Consequences

正面：发布构建可审计（官方校验链），大陆/内网速度不回归。负面：compose.yml、deploy-station.yml、devctl 都有受控改动，需要四条路径的构建验证（已纳入质量门 6）。

---

## RD-D14: 升级 fail-forward + state.json + 人工 rollback

**Status**: accepted
**Date**: 2026-10-21

### Context

Station 的迁移代码包含 `AutoMigrate` 和 `DropColumn`。升级后的数据库不能假定兼容旧程序，人工执行回滚也不能改变这个事实。身份密钥与附件在 `peers_data`，数据库、文件和配置必须作为一致快照恢复。

### Decision

升级前停止写入并完成可验证的完整备份；失败则不得启动新程序。失败升级保留现场。有 source/digest/schema 绑定的版本对兼容证据才允许原位 `rollback --to`；缺证据或不兼容时拒绝，并要求显式 `--restore-backup <ref>`。恢复向新卷写入 PostgreSQL、`peers_data`、配置和旧镜像身份，验证健康及持久数据后才切换。快照之后的数据丢失边界需显式确认；校验失败不覆盖原卷。

### Rationale

读写兼容证据和完整恢复路径约束真正的数据风险；`state.json` 的 source、schema、卷、备份引用和操作状态由实例 owner 原子维护，详见 data-model.md。

### Alternatives Considered

- 自动回滚：迁移后旧版本可能无法启动，自动回滚会把服务置于比失败升级更差的状态。
- 不提供 rollback 子命令：用户只能手工操作 docker，排障路径不受控。
- 把状态写进 .env：.env 是用户可读改的密钥文件，混入状态机语义会制造耦合。
- 只把回滚改成人工确认：仍可能用旧程序访问已迁移数据库，不能作为兼容保护。

### Consequences

正面：不兼容回滚可被拒绝，恢复能同时验证数据库、身份与附件。负面：备份需要停写和额外存储；恢复旧快照不能保留快照后的写入。无兼容证据时仅提供备份恢复，不宣称原位降级成功。

---

## RD-D15: 用户安装生成独立 Dashboard 凭据

**Status**: accepted
**Date**: 2026-10-21

### Context

Station 镜像中的 `sub_dashboard.yml` 带有仅供源码开发使用的 `peers/peers` bootstrap super-user。若用户 compose 只注入应用 JWT 和数据库口令，公开分发实例会继承这组已知凭据；Dashboard JWT 还会在未配置时退化为进程级随机值，重启后会话失效。

### Decision

安装器在首次创建实例时额外生成 64 位十六进制 Dashboard 密码和 JWT secret，并与固定 bootstrap 用户名写入 0600 `.env`。用户 compose 强制要求三项值；共享 entrypoint 仅在 `station` 角色且三项完整时生成 `dashboard.docker.yml` hierarchy overlay。任一项缺失、用户名含不支持字符或 secret 不是 64 位十六进制时启动失败。Relay 角色不消费此 overlay。

### Rationale

Dashboard 是独立的 operator authority，不能复用应用 JWT，也不能从公开镜像继承开发口令。沿用现有 env → hierarchy overlay 机制可保持镜像环境中立，不增加第二配置通道；生成值跟随实例备份和升级，但不进入报告或日志。

### Alternatives Considered

- 直接修改 `sub_dashboard.yml` 删除开发账号：会破坏现有源码 profile，且仍没有为用户实例建立可恢复的 operator 凭据。
- 复用 `PEERS_AUTH_SECRET` 作为 Dashboard 密码或 JWT secret：混合用户认证和 operator authority，扩大单个秘密泄露后的影响面。
- 容器首次启动时随机生成：值不在用户所有的 `.env` 中，备份、恢复和排障无法绑定同一身份。

### Consequences

每个安装实例拥有独立 Dashboard 密码与会话签名根；重复安装、升级和回滚保持这些值不变。`.env` 丢失会同时影响应用、数据库和 Dashboard 恢复，因此完整备份必须继续包含该文件。
